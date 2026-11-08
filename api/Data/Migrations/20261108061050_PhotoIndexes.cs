using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nutrition.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class PhotoIndexes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "IX_Photos_Status_Created",
                table: "Photos",
                columns: new[] { "Status", "Created" },
                filter: "\"Status\" IN ('deleting','uploading')");

            migrationBuilder.CreateIndex(
                name: "IX_Photos_UserId_Deleted_Status_Date_SetId",
                table: "Photos",
                columns: new[] { "UserId", "Deleted", "Status", "Date", "SetId" })
                .Annotation("Npgsql:IndexInclude", new[] { "Bytes" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Photos_Status_Created",
                table: "Photos");

            migrationBuilder.DropIndex(
                name: "IX_Photos_UserId_Deleted_Status_Date_SetId",
                table: "Photos");
        }
    }
}
