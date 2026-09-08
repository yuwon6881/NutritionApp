using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nutrition.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class CascadeUserDeletes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Rows orphaned before these foreign keys existed would block them; they belong to no account.
            migrationBuilder.Sql("DELETE FROM \"Sessions\" WHERE \"UserId\" NOT IN (SELECT \"Id\" FROM \"Users\")");
            migrationBuilder.Sql("DELETE FROM \"Receipts\" WHERE \"UserId\" NOT IN (SELECT \"Id\" FROM \"Users\")");
            migrationBuilder.Sql("DELETE FROM \"Usage\" WHERE \"UserId\" NOT IN (SELECT \"Id\" FROM \"Users\")");

            migrationBuilder.CreateIndex(
                name: "IX_Sessions_UserId",
                table: "Sessions",
                column: "UserId");

            migrationBuilder.AddForeignKey(
                name: "FK_Receipts_Users_UserId",
                table: "Receipts",
                column: "UserId",
                principalTable: "Users",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_Sessions_Users_UserId",
                table: "Sessions",
                column: "UserId",
                principalTable: "Users",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_Usage_Users_UserId",
                table: "Usage",
                column: "UserId",
                principalTable: "Users",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Receipts_Users_UserId",
                table: "Receipts");

            migrationBuilder.DropForeignKey(
                name: "FK_Sessions_Users_UserId",
                table: "Sessions");

            migrationBuilder.DropForeignKey(
                name: "FK_Usage_Users_UserId",
                table: "Usage");

            migrationBuilder.DropIndex(
                name: "IX_Sessions_UserId",
                table: "Sessions");
        }
    }
}
