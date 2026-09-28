using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nutrition.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class MoveNutritionCheckInRemindersToEightAm : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("""
                UPDATE "NutritionCheckInReminderPreferences"
                SET "LocalTime" = TIME '08:00:00'
                WHERE "LocalTime" = TIME '19:00:00';
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // A reminder may have been edited after this migration. Do not rewrite it on rollback.
        }
    }
}
