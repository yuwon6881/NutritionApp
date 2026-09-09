using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nutrition.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class CoachCheckInsAndPhaseDecisions : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "CheckIns",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    WeekStart = table.Column<DateOnly>(type: "date", nullable: false),
                    Date = table.Column<DateOnly>(type: "date", nullable: false),
                    Decision = table.Column<string>(type: "text", nullable: false),
                    InputRevision = table.Column<long>(type: "bigint", nullable: false),
                    ResultJson = table.Column<string>(type: "text", nullable: false),
                    Revision = table.Column<long>(type: "bigint", nullable: false),
                    Deleted = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CheckIns", x => new { x.UserId, x.Id });
                    table.ForeignKey(
                        name: "FK_CheckIns_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "PhaseDecisions",
                columns: table => new
                {
                    Id = table.Column<Guid>(type: "uuid", nullable: false),
                    UserId = table.Column<Guid>(type: "uuid", nullable: false),
                    Date = table.Column<DateOnly>(type: "date", nullable: false),
                    ProfileRevision = table.Column<long>(type: "bigint", nullable: false),
                    ReachedBy = table.Column<string>(type: "text", nullable: false),
                    Decision = table.Column<string>(type: "text", nullable: false),
                    Revision = table.Column<long>(type: "bigint", nullable: false),
                    Deleted = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PhaseDecisions", x => new { x.UserId, x.Id });
                    table.ForeignKey(
                        name: "FK_PhaseDecisions_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_CheckIns_UserId_WeekStart",
                table: "CheckIns",
                columns: new[] { "UserId", "WeekStart" });

            migrationBuilder.CreateIndex(
                name: "IX_PhaseDecisions_UserId_ProfileRevision",
                table: "PhaseDecisions",
                columns: new[] { "UserId", "ProfileRevision" },
                unique: true);

            if (migrationBuilder.ActiveProvider == "Microsoft.EntityFrameworkCore.Sqlite")
            {
                migrationBuilder.Sql("""
                    INSERT INTO "PhaseDecisions" ("UserId", "Id", "Date", "ProfileRevision", "ReachedBy", "Decision", "Revision", "Deleted")
                    SELECT "UserId", "Id", "Date", "ProfileRevision",
                           COALESCE(json_extract("ResultJson", '$.goalProgress.reachedBy'), 'legacy'),
                           'completed', "Revision", 0
                    FROM (
                        SELECT p.*, ROW_NUMBER() OVER (PARTITION BY "UserId" ORDER BY "Revision" DESC) AS row_number
                        FROM "Plans" p
                    ) latest
                    WHERE row_number = 1
                      AND COALESCE(json_extract("ResultJson", '$.phaseComplete'), 0) = 1
                    ON CONFLICT ("UserId", "ProfileRevision") DO NOTHING;
                    """);
            }
            else
            {
                migrationBuilder.Sql("""
                    INSERT INTO "PhaseDecisions" ("UserId", "Id", "Date", "ProfileRevision", "ReachedBy", "Decision", "Revision", "Deleted")
                    SELECT p."UserId", p."Id", p."Date", p."ProfileRevision",
                           COALESCE(p."ResultJson"::jsonb #>> '{goalProgress,reachedBy}', 'legacy'),
                           'completed', p."Revision", false
                    FROM (
                        SELECT DISTINCT ON ("UserId") *
                        FROM "Plans"
                        ORDER BY "UserId", "Revision" DESC
                    ) p
                    WHERE COALESCE((p."ResultJson"::jsonb ->> 'phaseComplete')::boolean, false)
                    ON CONFLICT ("UserId", "ProfileRevision") DO NOTHING;
                    """);
            }
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CheckIns");

            migrationBuilder.DropTable(
                name: "PhaseDecisions");
        }
    }
}
