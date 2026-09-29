using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nutrition.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class PublicFoodProductProvider : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropPrimaryKey(
                name: "PK_PublicFoodProducts",
                table: "PublicFoodProducts");

            migrationBuilder.AddColumn<string>(
                name: "ProviderId",
                table: "PublicFoodProducts",
                type: "character varying(32)",
                maxLength: 32,
                nullable: false,
                // Every row cached before this migration came from Open Food Facts.
                defaultValue: "off");

            migrationBuilder.AddPrimaryKey(
                name: "PK_PublicFoodProducts",
                table: "PublicFoodProducts",
                columns: new[] { "ProviderId", "Code" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // The old key is the code alone. Other providers' rows are a rebuildable cache.
            migrationBuilder.Sql("DELETE FROM \"PublicFoodProducts\" WHERE \"ProviderId\" <> 'off';");

            migrationBuilder.DropPrimaryKey(
                name: "PK_PublicFoodProducts",
                table: "PublicFoodProducts");

            migrationBuilder.DropColumn(
                name: "ProviderId",
                table: "PublicFoodProducts");

            migrationBuilder.AddPrimaryKey(
                name: "PK_PublicFoodProducts",
                table: "PublicFoodProducts",
                column: "Code");
        }
    }
}
