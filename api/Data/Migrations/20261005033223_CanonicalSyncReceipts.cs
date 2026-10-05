using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nutrition.Api.Data.Migrations
{
    /// <inheritdoc />
    public partial class CanonicalSyncReceipts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(name:"CanonicalJson",table:"Receipts",type:"text",nullable:true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(name:"CanonicalJson",table:"Receipts");
        }
    }
}
