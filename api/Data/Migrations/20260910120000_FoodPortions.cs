using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nutrition.Api.Data.Migrations;

[DbContext(typeof(AppDb))]
[Migration("20260910120000_FoodPortions")]
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
