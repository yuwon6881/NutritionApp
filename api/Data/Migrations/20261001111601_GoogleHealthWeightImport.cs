using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nutrition.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class GoogleHealthWeightImport : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ExternalId",
                table: "Weights",
                type: "character varying(256)",
                maxLength: 256,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Source",
                table: "Weights",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "manual");

            migrationBuilder.AddColumn<bool>(
                name: "WeightImportEnabled",
                table: "GoogleHealthConnections",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "WeightImportFailureCode",
                table: "GoogleHealthConnections",
                type: "character varying(64)",
                maxLength: 64,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "WeightImportFailureMessage",
                table: "GoogleHealthConnections",
                type: "character varying(300)",
                maxLength: 300,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<DateTime>(
                name: "WeightImportLastAttemptAt",
                table: "GoogleHealthConnections",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "WeightImportLastCount",
                table: "GoogleHealthConnections",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<DateTime>(
                name: "WeightImportLastSuccessAt",
                table: "GoogleHealthConnections",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<long>(
                name: "WeightImportRevision",
                table: "GoogleHealthConnections",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddCheckConstraint(
                name: "CK_Weights_Source",
                table: "Weights",
                sql: "\"Source\" IN ('manual', 'google_health')");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_Weights_Source",
                table: "Weights");

            migrationBuilder.DropColumn(
                name: "ExternalId",
                table: "Weights");

            migrationBuilder.DropColumn(
                name: "Source",
                table: "Weights");

            migrationBuilder.DropColumn(
                name: "WeightImportEnabled",
                table: "GoogleHealthConnections");

            migrationBuilder.DropColumn(
                name: "WeightImportFailureCode",
                table: "GoogleHealthConnections");

            migrationBuilder.DropColumn(
                name: "WeightImportFailureMessage",
                table: "GoogleHealthConnections");

            migrationBuilder.DropColumn(
                name: "WeightImportLastAttemptAt",
                table: "GoogleHealthConnections");

            migrationBuilder.DropColumn(
                name: "WeightImportLastCount",
                table: "GoogleHealthConnections");

            migrationBuilder.DropColumn(
                name: "WeightImportLastSuccessAt",
                table: "GoogleHealthConnections");

            migrationBuilder.DropColumn(
                name: "WeightImportRevision",
                table: "GoogleHealthConnections");
        }
    }
}
