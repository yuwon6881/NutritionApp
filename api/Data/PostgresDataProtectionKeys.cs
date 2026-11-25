using System.Xml.Linq;
using Microsoft.AspNetCore.DataProtection.Repositories;
using Npgsql;

namespace Nutrition.Api.Data;

internal sealed class PostgresDataProtectionKeys(string connectionString) : IXmlRepository
{
    public IReadOnlyCollection<XElement> GetAllElements()
    {
        using var connection = new NpgsqlConnection(connectionString);
        connection.Open();
        using var command = new NpgsqlCommand("""SELECT "Xml" FROM public."DataProtectionKeys" """, connection);
        using var reader = command.ExecuteReader();
        var elements = new List<XElement>();
        while (reader.Read()) elements.Add(XElement.Parse(reader.GetString(0)));
        return elements;
    }

    public void StoreElement(XElement element, string friendlyName)
    {
        using var connection = new NpgsqlConnection(connectionString);
        connection.Open();
        using var command = new NpgsqlCommand(
            """INSERT INTO public."DataProtectionKeys" ("Name", "Xml") VALUES (@name, @xml)""", connection);
        command.Parameters.AddWithValue("name", friendlyName);
        command.Parameters.AddWithValue("xml", element.ToString(SaveOptions.DisableFormatting));
        command.ExecuteNonQuery();
    }
}
