using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nutrition.Api.Data.Migrations;

[DbContext(typeof(AppDb))]
[Migration("20260913000000_UserMissingDayAction")]
public partial class UserMissingDayAction : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<string>(
            name: "MissingDayAction",
            table: "Users",
            type: "text",
            nullable: false,
            defaultValue: "ask");
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropColumn(
            name: "MissingDayAction",
            table: "Users");
    }
}
