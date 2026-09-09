using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nutrition.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class ContinuousCoachingTrajectory : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "CheckInWeekday",
                table: "Users",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddColumn<DateOnly>(
                name: "CoachingSettingsChangedDate",
                table: "Users",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "CoachingSettingsRevision",
                table: "Users",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<long>(
                name: "TrajectoryRevision",
                table: "Users",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<int>(
                name: "CheckInWeekday",
                table: "Plans",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.AddColumn<long>(
                name: "CoachingSettingsRevision",
                table: "Plans",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<int>(
                name: "CheckInWeekday",
                table: "CheckIns",
                type: "integer",
                nullable: false,
                defaultValue: 1);

            migrationBuilder.CreateTable(
                name: "DailyExpenditureEstimates",
                columns: table => new
                {
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Date = table.Column<DateOnly>(type: "date", nullable: false),
                    Expenditure = table.Column<double>(type: "double precision", nullable: true),
                    SuggestedCalories = table.Column<int>(type: "integer", nullable: true),
                    Confidence = table.Column<double>(type: "double precision", nullable: false),
                    HoldReason = table.Column<string>(type: "text", nullable: true),
                    SourceRevision = table.Column<long>(type: "bigint", nullable: false),
                    AlgorithmVersion = table.Column<string>(type: "text", nullable: false),
                    Observed = table.Column<double>(type: "double precision", nullable: true),
                    Gain = table.Column<double>(type: "double precision", nullable: false),
                    TrendWeightKg = table.Column<double>(type: "double precision", nullable: true),
                    EffectiveGoal = table.Column<string>(type: "text", nullable: false),
                    GoalRatePercent = table.Column<double>(type: "double precision", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DailyExpenditureEstimates", x => new { x.UserId, x.Date });
                    table.CheckConstraint("CK_DailyExpenditureEstimates_Confidence", "\"Confidence\" >= 0 AND \"Confidence\" <= 1");
                    table.CheckConstraint("CK_DailyExpenditureEstimates_Expenditure", "\"Expenditure\" IS NULL OR \"Expenditure\" >= 0");
                    table.CheckConstraint("CK_DailyExpenditureEstimates_SuggestedCalories", "\"SuggestedCalories\" IS NULL OR \"SuggestedCalories\" >= 0");
                    table.ForeignKey(
                        name: "FK_DailyExpenditureEstimates_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_DailyExpenditureEstimates_UserId_Date",
                table: "DailyExpenditureEstimates",
                columns: new[] { "UserId", "Date" });

            migrationBuilder.CreateIndex(
                name: "IX_DailyExpenditureEstimates_UserId_SourceRevision",
                table: "DailyExpenditureEstimates",
                columns: new[] { "UserId", "SourceRevision" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "DailyExpenditureEstimates");

            migrationBuilder.DropColumn(
                name: "CheckInWeekday",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "CoachingSettingsChangedDate",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "CoachingSettingsRevision",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "TrajectoryRevision",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "CheckInWeekday",
                table: "Plans");

            migrationBuilder.DropColumn(
                name: "CoachingSettingsRevision",
                table: "Plans");

            migrationBuilder.DropColumn(
                name: "CheckInWeekday",
                table: "CheckIns");
        }
    }
}
