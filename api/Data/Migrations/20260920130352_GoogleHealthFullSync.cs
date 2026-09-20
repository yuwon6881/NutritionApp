using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nutrition.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class GoogleHealthFullSync : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "BodyFatLastSuccessfulSyncAt",
                table: "GoogleHealthConnections",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "BodyFatSyncEnabled",
                table: "GoogleHealthConnections",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<long>(
                name: "BodyFatSyncRevision",
                table: "GoogleHealthConnections",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<DateTime>(
                name: "NutritionLastSuccessfulSyncAt",
                table: "GoogleHealthConnections",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "NutritionSyncEnabled",
                table: "GoogleHealthConnections",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<long>(
                name: "NutritionSyncRevision",
                table: "GoogleHealthConnections",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.CreateTable(
                name: "GoogleHealthBodyFatSyncWork",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    BodyRecordId = table.Column<Guid>(type: "uuid", nullable: false),
                    DesiredRevision = table.Column<long>(type: "bigint", nullable: false),
                    DesiredDate = table.Column<DateOnly>(type: "date", nullable: false),
                    DesiredBodyFatPercent = table.Column<double>(type: "double precision", nullable: false),
                    DesiredDeleted = table.Column<bool>(type: "boolean", nullable: false),
                    GoogleIdHash = table.Column<string>(type: "text", nullable: false),
                    ConnectionGeneration = table.Column<long>(type: "bigint", nullable: false),
                    GoogleResourceName = table.Column<string>(type: "text", nullable: false),
                    GoogleOperationName = table.Column<string>(type: "text", nullable: false),
                    ProcessingState = table.Column<string>(type: "text", nullable: false),
                    NextAttemptAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LeaseUntil = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    LeaseId = table.Column<string>(type: "text", nullable: false),
                    LastErrorCategory = table.Column<string>(type: "text", nullable: false),
                    LastErrorMessage = table.Column<string>(type: "text", nullable: false),
                    RetryCount = table.Column<int>(type: "integer", nullable: false),
                    LastSuccessfulSyncAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Revision = table.Column<long>(type: "bigint", nullable: false),
                    Deleted = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GoogleHealthBodyFatSyncWork", x => new { x.UserId, x.Id });
                    table.ForeignKey(
                        name: "FK_GoogleHealthBodyFatSyncWork_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "GoogleHealthNutritionSyncWork",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    EntryId = table.Column<Guid>(type: "uuid", nullable: false),
                    DesiredRevision = table.Column<long>(type: "bigint", nullable: false),
                    DesiredDate = table.Column<DateOnly>(type: "date", nullable: false),
                    DesiredTime = table.Column<string>(type: "text", nullable: true),
                    DesiredName = table.Column<string>(type: "text", nullable: false),
                    DesiredCalories = table.Column<double>(type: "double precision", nullable: false),
                    DesiredProtein = table.Column<double>(type: "double precision", nullable: true),
                    DesiredFat = table.Column<double>(type: "double precision", nullable: true),
                    DesiredCarbs = table.Column<double>(type: "double precision", nullable: true),
                    DesiredFiber = table.Column<double>(type: "double precision", nullable: true),
                    DesiredDeleted = table.Column<bool>(type: "boolean", nullable: false),
                    GoogleIdHash = table.Column<string>(type: "text", nullable: false),
                    ConnectionGeneration = table.Column<long>(type: "bigint", nullable: false),
                    GoogleResourceName = table.Column<string>(type: "text", nullable: false),
                    GoogleOperationName = table.Column<string>(type: "text", nullable: false),
                    ProcessingState = table.Column<string>(type: "text", nullable: false),
                    NextAttemptAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LeaseUntil = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    LeaseId = table.Column<string>(type: "text", nullable: false),
                    LastErrorCategory = table.Column<string>(type: "text", nullable: false),
                    LastErrorMessage = table.Column<string>(type: "text", nullable: false),
                    RetryCount = table.Column<int>(type: "integer", nullable: false),
                    LastSuccessfulSyncAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Revision = table.Column<long>(type: "bigint", nullable: false),
                    Deleted = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GoogleHealthNutritionSyncWork", x => new { x.UserId, x.Id });
                    table.ForeignKey(
                        name: "FK_GoogleHealthNutritionSyncWork_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_GoogleHealthBodyFatSyncWork_ProcessingState_NextAttemptAt",
                table: "GoogleHealthBodyFatSyncWork",
                columns: new[] { "ProcessingState", "NextAttemptAt" });

            migrationBuilder.CreateIndex(
                name: "IX_GoogleHealthBodyFatSyncWork_UserId_BodyRecordId",
                table: "GoogleHealthBodyFatSyncWork",
                columns: new[] { "UserId", "BodyRecordId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_GoogleHealthNutritionSyncWork_ProcessingState_NextAttemptAt",
                table: "GoogleHealthNutritionSyncWork",
                columns: new[] { "ProcessingState", "NextAttemptAt" });

            migrationBuilder.CreateIndex(
                name: "IX_GoogleHealthNutritionSyncWork_UserId_EntryId",
                table: "GoogleHealthNutritionSyncWork",
                columns: new[] { "UserId", "EntryId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "GoogleHealthBodyFatSyncWork");

            migrationBuilder.DropTable(
                name: "GoogleHealthNutritionSyncWork");

            migrationBuilder.DropColumn(
                name: "BodyFatLastSuccessfulSyncAt",
                table: "GoogleHealthConnections");

            migrationBuilder.DropColumn(
                name: "BodyFatSyncEnabled",
                table: "GoogleHealthConnections");

            migrationBuilder.DropColumn(
                name: "BodyFatSyncRevision",
                table: "GoogleHealthConnections");

            migrationBuilder.DropColumn(
                name: "NutritionLastSuccessfulSyncAt",
                table: "GoogleHealthConnections");

            migrationBuilder.DropColumn(
                name: "NutritionSyncEnabled",
                table: "GoogleHealthConnections");

            migrationBuilder.DropColumn(
                name: "NutritionSyncRevision",
                table: "GoogleHealthConnections");
        }
    }
}
