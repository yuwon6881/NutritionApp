using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nutrition.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class TrainingIntegrationAndIdentity : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "IdentitySubject",
                table: "Users",
                type: "text",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "GoogleHealthConnections",
                columns: table => new
                {
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    GoogleIdHash = table.Column<string>(type: "text", nullable: false),
                    EncryptedGoogleId = table.Column<string>(type: "text", nullable: false),
                    EncryptedRefreshToken = table.Column<string>(type: "text", nullable: false),
                    EncryptedStepHistoryJson = table.Column<string>(type: "text", nullable: false),
                    ConnectedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LastSyncedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Status = table.Column<string>(type: "text", nullable: false),
                    Revision = table.Column<long>(type: "bigint", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GoogleHealthConnections", x => x.UserId);
                    table.ForeignKey(
                        name: "FK_GoogleHealthConnections_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "GoogleHealthOAuthStates",
                columns: table => new
                {
                    State = table.Column<string>(type: "text", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    SessionHash = table.Column<string>(type: "text", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ExpiresAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_GoogleHealthOAuthStates", x => x.State);
                    table.ForeignKey(
                        name: "FK_GoogleHealthOAuthStates_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "IntegrationGrants",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Peer = table.Column<string>(type: "text", nullable: false),
                    Status = table.Column<string>(type: "text", nullable: false),
                    ScopesJson = table.Column<string>(type: "text", nullable: false),
                    EncryptedRefreshToken = table.Column<string>(type: "text", nullable: false),
                    GrantedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    RevokedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    Revision = table.Column<long>(type: "bigint", nullable: false),
                    Deleted = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_IntegrationGrants", x => new { x.UserId, x.Id });
                    table.ForeignKey(
                        name: "FK_IntegrationGrants_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "WorkoutSummaries",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    SummaryJson = table.Column<string>(type: "text", nullable: false),
                    LastSuccessAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    LastErrorAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    LastError = table.Column<string>(type: "text", nullable: false),
                    Revision = table.Column<long>(type: "bigint", nullable: false),
                    Deleted = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WorkoutSummaries", x => new { x.UserId, x.Id });
                    table.ForeignKey(
                        name: "FK_WorkoutSummaries_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_GoogleHealthConnections_GoogleIdHash",
                table: "GoogleHealthConnections",
                column: "GoogleIdHash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_GoogleHealthOAuthStates_ExpiresAt",
                table: "GoogleHealthOAuthStates",
                column: "ExpiresAt");

            migrationBuilder.CreateIndex(
                name: "IX_GoogleHealthOAuthStates_UserId",
                table: "GoogleHealthOAuthStates",
                column: "UserId");

            migrationBuilder.CreateIndex(
                name: "IX_IntegrationGrants_UserId_Peer",
                table: "IntegrationGrants",
                columns: new[] { "UserId", "Peer" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_WorkoutSummaries_UserId",
                table: "WorkoutSummaries",
                column: "UserId",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "GoogleHealthConnections");

            migrationBuilder.DropTable(
                name: "GoogleHealthOAuthStates");

            migrationBuilder.DropTable(
                name: "IntegrationGrants");

            migrationBuilder.DropTable(
                name: "WorkoutSummaries");

            migrationBuilder.DropColumn(
                name: "IdentitySubject",
                table: "Users");
        }
    }
}
