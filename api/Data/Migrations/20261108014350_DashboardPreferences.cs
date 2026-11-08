using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nutrition.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class DashboardPreferences : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "EnergyChartView",
                table: "Users",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "EnergyPeriod",
                table: "Users",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ProgressTab",
                table: "Users",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "WeightChartView",
                table: "Users",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "WeightPeriod",
                table: "Users",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "EnergyChartView",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "EnergyPeriod",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "ProgressTab",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "WeightChartView",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "WeightPeriod",
                table: "Users");
        }
    }
}
