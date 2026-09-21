using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nutrition.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class NutritionCheckInPush : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "NutritionCheckInReminderPreferences",
                columns: table => new
                {
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Enabled = table.Column<bool>(type: "boolean", nullable: false),
                    Weekday = table.Column<int>(type: "integer", nullable: false),
                    LocalTime = table.Column<TimeOnly>(type: "time without time zone", nullable: false),
                    TimeZoneId = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NutritionCheckInReminderPreferences", x => x.UserId);
                    table.CheckConstraint("CK_NutritionCheckInReminderPreferences_Weekday", "\"Weekday\" >= 0 AND \"Weekday\" <= 6");
                    table.ForeignKey(
                        name: "FK_NutritionCheckInReminderPreferences_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "NutritionPushReminderDeliveries",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    DeviceId = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    ReminderDate = table.Column<DateOnly>(type: "date", nullable: false),
                    Status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    Attempts = table.Column<int>(type: "integer", nullable: false),
                    LeaseId = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    LeaseUntil = table.Column<DateTime>(type: "timestamp with time zone", nullable: true),
                    NextAttemptAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ExpiresAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    SentAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NutritionPushReminderDeliveries", x => x.Id);
                    table.CheckConstraint("CK_NutritionPushReminderDeliveries_Attempts", "\"Attempts\" >= 0");
                    table.CheckConstraint("CK_NutritionPushReminderDeliveries_Status", "\"Status\" IN ('sending', 'retry', 'sent', 'disabled', 'failed')");
                    table.ForeignKey(
                        name: "FK_NutritionPushReminderDeliveries_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "NutritionPushSubscriptions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    DeviceId = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    FcmToken = table.Column<string>(type: "character varying(4096)", maxLength: 4096, nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NutritionPushSubscriptions", x => x.Id);
                    table.ForeignKey(
                        name: "FK_NutritionPushSubscriptions_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_NutritionCheckInReminderPreferences_Enabled_Weekday_LocalTi~",
                table: "NutritionCheckInReminderPreferences",
                columns: new[] { "Enabled", "Weekday", "LocalTime" });

            migrationBuilder.CreateIndex(
                name: "IX_NutritionPushReminderDeliveries_ExpiresAt",
                table: "NutritionPushReminderDeliveries",
                column: "ExpiresAt");

            migrationBuilder.CreateIndex(
                name: "IX_NutritionPushReminderDeliveries_Status_NextAttemptAt_LeaseU~",
                table: "NutritionPushReminderDeliveries",
                columns: new[] { "Status", "NextAttemptAt", "LeaseUntil" });

            migrationBuilder.CreateIndex(
                name: "IX_NutritionPushReminderDeliveries_User_Device_Date",
                table: "NutritionPushReminderDeliveries",
                columns: new[] { "UserId", "DeviceId", "ReminderDate" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_NutritionPushSubscriptions_UpdatedAt",
                table: "NutritionPushSubscriptions",
                column: "UpdatedAt");

            migrationBuilder.CreateIndex(
                name: "IX_NutritionPushSubscriptions_UserId_DeviceId",
                table: "NutritionPushSubscriptions",
                columns: new[] { "UserId", "DeviceId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "NutritionCheckInReminderPreferences");

            migrationBuilder.DropTable(
                name: "NutritionPushReminderDeliveries");

            migrationBuilder.DropTable(
                name: "NutritionPushSubscriptions");
        }
    }
}
