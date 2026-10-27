using System.IO.Compression;
using System.Text;
using Nutrition.Api.Services.FoodLookup;
using Xunit;

namespace Nutrition.Tests;

public sealed class OpenFoodFactsBundledProviderTests
{
    // Rows in the generator's output shape: a drink per 100 ml, a bread with a named serving, and a
    // product with no brand, no serving and no fibre.
    private const string Fixture="""
        {"source":"Open Food Facts","licence":"ODbL 1.0","exported":"2026-10-27","countries":["en:malaysia"],"foods":[
          {"code":"9556404123223","n":"Strawberry milk","b":"Dutch Lady","k":51,"p":2.6,"f":1.3,"c":7.2,"m":"ml","s":[["1 box (200 ml)",200]]},
          {"code":"9556208000017","n":"Roti Putih Original Classic Jumbo","b":"Gardenia","k":284,"p":9.21,"f":3.65,"c":52.5,"fi":2.4,"s":[["serving",63]]},
          {"code":"9557305000309","n":"Kaya","k":265,"p":2.6,"f":2.5,"c":55.6},
          {"code":"8888026520014","n":"Milk tea","b":"Kaya Toast Co","k":40,"p":1,"f":1,"c":7,"m":"ml"}
        ]}
        """;

    private static OpenFoodFactsBundledProvider Provider()
    {
        var buffer=new MemoryStream();
        using(var gzip=new GZipStream(buffer,CompressionLevel.Fastest,leaveOpen:true))
            gzip.Write(Encoding.UTF8.GetBytes(Fixture));
        buffer.Position=0;
        return new OpenFoodFactsBundledProvider(OpenFoodFactsDataset.Load(buffer));
    }

    private static async Task<IReadOnlyList<FoodResult>> Search(string query)=>await Provider().Search(query,null,default);

    [Fact]
    public async Task A_bundled_row_is_complete_without_a_confirming_read()
    {
        var milk=Assert.Single(await Search("strawberry milk"));

        Assert.Equal("Strawberry milk · Dutch Lady",milk.Name);
        Assert.Equal("per100g",milk.Basis);
        Assert.Equal("ml",milk.Measure);
        Assert.Equal(51,milk.Calories);
        Assert.Equal(2.6,milk.Protein);
        Assert.Equal("9556404123223",milk.Code);
        Assert.Equal("Open Food Facts / ODbL / 9556404123223",milk.Source);
        var serving=Assert.Single(milk.Portions!);
        Assert.Equal(("1 box (200 ml)",200d),(serving.Label,serving.Grams));
        Assert.Equal(102,milk.ServingCalories);
    }

    [Fact]
    public async Task Missing_values_stay_unknown_and_a_product_without_a_serving_has_no_portion()
    {
        var kaya=(await Search("kaya"))[0];

        Assert.Equal("Kaya",kaya.Name);
        Assert.Equal("g",kaya.Measure);
        Assert.Null(kaya.Fiber);
        Assert.Empty(kaya.Portions!);
    }

    [Fact]
    public async Task A_brand_finds_its_products_but_a_name_match_ranks_first()
    {
        Assert.Equal("Roti Putih Original Classic Jumbo · Gardenia",Assert.Single(await Search("gardenia")).Name);
        // "Kaya" names the spread; the milk tea only carries the word in its brand.
        Assert.Equal(["Kaya","Milk tea · Kaya Toast Co"],(await Search("kaya")).Select(result=>result.Name));
    }

    [Fact]
    public async Task The_embedded_export_loads_and_answers_regional_products()
    {
        var dataset=OpenFoodFactsDataset.Embedded();

        Assert.NotNull(dataset);
        Assert.True(dataset!.Count>10000);
        var results=await new OpenFoodFactsBundledProvider(dataset).Search("milo",null,default);
        Assert.NotEmpty(results);
        Assert.All(results,result=>Assert.Equal("per100g",result.Basis));
    }
}
