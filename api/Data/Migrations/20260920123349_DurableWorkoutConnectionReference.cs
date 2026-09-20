using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nutrition.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class DurableWorkoutConnectionReference : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<Guid>(
                name: "CentralConnectionId",
                table: "IntegrationGrants",
                type: "uuid",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "CentralGeneration",
                table: "IntegrationGrants",
                type: "bigint",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CentralConnectionId",
                table: "IntegrationGrants");

            migrationBuilder.DropColumn(
                name: "CentralGeneration",
                table: "IntegrationGrants");
        }
    }
}
