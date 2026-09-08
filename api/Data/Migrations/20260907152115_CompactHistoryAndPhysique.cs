using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nutrition.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class CompactHistoryAndPhysique : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "Created",
                table: "Receipts",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified));

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

            migrationBuilder.CreateTable(
                name: "Photos",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Date = table.Column<DateOnly>(type: "date", nullable: false),
                    Caption = table.Column<string>(type: "text", nullable: false),
                    Angle = table.Column<string>(type: "text", nullable: false),
                    ObjectPath = table.Column<string>(type: "text", nullable: false),
                    Bytes = table.Column<int>(type: "integer", nullable: false),
                    RequestHash = table.Column<string>(type: "text", nullable: false),
                    Status = table.Column<string>(type: "text", nullable: false),
                    Created = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Revision = table.Column<long>(type: "bigint", nullable: false),
                    Deleted = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Photos", x => new { x.UserId, x.Id });
                    table.ForeignKey(
                        name: "FK_Photos_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Receipts_Created",
                table: "Receipts",
                column: "Created");

            migrationBuilder.CreateIndex(
                name: "IX_Photos_UserId_Date",
                table: "Photos",
                columns: new[] { "UserId", "Date" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Photos");

            migrationBuilder.DropIndex(
                name: "IX_Receipts_Created",
                table: "Receipts");

            migrationBuilder.DropColumn(
                name: "Created",
                table: "Receipts");

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
        }
    }
}
