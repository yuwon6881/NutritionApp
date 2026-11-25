using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace Nutrition.Api.Data.Migrations;

[DbContext(typeof(AppDb))]
[Migration("20261125100000_PrivateDataProtectionAndApiTables")]
public sealed class PrivateDataProtectionAndApiTables : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.Sql("""
            ALTER TABLE public."Users" ADD "WeightGoalMetricRevision" bigint NOT NULL DEFAULT 0;

            CREATE TABLE public."DataProtectionKeys" (
                "Id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                "Name" text NOT NULL,
                "Xml" text NOT NULL
            );

            DO $$
            DECLARE table_name text; role_name text;
            BEGIN
                FOREACH table_name IN ARRAY ARRAY[
                    'AiConversationTurns','AiConversations','BodyRecords','CheckIns','DailyExpenditureEstimates',
                    'DataProtectionKeys','GoogleHealthBodyFatSyncWork','GoogleHealthConnections',
                    'GoogleHealthNutritionSyncWork','GoogleHealthOAuthStates','GoogleHealthWeightSyncWork',
                    'IntegrationGrants','NutritionCheckInReminderPreferences','NutritionPushReminderDeliveries',
                    'NutritionPushSubscriptions','PhaseDecisions','PhotoObjectDeletions','PublicFoodProducts','WorkoutSummaries',
                    'Users','Sessions','Entries','Foods','Weights','Days','Plans','Receipts','Scans','Usage','Photos'
                ] LOOP
                    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
                    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', table_name);
                    FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
                        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
                            EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', table_name, role_name);
                        END IF;
                    END LOOP;
                END LOOP;
            END; $$;
            """);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        // Keep existing API tables private on rollback.
        migrationBuilder.Sql("""
            DROP TABLE public."DataProtectionKeys";
            ALTER TABLE public."Users" DROP COLUMN "WeightGoalMetricRevision";
            """);
    }
}
