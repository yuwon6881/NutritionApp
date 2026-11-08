using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nutrition.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class RemoveMealCompaction : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Compaction replaced a day's meal detail with these totals. Dropping them would erase a
            // day that has no entries behind it, so refuse to run rather than lose history.
            migrationBuilder.Sql("""
                DO $
                BEGIN
                    IF EXISTS (SELECT 1 FROM "Days" WHERE "Archived") THEN
                        RAISE EXCEPTION 'Archived days exist; their daily totals cannot be rebuilt from meal detail.';
                    END IF;
                END $;
                """);

            migrationBuilder.DropColumn(
                name: "Archived",
                table: "Days");

            migrationBuilder.DropColumn(
                name: "Calories",
                table: "Days");

            migrationBuilder.DropColumn(
                name: "Carbs",
                table: "Days");

            migrationBuilder.DropColumn(
                name: "EntryCount",
                table: "Days");

            migrationBuilder.DropColumn(
                name: "Fat",
                table: "Days");

            migrationBuilder.DropColumn(
                name: "Fiber",
                table: "Days");

            migrationBuilder.DropColumn(
                name: "Protein",
                table: "Days");

            migrationBuilder.AddColumn<DateTime>(
                name: "DeletedAt",
                table: "Entries",
                type: "timestamp with time zone",
                nullable: true);

            // Existing deletion markers start their tombstone window now, so no device loses a deletion early.
            migrationBuilder.Sql("""UPDATE "Entries" SET "DeletedAt" = now() WHERE "Deleted";""");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "DeletedAt",
                table: "Entries");

            migrationBuilder.AddColumn<bool>(
                name: "Archived",
                table: "Days",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<double>(
                name: "Calories",
                table: "Days",
                type: "double precision",
                nullable: false,
                defaultValue: 0.0);

            migrationBuilder.AddColumn<double>(
                name: "Carbs",
                table: "Days",
                type: "double precision",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "EntryCount",
                table: "Days",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<double>(
                name: "Fat",
                table: "Days",
                type: "double precision",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "Fiber",
                table: "Days",
                type: "double precision",
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "Protein",
                table: "Days",
                type: "double precision",
                nullable: true);
        }
    }
}
