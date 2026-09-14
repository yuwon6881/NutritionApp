using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Nutrition.Api.Data;

#nullable disable

namespace Nutrition.Api.Data.Migrations;

[DbContext(typeof(AppDb))]
[Migration("20260914120000_FoodBarcodes")]
public partial class FoodBarcodes : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<string>(
            name: "Barcode",
            table: "Foods",
            type: "text",
            nullable: true);

        migrationBuilder.CreateIndex(
            name: "IX_Foods_UserId_Barcode_Deleted",
            table: "Foods",
            columns: new[] { "UserId", "Barcode", "Deleted" });
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropIndex(
            name: "IX_Foods_UserId_Barcode_Deleted",
            table: "Foods");

        migrationBuilder.DropColumn(
            name: "Barcode",
            table: "Foods");
    }
}
