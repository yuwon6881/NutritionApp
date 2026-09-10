using Nutrition.Api.Services;
using Xunit;

namespace Nutrition.Tests;

public sealed class CsvTests
{
    [Fact]
    public void Escapes_text_and_neutralizes_formula_prefixes_without_changing_numeric_values()
    {
        Assert.Equal("'=-250", Csv.Field("=-250"));
        Assert.Equal("'@name", Csv.Field("@name"));
        Assert.Equal("\"rice, \"\"jasmine\"\"\"", Csv.Field("rice, \"jasmine\""));
        Assert.Equal("-250", Csv.Field(-250));
        Assert.Equal("", Csv.Field((double?)null));
        Assert.Equal("a,b\r\n", Csv.Line(Csv.Field("a"), Csv.Field("b")));
    }
}
