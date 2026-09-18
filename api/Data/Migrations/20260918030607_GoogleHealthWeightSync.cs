using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nutrition.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class GoogleHealthWeightSync : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "RequestedOperationsJson",
                table: "GoogleHealthOAuthStates",
                type: "text",
                nullable: false,
                defaultValue: "[]");

            migrationBuilder.AddColumn<string>(
                name: "RequestedScopesJson",
                table: "GoogleHealthOAuthStates",
                type: "text",
                nullable: false,
                defaultValue: "[]");

            migrationBuilder.AddColumn<long>(
                name: "ConnectionGeneration",
                table: "GoogleHealthConnections",
                type: "bigint",
                nullable: false,
                defaultValue: 1L);

            migrationBuilder.AddColumn<string>(
                name: "GrantedScopesJson",
                table: "GoogleHealthConnections",
                type: "text",
                nullable: false,
                defaultValue: "[\"https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly\"]");

            migrationBuilder.AddColumn<DateTime>(
                name: "WeightLastSuccessfulSyncAt",
                table: "GoogleHealthConnections",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "WeightSyncEnabled",
                table: "GoogleHealthConnections",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<long>(
                name: "WeightSyncRevision",
                table: "GoogleHealthConnections",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.CreateTable(
                name: "GoogleHealthWeightSyncWork",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    WeightId = table.Column<Guid>(type: "uuid", nullable: false),
                    DesiredRevision = table.Column<long>(type: "bigint", nullable: false),
                    DesiredDate = table.Column<DateOnly>(type: "date", nullable: false),
                    DesiredKg = table.Column<double>(type: "double precision", nullable: false),
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
                    table.PrimaryKey("PK_GoogleHealthWeightSyncWork", x => new { x.UserId, x.Id });
                    table.ForeignKey(
                        name: "FK_GoogleHealthWeightSyncWork_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_GoogleHealthWeightSyncWork_ProcessingState_NextAttemptAt",
                table: "GoogleHealthWeightSyncWork",
                columns: new[] { "ProcessingState", "NextAttemptAt" });

            migrationBuilder.CreateIndex(
                name: "IX_GoogleHealthWeightSyncWork_UserId_WeightId",
                table: "GoogleHealthWeightSyncWork",
                columns: new[] { "UserId", "WeightId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "GoogleHealthWeightSyncWork");

            migrationBuilder.DropColumn(
                name: "RequestedOperationsJson",
                table: "GoogleHealthOAuthStates");

            migrationBuilder.DropColumn(
                name: "RequestedScopesJson",
                table: "GoogleHealthOAuthStates");

            migrationBuilder.DropColumn(
                name: "ConnectionGeneration",
                table: "GoogleHealthConnections");

            migrationBuilder.DropColumn(
                name: "GrantedScopesJson",
                table: "GoogleHealthConnections");

            migrationBuilder.DropColumn(
                name: "WeightLastSuccessfulSyncAt",
                table: "GoogleHealthConnections");

            migrationBuilder.DropColumn(
                name: "WeightSyncEnabled",
                table: "GoogleHealthConnections");

            migrationBuilder.DropColumn(
                name: "WeightSyncRevision",
                table: "GoogleHealthConnections");
        }
    }
}
