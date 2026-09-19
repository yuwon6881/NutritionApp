using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nutrition.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class TombstoneDeletionTimes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "DeletedAt",
                table: "Foods",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "DeletedAt",
                table: "BodyRecords",
                type: "timestamp with time zone",
                nullable: true);

            // Existing deleted rows have no trustworthy deletion event. Start their retention
            // window at migration time instead of treating their creation date as the deletion
            // date, which could otherwise remove an offline-client tombstone immediately.
            migrationBuilder.Sql("UPDATE \"Foods\" SET \"DeletedAt\" = CURRENT_TIMESTAMP WHERE \"Deleted\" = TRUE AND \"DeletedAt\" IS NULL;");
            migrationBuilder.Sql("UPDATE \"BodyRecords\" SET \"DeletedAt\" = CURRENT_TIMESTAMP WHERE \"Deleted\" = TRUE AND \"DeletedAt\" IS NULL;");

            migrationBuilder.CreateIndex(
                name: "IX_Foods_UserId_Deleted_DeletedAt_Id",
                table: "Foods",
                columns: new[] { "UserId", "Deleted", "DeletedAt", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_BodyRecords_UserId_Deleted_DeletedAt_Id",
                table: "BodyRecords",
                columns: new[] { "UserId", "Deleted", "DeletedAt", "Id" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Foods_UserId_Deleted_DeletedAt_Id",
                table: "Foods");

            migrationBuilder.DropIndex(
                name: "IX_BodyRecords_UserId_Deleted_DeletedAt_Id",
                table: "BodyRecords");

            migrationBuilder.DropColumn(
                name: "DeletedAt",
                table: "Foods");

            migrationBuilder.DropColumn(
                name: "DeletedAt",
                table: "BodyRecords");
        }
    }
}
