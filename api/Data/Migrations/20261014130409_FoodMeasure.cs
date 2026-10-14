using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nutrition.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class FoodMeasure : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "Measure",
                table: "Foods",
                type: "character varying(2)",
                maxLength: 2,
                nullable: false,
                defaultValue: "g");

            migrationBuilder.AddColumn<string>(
                name: "Measure",
                table: "Entries",
                type: "character varying(2)",
                maxLength: 2,
                nullable: false,
                defaultValue: "g");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Measure",
                table: "Foods");

            migrationBuilder.DropColumn(
                name: "Measure",
                table: "Entries");
        }
    }
}
