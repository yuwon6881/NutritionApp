using System.Collections;
using System.Globalization;
using System.Text;
using System.Text.Json;
using Npgsql;

public static class LegacyMerge
{
    private sealed record Column(string Name, bool Nullable, string? DefaultSql, bool Identity);
    private sealed record Table(string Name, IReadOnlyList<Column> Columns, IReadOnlyList<string> PrimaryKey, IReadOnlyList<IReadOnlyList<string>> UniqueKeys)
    {
        public IReadOnlySet<string> ColumnNames => Columns.Select(x => x.Name).ToHashSet(StringComparer.Ordinal);
    }

    private sealed record MergeRow(string Table, Dictionary<string, object?> Values);
    private sealed record MergeSummary(string Table, int SourceRows, int WouldInsert, int AlreadyPresent, int Applied);

    public static async Task Run(string destinationConnectionString, string legacyConnectionString, bool apply, bool mapSingleUser)
    {
        await using var destination = new NpgsqlConnection(destinationConnectionString);
        await using var legacy = new NpgsqlConnection(legacyConnectionString);
        await destination.OpenAsync();
        await legacy.OpenAsync();

        var destinationTables = await LoadTables(destination);
        var legacyTables = await LoadTables(legacy);
        EnsureCompatibleTables(destinationTables, legacyTables);

        var destinationUser = await ResolveUsers(destination, legacy, destinationTables["Users"], legacyTables["Users"], mapSingleUser);
        var summaries = new List<MergeSummary>();
        var userUpdates = PlanUserMerge(destinationUser.Destination, destinationUser.Legacy, destinationTables["Users"]);

        foreach (var tableName in LegacyMergePolicy.DurableTables.OrderBy(x => x, StringComparer.Ordinal))
        {
            if (!legacyTables.ContainsKey(tableName) || !destinationTables.ContainsKey(tableName))
                continue;

            var summary = await PlanTableMerge(destination, legacy, legacyTables[tableName], destinationTables[tableName], destinationUser);
            summaries.Add(summary);
        }

        foreach (var tableName in LegacyMergePolicy.SkippedTables.OrderBy(x => x, StringComparer.Ordinal))
        {
            if (!legacyTables.TryGetValue(tableName, out var table) || !table.ColumnNames.Contains("UserId"))
                continue;
            var count = await CountUserRows(legacy, table, destinationUser.LegacyId);
            if (count > 0)
                Console.WriteLine(JsonSerializer.Serialize(new { table = tableName, skipped = count, reason = SkipReason(tableName) }));
        }

        Console.WriteLine(JsonSerializer.Serialize(new
        {
            mode = apply ? "apply" : "compare",
            sourceUserMapped = true,
            profileFieldsToUpdate = userUpdates.Count,
            summaries
        }));

        if (!apply)
            return;
        if (!mapSingleUser && string.IsNullOrWhiteSpace(destinationUser.LegacyIdentitySubject))
            throw new InvalidOperationException("Legacy user has no central identity subject; pass --map-single-user for the explicit one-user mapping.");

        await using var transaction = await destination.BeginTransactionAsync();
        try
        {
            await ApplyUserMerge(destination, transaction, destinationUser, destinationTables["Users"], userUpdates);
            foreach (var tableName in LegacyMergePolicy.DurableTables.OrderBy(x => x, StringComparer.Ordinal))
            {
                if (!legacyTables.TryGetValue(tableName, out var sourceTable) || !destinationTables.TryGetValue(tableName, out var targetTable))
                    continue;
                await ApplyTableMerge(destination, legacy, transaction, sourceTable, targetTable, destinationUser, summaries);
            }
            await transaction.CommitAsync();
            Console.WriteLine("Legacy Nutrition data merged atomically; skipped rows remain available in the legacy database for the retention decision.");
        }
        catch
        {
            await transaction.RollbackAsync();
            throw;
        }
    }

    private static async Task<Dictionary<string, Table>> LoadTables(NpgsqlConnection connection)
    {
        const string columnSql = """
            SELECT table_name, column_name, is_nullable, column_default, is_identity
            FROM information_schema.columns
            WHERE table_schema = 'public'
            ORDER BY table_name, ordinal_position
            """;
        var columns = new Dictionary<string, List<Column>>(StringComparer.Ordinal);
        await using (var command = new NpgsqlCommand(columnSql, connection))
        await using (var reader = await command.ExecuteReaderAsync())
        {
            while (await reader.ReadAsync())
            {
                var table = reader.GetString(0);
                (columns.TryGetValue(table, out var list) ? list : columns[table] = []).Add(new Column(
                    reader.GetString(1), reader.GetString(2) == "YES", reader.IsDBNull(3) ? null : reader.GetString(3), reader.GetString(4) == "YES"));
            }
        }

        const string keySql = """
            SELECT tc.table_name, tc.constraint_name, kcu.column_name, tc.constraint_type, kcu.ordinal_position
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON kcu.constraint_schema = tc.constraint_schema
             AND kcu.constraint_name = tc.constraint_name
             AND kcu.table_name = tc.table_name
            WHERE tc.table_schema = 'public' AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
            ORDER BY tc.table_name, tc.constraint_name, kcu.ordinal_position
            """;
        var keys = new Dictionary<(string Table, string Constraint), (string Type, List<string> Columns)>();
        await using (var command = new NpgsqlCommand(keySql, connection))
        await using (var reader = await command.ExecuteReaderAsync())
        {
            while (await reader.ReadAsync())
            {
                var key = (reader.GetString(0), reader.GetString(1));
                if (!keys.TryGetValue(key, out var value))
                    value = (reader.GetString(3), []);
                value.Columns.Add(reader.GetString(2));
                keys[key] = value;
            }
        }

        return columns.ToDictionary(
            pair => pair.Key,
            pair =>
            {
                var tableKeys = keys.Where(x => x.Key.Table == pair.Key).ToArray();
                var primary = tableKeys.FirstOrDefault(x => x.Value.Type == "PRIMARY KEY").Value.Columns;
                if (primary is null) throw new InvalidOperationException($"Public table '{pair.Key}' has no primary key.");
                return new Table(pair.Key, pair.Value, primary, tableKeys.Select(x => (IReadOnlyList<string>)x.Value.Columns).ToArray());
            },
            StringComparer.Ordinal);
    }

    private static void EnsureCompatibleTables(IReadOnlyDictionary<string, Table> destination, IReadOnlyDictionary<string, Table> legacy)
    {
        if (!destination.ContainsKey("Users") || !legacy.ContainsKey("Users"))
            throw new InvalidOperationException("Both databases must contain a public Users table.");
        foreach (var table in legacy.Keys.Where(x => x is not "__EFMigrationsHistory" && x is not "Users"))
        {
            if (!LegacyMergePolicy.DurableTables.Contains(table) && !LegacyMergePolicy.SkippedTables.Contains(table))
                throw new InvalidOperationException($"Legacy database contains unclassified table '{table}'; no merge was attempted.");
        }
    }

    private sealed record UserMapping(Guid LegacyId, Guid DestinationId, string LegacyIdentitySubject, Dictionary<string, object?> Legacy, Dictionary<string, object?> Destination);

    private static async Task<UserMapping> ResolveUsers(NpgsqlConnection destination, NpgsqlConnection legacy, Table destinationTable, Table legacyTable, bool mapSingleUser)
    {
        var sourceUsers = await ReadRows(legacy, legacyTable, null);
        var destinationUsers = await ReadRows(destination, destinationTable, null);
        if (sourceUsers.Count != 1)
            throw new InvalidOperationException($"Expected exactly one legacy user for this controlled merge; found {sourceUsers.Count}.");

        var source = sourceUsers[0];
        var sourceId = (Guid)source["Id"]!;
        var sourceSubject = source.TryGetValue("IdentitySubject", out var subject) ? subject?.ToString() ?? "" : "";
        Dictionary<string, object?>? target = null;
        if (!string.IsNullOrWhiteSpace(sourceSubject))
        {
            var matches = destinationUsers.Where(x => string.Equals(x.GetValueOrDefault("IdentitySubject")?.ToString(), sourceSubject, StringComparison.Ordinal)).ToArray();
            if (matches.Length != 1)
                throw new InvalidOperationException($"Legacy identity subject did not resolve to exactly one active user; found {matches.Length}.");
            target = matches[0];
        }
        else
        {
            if (!mapSingleUser)
                throw new InvalidOperationException("Legacy user has no central identity subject; a one-user mapping must be explicitly enabled with --map-single-user.");
            if (destinationUsers.Count != 1)
                throw new InvalidOperationException($"--map-single-user requires exactly one active user; found {destinationUsers.Count}.");
            target = destinationUsers[0];
        }

        return new UserMapping(sourceId, (Guid)target["Id"]!, sourceSubject, source, target);
    }

    private static Dictionary<string, object?> PlanUserMerge(Dictionary<string, object?> destination, Dictionary<string, object?> legacy, Table table)
    {
        var updates = new Dictionary<string, object?>(StringComparer.Ordinal);
        foreach (var column in table.Columns)
        {
            var name = column.Name;
            if (name is "Id" or "Username" or "PasswordHash" or "Slot" or "IdentitySubject" or "DisplayName" || !legacy.ContainsKey(name))
                continue;
            var oldValue = legacy[name];
            var newValue = destination.GetValueOrDefault(name);
            if (name.EndsWith("Revision", StringComparison.Ordinal))
            {
                var oldRevision = Convert.ToInt64(oldValue ?? 0, CultureInfo.InvariantCulture);
                var newRevision = Convert.ToInt64(newValue ?? 0, CultureInfo.InvariantCulture);
                if (oldRevision > newRevision) updates[name] = oldRevision;
                continue;
            }
            // A missing value in the legacy snapshot carries no information and
            // must never erase a value already present in the active database.
            if (IsEmpty(oldValue))
                continue;
            if (name == "CoachingSettingsChangedDate" && oldValue is DateOnly oldDate && newValue is DateOnly newDate)
            {
                if (oldDate > newDate) updates[name] = oldDate;
                continue;
            }
            if (ValuesEqual(oldValue, newValue))
                continue;
            if (IsEmpty(newValue) && !IsEmpty(oldValue))
            {
                updates[name] = oldValue;
                continue;
            }
            if (IsAppDefault(newValue, name) && !IsAppDefault(oldValue, name))
            {
                updates[name] = oldValue;
                continue;
            }
            if (IsAppDefault(oldValue, name))
                continue;
            throw new InvalidOperationException($"User profile conflict in column '{name}'; merge aborted without changing the destination.");
        }
        return updates;
    }

    private static async Task<MergeSummary> PlanTableMerge(NpgsqlConnection destination, NpgsqlConnection legacy, Table sourceTable, Table targetTable, UserMapping users)
    {
        var sourceRows = await ReadRows(legacy, sourceTable, users.LegacyId);
        var destinationRows = await ReadRows(destination, targetTable, users.DestinationId);
        var destinationByKey = destinationRows.ToDictionary(row => Key(targetTable, row), StringComparer.Ordinal);
        var inserts = 0;
        var present = 0;
        foreach (var source in sourceRows)
        {
            var candidate = Candidate(source, sourceTable, targetTable, users.DestinationId);
            if (destinationByKey.TryGetValue(Key(targetTable, candidate), out var existing))
            {
                CompareSharedValues(source, candidate, existing, targetTable);
                present++;
                continue;
            }
            CheckUniqueConflicts(candidate, destinationRows, targetTable);
            EnsureInsertable(candidate, source, targetTable);
            inserts++;
        }
        return new MergeSummary(targetTable.Name, sourceRows.Count, inserts, present, 0);
    }

    private static async Task ApplyUserMerge(NpgsqlConnection destination, NpgsqlTransaction transaction, UserMapping users, Table table, Dictionary<string, object?> updates)
    {
        if (updates.Count == 0) return;
        var assignments = string.Join(", ", updates.Keys.Select((name, index) => $"{Quote(name)}=@p{index}"));
        await using var command = new NpgsqlCommand($"UPDATE {Quote(table.Name)} SET {assignments} WHERE {Quote("Id")}=@id", destination, transaction);
        foreach (var (value, index) in updates.Values.Select((value, index) => (value, index)))
            AddParameter(command, $"p{index}", value);
        AddParameter(command, "id", users.DestinationId);
        await command.ExecuteNonQueryAsync();
    }

    private static async Task ApplyTableMerge(NpgsqlConnection destination, NpgsqlConnection legacy, NpgsqlTransaction transaction, Table sourceTable, Table targetTable, UserMapping users, List<MergeSummary> summaries)
    {
        var sourceRows = await ReadRows(legacy, sourceTable, users.LegacyId);
        var destinationRows = await ReadRows(destination, targetTable, users.DestinationId, transaction);
        var destinationByKey = destinationRows.ToDictionary(row => Key(targetTable, row), StringComparer.Ordinal);
        var applied = 0;
        foreach (var source in sourceRows)
        {
            var candidate = Candidate(source, sourceTable, targetTable, users.DestinationId);
            if (destinationByKey.TryGetValue(Key(targetTable, candidate), out var existing))
            {
                CompareSharedValues(source, candidate, existing, targetTable);
                continue;
            }
            CheckUniqueConflicts(candidate, destinationRows, targetTable);
            EnsureInsertable(candidate, source, targetTable);
            await Insert(destination, transaction, targetTable, candidate);
            destinationRows.Add(candidate);
            destinationByKey[Key(targetTable, candidate)] = candidate;
            applied++;
        }
        var index = summaries.FindIndex(x => x.Table == targetTable.Name);
        if (index >= 0) summaries[index] = summaries[index] with { Applied = applied };
    }

    private static Dictionary<string, object?> Candidate(Dictionary<string, object?> source, Table sourceTable, Table targetTable, Guid destinationUser)
    {
        var result = new Dictionary<string, object?>(StringComparer.Ordinal);
        foreach (var column in targetTable.Columns)
        {
            if (!sourceTable.ColumnNames.Contains(column.Name)) continue;
            result[column.Name] = column.Name == "UserId" ? destinationUser : source.GetValueOrDefault(column.Name);
        }
        return result;
    }

    private static void CompareSharedValues(Dictionary<string, object?> source, Dictionary<string, object?> candidate, Dictionary<string, object?> existing, Table targetTable)
    {
        foreach (var name in candidate.Keys)
        {
            if (name is "UserId" or "Id") continue;
            if (!ValuesEqual(candidate[name], existing.GetValueOrDefault(name)))
                throw new InvalidOperationException($"Data conflict in {targetTable.Name}.{name}; merge aborted without committing any changes.");
        }
    }

    private static void CheckUniqueConflicts(Dictionary<string, object?> candidate, List<Dictionary<string, object?>> destinationRows, Table table)
    {
        foreach (var uniqueKey in table.UniqueKeys)
        {
            if (uniqueKey.SequenceEqual(table.PrimaryKey, StringComparer.Ordinal)) continue;
            if (uniqueKey.All(candidate.ContainsKey) && destinationRows.Any(row => uniqueKey.All(name => ValuesEqual(candidate[name], row.GetValueOrDefault(name)))))
                throw new InvalidOperationException($"Unique-key conflict while merging {table.Name}; merge aborted without committing any changes.");
        }
    }

    private static void EnsureInsertable(Dictionary<string, object?> candidate, Dictionary<string, object?> source, Table targetTable)
    {
        foreach (var column in targetTable.Columns)
        {
            if (column.Identity || candidate.ContainsKey(column.Name) || column.Nullable || column.DefaultSql is not null)
                continue;
            throw new InvalidOperationException($"Legacy row cannot populate required destination column {targetTable.Name}.{column.Name}; merge aborted.");
        }
    }

    private static async Task Insert(NpgsqlConnection destination, NpgsqlTransaction transaction, Table table, Dictionary<string, object?> values)
    {
        var columns = values.Keys.ToArray();
        var sql = $"INSERT INTO {Quote(table.Name)} ({string.Join(",", columns.Select(Quote))}) VALUES ({string.Join(",", columns.Select((_, index) => $"@p{index}"))})";
        await using var command = new NpgsqlCommand(sql, destination, transaction);
        foreach (var (value, index) in values.Values.Select((value, index) => (value, index)))
            AddParameter(command, $"p{index}", value);
        await command.ExecuteNonQueryAsync();
    }

    private static async Task<List<Dictionary<string, object?>>> ReadRows(NpgsqlConnection connection, Table table, Guid? userId, NpgsqlTransaction? transaction = null)
    {
        var where = userId.HasValue && table.ColumnNames.Contains("UserId") ? $" WHERE {Quote("UserId")}=@user" : "";
        await using var command = new NpgsqlCommand($"SELECT * FROM {Quote(table.Name)}{where}", connection, transaction);
        if (userId.HasValue && table.ColumnNames.Contains("UserId")) AddParameter(command, "user", userId.Value);
        await using var reader = await command.ExecuteReaderAsync();
        var rows = new List<Dictionary<string, object?>>();
        while (await reader.ReadAsync())
        {
            var row = new Dictionary<string, object?>(StringComparer.Ordinal);
            for (var i = 0; i < reader.FieldCount; i++) row[reader.GetName(i)] = reader.IsDBNull(i) ? null : reader.GetValue(i);
            rows.Add(row);
        }
        return rows;
    }

    private static async Task<int> CountUserRows(NpgsqlConnection connection, Table table, Guid userId)
    {
        await using var command = new NpgsqlCommand($"SELECT count(*) FROM {Quote(table.Name)} WHERE {Quote("UserId")}=@user", connection);
        AddParameter(command, "user", userId);
        return Convert.ToInt32(await command.ExecuteScalarAsync(), CultureInfo.InvariantCulture);
    }

    private static string Key(Table table, Dictionary<string, object?> row)
        => string.Join("|", table.PrimaryKey.Select(name => ValueKey(row.GetValueOrDefault(name))));

    private static string ValueKey(object? value)
    {
        if (value is null) return "null";
        if (value is byte[] bytes) return "bytes:" + Convert.ToBase64String(bytes);
        if (value is DateOnly date) return "date:" + date.ToString("O", CultureInfo.InvariantCulture);
        if (value is DateTime dateTime) return "datetime:" + dateTime.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture);
        if (value is DateTimeOffset offset) return "offset:" + offset.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture);
        if (value is IFormattable formattable) return value.GetType().FullName + ":" + formattable.ToString(null, CultureInfo.InvariantCulture);
        return value.GetType().FullName + ":" + value;
    }

    private static bool ValuesEqual(object? left, object? right)
    {
        if (left is null || right is null) return left is null && right is null;
        if (left is byte[] a && right is byte[] b) return StructuralComparisons.StructuralEqualityComparer.Equals(a, b);
        if (left is DateTime leftDate && right is DateTime rightDate) return leftDate.ToUniversalTime() == rightDate.ToUniversalTime();
        return Equals(left, right);
    }

    private static bool IsEmpty(object? value) => value is null || value switch
    {
        string text => text.Length == 0,
        Guid guid => guid == Guid.Empty,
        int number => number == 0,
        long number => number == 0,
        double number => number == 0,
        _ => false
    };

    private static bool IsAppDefault(object? value, string name) => name switch
    {
        "CheckInWeekday" => Convert.ToInt32(value ?? 1, CultureInfo.InvariantCulture) == 1,
        "WeightUnit" => string.Equals(value?.ToString(), "kg", StringComparison.Ordinal),
        "EnergyUnit" => string.Equals(value?.ToString(), "kcal", StringComparison.Ordinal),
        "HeightUnit" => string.Equals(value?.ToString(), "cm", StringComparison.Ordinal),
        "MissingDayAction" => string.Equals(value?.ToString(), "ask", StringComparison.Ordinal),
        "WeightGoalMetric" => string.Equals(value?.ToString(), "scale", StringComparison.Ordinal),
        _ => IsEmpty(value)
    };

    private static void AddParameter(NpgsqlCommand command, string name, object? value)
        => command.Parameters.AddWithValue(name, value ?? DBNull.Value);

    private static string Quote(string identifier) => "\"" + identifier.Replace("\"", "\"\"", StringComparison.Ordinal) + "\"";

    private static string SkipReason(string tableName) => tableName switch
    {
        "Sessions" or "Receipts" or "Usage" or "GoogleHealthOAuthStates" => "ephemeral bookkeeping; rebuild or expire it",
        "Scans" => "scan queue/result may reference image storage; requeue intentionally",
        "DailyExpenditureEstimates" or "WorkoutSummaries" => "derived cache; rebuild from authoritative history",
        "Photos" => "database rows may reference external photo objects; migrate storage separately",
        _ => "not part of the controlled merge"
    };
}
