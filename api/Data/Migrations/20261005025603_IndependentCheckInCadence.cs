using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nutrition.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class IndependentCheckInCadence : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateOnly>(
                name: "CadenceChangedDate",
                table: "Users",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "CadenceRevision",
                table: "Users",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<DateOnly>(
                name: "CadenceChangedDate",
                table: "Plans",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "CadenceRevision",
                table: "Plans",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);
            migrationBuilder.Sql("""
                UPDATE "Users" SET "CadenceRevision" = "CoachingSettingsRevision", "CadenceChangedDate" = "CoachingSettingsChangedDate"
                WHERE EXISTS (SELECT 1 FROM "Plans" p WHERE p."UserId"="Users"."Id"
                    AND p."Revision"=(SELECT MAX(q."Revision") FROM "Plans" q WHERE q."UserId"="Users"."Id")
                    AND p."CheckInWeekday"<>"Users"."CheckInWeekday");
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CadenceChangedDate",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "CadenceRevision",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "CadenceChangedDate",
                table: "Plans");

            migrationBuilder.DropColumn(
                name: "CadenceRevision",
                table: "Plans");
        }
    }
}
