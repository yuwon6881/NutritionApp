using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nutrition.Api.Data.Migrations;

[DbContext(typeof(AppDb))]
[Migration("20260911120000_DropEntryMeal")]
public partial class DropEntryMeal : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropColumn(name: "Meal", table: "Entries");
    }

    // Restoring the column cannot restore the labels it held; every reverted row reads "Meal".
    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<string>(
            name: "Meal",
            table: "Entries",
            nullable: false,
            defaultValue: "Meal");
    }
}
