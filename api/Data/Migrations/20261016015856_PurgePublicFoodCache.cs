using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nutrition.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class PurgePublicFoodCache : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // Public product rows cached while results carried a measure but before a serving label's
            // millilitre amount decided it still say "g" for drinks. The cache only holds public provider
            // data and is rebuilt from the provider on the next lookup.
            migrationBuilder.Sql("DELETE FROM \"PublicFoodProducts\"");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {

        }
    }
}
