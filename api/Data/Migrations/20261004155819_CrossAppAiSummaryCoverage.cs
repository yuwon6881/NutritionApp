using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nutrition.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class CrossAppAiSummaryCoverage : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateOnly>(
                name: "CoverageFrom",
                table: "WorkoutSummaries",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CoverageTimeZone",
                table: "WorkoutSummaries",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "CoverageTo",
                table: "WorkoutSummaries",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "SummarySchemaVersion",
                table: "WorkoutSummaries",
                type: "integer",
                nullable: false,
                defaultValue: 0);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CoverageFrom",
                table: "WorkoutSummaries");

            migrationBuilder.DropColumn(
                name: "CoverageTimeZone",
                table: "WorkoutSummaries");

            migrationBuilder.DropColumn(
                name: "CoverageTo",
                table: "WorkoutSummaries");

            migrationBuilder.DropColumn(
                name: "SummarySchemaVersion",
                table: "WorkoutSummaries");
        }
    }
}
