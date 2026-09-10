using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nutrition.Api.Data.Migrations;

public partial class FoodPortions : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<double?>(
            name: "PortionGrams",
            table: "Entries",
            nullable: true);

        migrationBuilder.AddColumn<string>(
            name: "PortionLabel",
            table: "Entries",
            nullable: true);

        migrationBuilder.AddColumn<string>(
            name: "PortionsJson",
            table: "Foods",
            nullable: false,
            defaultValue: "[]");
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropColumn(name: "PortionGrams", table: "Entries");
        migrationBuilder.DropColumn(name: "PortionLabel", table: "Entries");
        migrationBuilder.DropColumn(name: "PortionsJson", table: "Foods");
    }
}
