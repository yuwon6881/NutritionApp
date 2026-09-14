using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Nutrition.Api.Data.Migrations;

[DbContext(typeof(AppDb))]
[Migration("20260914110000_UserWeightGoalMetric")]
public partial class UserWeightGoalMetric : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<string>(
            name: "WeightGoalMetric",
            table: "Users",
            type: "text",
            nullable: false,
            defaultValue: "scale");
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropColumn(
            name: "WeightGoalMetric",
            table: "Users");
    }
}
