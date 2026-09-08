using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace Nutrition.Api.Data.Migrations;

[DbContext(typeof(AppDb))]
[Migration("20260907190000_PrivateApiTables")]
public sealed class PrivateApiTables : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        // These records are served only by our authenticated API, never Supabase Data API.
        migrationBuilder.Sql("""
            DO $$
            DECLARE table_name text; role_name text;
            BEGIN
                FOREACH table_name IN ARRAY ARRAY['Users','Sessions','Entries','Foods','Weights','Days','Plans','Receipts','Scans','Usage','Photos'] LOOP
                    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
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
        // A rollback must not silently grant public access to private nutrition data.
    }
}
