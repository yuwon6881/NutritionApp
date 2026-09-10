using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nutrition.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class UnitsAndPhysiquePhotoSets : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Caption",
                table: "Photos");

            migrationBuilder.AddColumn<string>(
                name: "EnergyUnit",
                table: "Users",
                type: "text",
                nullable: false,
                defaultValue: "kcal");

            migrationBuilder.AddColumn<string>(
                name: "HeightUnit",
                table: "Users",
                type: "text",
                nullable: false,
                defaultValue: "cm");

            migrationBuilder.AddColumn<string>(
                name: "WeightUnit",
                table: "Users",
                type: "text",
                nullable: false,
                defaultValue: "kg");

            migrationBuilder.AddColumn<Guid>(
                name: "SetId",
                table: "Photos",
                type: "uuid",
                nullable: false,
                defaultValue: new Guid("00000000-0000-0000-0000-000000000000"));

            migrationBuilder.Sql("UPDATE \"Photos\" SET \"SetId\" = \"Id\" WHERE \"SetId\" = '00000000-0000-0000-0000-000000000000';");

            migrationBuilder.CreateIndex(
                name: "IX_Photos_UserId_SetId",
                table: "Photos",
                columns: new[] { "UserId", "SetId" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Photos_UserId_SetId",
                table: "Photos");

            migrationBuilder.DropColumn(
                name: "EnergyUnit",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "HeightUnit",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "WeightUnit",
                table: "Users");

            migrationBuilder.DropColumn(
                name: "SetId",
                table: "Photos");

            migrationBuilder.AddColumn<string>(
                name: "Caption",
                table: "Photos",
                type: "text",
                nullable: false,
                defaultValue: "");
        }
    }
}
