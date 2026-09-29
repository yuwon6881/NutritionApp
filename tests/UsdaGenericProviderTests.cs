using System.IO.Compression;
using System.Text;
using Nutrition.Api.Services.FoodLookup;
using Xunit;

namespace Nutrition.Tests;

public sealed class UsdaGenericProviderTests
{
    // Trimmed rows in the generator's output shape; fiber is absent on the grilled chicken.
    private const string Fixture="""
        {"source":"USDA FoodData Central","releases":{"SR Legacy":"2018-04"},"foods":[
          {"id":1,"n":"Bananas, raw","k":89,"p":1.09,"f":0.33,"c":22.8,"fi":2.6,"s":[["1 medium",118],["1 cup, sliced",150]]},
          {"id":2,"n":"Bread, banana, prepared from recipe","k":326,"p":4.3,"f":10.5,"c":54.6,"fi":1.1},
          {"id":3,"n":"Eggplant, raw","k":25,"p":0.98,"f":0.18,"c":5.88,"fi":3},
          {"id":4,"n":"Egg, whole, boiled or poached","k":143,"p":12.4,"f":9.96,"c":0.96,"fi":0,"s":[["1 egg",50]]},
          {"id":5,"n":"Chicken, broiler or fryers, breast, skinless, boneless, meat only, cooked, grilled","k":151,"p":30.5,"f":3.17,"c":0,"s":[["1 piece",196]]},
          {"id":6,"n":"Tomatoes, red, ripe, raw","k":18,"p":0.88,"f":0.2,"c":3.89,"fi":1.2}
        ]}
        """;

    private static UsdaGenericProvider Provider(string json=Fixture)
    {
        var buffer=new MemoryStream();
        using(var gzip=new GZipStream(buffer,CompressionLevel.Fastest,leaveOpen:true))
            gzip.Write(Encoding.UTF8.GetBytes(json));
        buffer.Position=0;
        return new UsdaGenericProvider(UsdaGenericDataset.Load(buffer));
    }

    private static async Task<IReadOnlyList<FoodResult>> Search(string query)
        =>await Provider().Search(query,null,default);

    [Fact]
    public async Task A_match_keeps_nutrients_portions_and_attribution()
    {
        var banana=(await Search("banana"))[0];

        Assert.Equal("Bananas, raw",banana.Name);
        Assert.Equal(89,banana.Calories);
        Assert.Equal(2.6,banana.Fiber);
        Assert.Equal("USDA FoodData Central",banana.Source);
        Assert.Equal("per100g",banana.Basis);
        Assert.Null(banana.Code);
        Assert.True(banana.IsGeneric);
        Assert.Equal([new FoodPortion("1 medium",118),new FoodPortion("1 cup, sliced",150)],banana.Portions);
        Assert.Equal(89*118/100.0,banana.ServingCalories);
    }

    [Fact]
    public async Task A_missing_nutrient_stays_unknown()
    {
        var chicken=Assert.Single(await Search("grilled chicken breast"));

        Assert.Null(chicken.Fiber);
        Assert.Equal(0,chicken.Carbs);
    }

    [Fact]
    public async Task Plural_and_singular_names_match_each_other()
    {
        Assert.Equal("Tomatoes, red, ripe, raw",Assert.Single(await Search("tomato")).Name);
        Assert.Equal("Egg, whole, boiled or poached",(await Search("eggs"))[0].Name);
    }

    [Fact]
    public async Task A_food_named_by_the_query_ranks_ahead_of_one_that_contains_it()
    {
        Assert.Equal(["Bananas, raw","Bread, banana, prepared from recipe"],(await Search("banana")).Select(result=>result.Name));
        Assert.Equal("Egg, whole, boiled or poached",(await Search("egg"))[0].Name);
    }

    [Fact]
    public async Task No_match_is_an_empty_answer()
    {
        Assert.Empty(await Search("nasi lemak"));
    }

    [Fact]
    public async Task The_bundled_dataset_loads_and_answers_common_foods()
    {
        var dataset=UsdaGenericDataset.Embedded();

        Assert.NotNull(dataset);
        Assert.True(dataset!.Count>10000);
        var results=await new UsdaGenericProvider(dataset).Search("banana",null,default);
        Assert.Contains(results,result=>result.Name.StartsWith("Banana",StringComparison.Ordinal)&&result.Portions?.Count>0);
    }
}
