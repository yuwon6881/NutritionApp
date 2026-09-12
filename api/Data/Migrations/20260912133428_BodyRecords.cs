using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nutrition.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class BodyRecords : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "BodyRecords",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Date = table.Column<DateOnly>(type: "date", nullable: false),
                    CreationOrder = table.Column<long>(type: "bigint", nullable: false),
                    Created = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Updated = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    NeckCm = table.Column<double>(type: "double precision", nullable: true),
                    ShouldersCm = table.Column<double>(type: "double precision", nullable: true),
                    ChestCm = table.Column<double>(type: "double precision", nullable: true),
                    WaistCm = table.Column<double>(type: "double precision", nullable: true),
                    HipsCm = table.Column<double>(type: "double precision", nullable: true),
                    LeftBicepsCm = table.Column<double>(type: "double precision", nullable: true),
                    RightBicepsCm = table.Column<double>(type: "double precision", nullable: true),
                    LeftForearmCm = table.Column<double>(type: "double precision", nullable: true),
                    RightForearmCm = table.Column<double>(type: "double precision", nullable: true),
                    LeftThighCm = table.Column<double>(type: "double precision", nullable: true),
                    RightThighCm = table.Column<double>(type: "double precision", nullable: true),
                    LeftCalfCm = table.Column<double>(type: "double precision", nullable: true),
                    RightCalfCm = table.Column<double>(type: "double precision", nullable: true),
                    BodyFatPercent = table.Column<double>(type: "double precision", nullable: true),
                    WeightContextJson = table.Column<string>(type: "text", nullable: false),
                    PendingPhotosJson = table.Column<string>(type: "text", nullable: false),
                    Revision = table.Column<long>(type: "bigint", nullable: false),
                    Deleted = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_BodyRecords", x => new { x.UserId, x.Id });
                    table.ForeignKey(
                        name: "FK_BodyRecords_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_BodyRecords_UserId_CreationOrder",
                table: "BodyRecords",
                columns: new[] { "UserId", "CreationOrder" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_BodyRecords_UserId_Deleted_Date_CreationOrder",
                table: "BodyRecords",
                columns: new[] { "UserId", "Deleted", "Date", "CreationOrder" });

            // Existing photo sets predate BodyRecord rows. Preserve their set
            // identities and dates while leaving all measurements and weight
            // context explicitly unavailable.
            migrationBuilder.Sql("""
                INSERT INTO "BodyRecords" ("Id", "UserId", "Date", "CreationOrder", "Created", "Updated", "WeightContextJson", "PendingPhotosJson", "Revision", "Deleted")
                SELECT "SetId", "UserId", MAX("Date"),
                       ROW_NUMBER() OVER (PARTITION BY "UserId" ORDER BY MAX("Date"), "SetId"),
                       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, '{}', '[]', 0, FALSE
                FROM "Photos"
                WHERE NOT "Deleted" AND "SetId" <> '00000000-0000-0000-0000-000000000000'::uuid
                GROUP BY "UserId", "SetId"
                ON CONFLICT ("UserId", "Id") DO NOTHING;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "BodyRecords");
        }
    }
}
