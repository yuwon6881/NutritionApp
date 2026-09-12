using System.Net;
using System.Text.Json;
using Nutrition.Api.Data;
using Nutrition.Api.Domain;
using Nutrition.Api.Services;
using Xunit;

namespace Nutrition.Tests;

public sealed class FoodSearchTests
{
    // Shapes below are trimmed from live Open Food Facts responses. The two sources disagree: the
    // search index sends brands as an array and indexes no serving at all, while the product
    // endpoint sends brands as one comma string and serving_quantity as a string.
    private static JsonElement Product(string json)=>JsonDocument.Parse(json).RootElement;

    private static FoodResult Result(string name,IReadOnlyList<FoodPortion>? portions=null)
        =>new(name,100,null,null,null,null,"test",100,portions);

    [Fact]
    public void A_search_hit_keeps_its_nutrients_and_attribution()
    {
        var hit=Product("""
            {"code":"4056489127277","product_name":"Culinea Nasi Goreng","brands":["Chef Select","Lidl"],
             "nutriments":{"energy-kcal_100g":102,"proteins_100g":3.4,"fat_100g":2.1,"carbohydrates_100g":13.5,"fiber_100g":1.2}}
            """);

        var result=FoodSearchService.ReadProduct(hit,null)!;

        Assert.Equal("Culinea Nasi Goreng · Chef Select",result.Name);
        Assert.Equal(102,result.Calories);
        Assert.Equal(3.4,result.Protein);
        Assert.Equal(13.5,result.Carbs);
        Assert.Equal("Open Food Facts / ODbL / 4056489127277",result.Source);
        Assert.Equal(100,result.ServingGrams);
        Assert.Equal("4056489127277",result.Code);
    }

    [Fact]
    public void A_search_hit_carries_no_portion_because_the_index_holds_no_serving()
    {
        var hit=Product("""
            {"code":"5400141234633","product_name":"Nasi goreng","brands":["Colruyt"],"quantity":"400 g",
             "nutriments":{"energy-kcal_100g":101,"proteins_100g":5.7}}
            """);

        Assert.Empty(FoodSearchService.ReadProduct(hit,null)!.Portions!);
    }

    [Fact]
    public void A_hit_named_only_in_english_is_kept_rather_than_dropped()
    {
        var hit=Product("""{"code":"1","product_name_en":"Fried rice","nutriments":{"energy-kcal_100g":150}}""");

        Assert.Equal("Fried rice",FoodSearchService.ReadProduct(hit,null)!.Name);
    }

    [Theory]
    [InlineData("""{"brands":"Lidl, Toque du Chef"}""","Lidl, Toque du Chef")]
    [InlineData("""{"brands":["Chef Select","Lidl"]}""","Chef Select")]
    [InlineData("""{"brands":["","Lidl"]}""","Lidl")]
    [InlineData("""{"brands":[]}""",null)]
    [InlineData("""{"brands":null}""",null)]
    [InlineData("""{}""",null)]
    public void Both_brand_shapes_reduce_to_the_leading_brand(string json,string? expected)
        => Assert.Equal(expected,FoodSearchService.Brand(Product(json)));

    [Fact]
    public void A_scanned_product_still_reads_its_comma_separated_brands()
    {
        var product=Product("""
            {"product_name":"Nasi Goreng","brands":"Chef Select,Lidl","serving_size":"375 g",
             "serving_quantity":"375","serving_quantity_unit":"g","nutriments":{"energy-kcal_100g":102}}
            """);

        var result=FoodSearchService.ReadProduct(product,"4056489127277")!;

        Assert.Equal("Nasi Goreng · Chef Select",result.Name);
        var portion=Assert.Single(result.Portions!);
        Assert.Equal("375 g",portion.Label);
        Assert.Equal(375,portion.Grams);
        Assert.Equal(382.5,result.ServingCalories);
    }

    [Fact]
    public void A_search_hit_without_calories_is_dropped_rather_than_logged_as_zero()
    {
        var hit=Product("""{"code":"8716425003183","product_name":"nasi","nutriments":{"proteins_100g":3}}""");

        Assert.Null(FoodSearchService.ReadProduct(hit,null));
    }

    [Fact]
    public void A_search_hit_without_a_name_is_dropped()
    {
        var hit=Product("""{"code":"1","nutriments":{"energy-kcal_100g":120}}""");

        Assert.Null(FoodSearchService.ReadProduct(hit,null));
    }

    [Fact]
    public void A_scanned_product_keeps_a_generic_name_and_its_own_code()
    {
        var product=Product("""{"nutriments":{"energy-kcal_100g":467},"serving_quantity":"30","serving_quantity_unit":"g","serving_size":"2 COOKIES (30 g)"}""");

        var result=FoodSearchService.ReadProduct(product,"0072417201882")!;

        Assert.Equal("Packaged food",result.Name);
        Assert.Equal("Open Food Facts / ODbL / 0072417201882",result.Source);
        Assert.Equal(30,Assert.Single(result.Portions!).Grams);
    }

    [Theory]
    [InlineData("Nasi Goreng","Lidl, Toque du Chef","Nasi Goreng · Lidl")]
    [InlineData("Nasi Goreng",null,"Nasi Goreng")]
    [InlineData("Nasi Goreng","","Nasi Goreng")]
    [InlineData("Lidl Nasi Goreng","Lidl","Lidl Nasi Goreng")]
    public void The_leading_brand_disambiguates_repeated_product_names(string name,string? brands,string expected)
        => Assert.Equal(expected,FoodSearchService.Label(name,brands));

    [Fact]
    public void A_label_stays_within_the_name_length_a_saved_food_accepts()
    {
        var label=FoodSearchService.Label(new string('a',150),new string('b',80));

        Assert.Equal(160,label.Length);
        Validation.Nutrients(new Food{Name=label,Calories=100,Source="Open Food Facts / ODbL"});
    }

    [Fact]
    public void A_serving_measured_in_millilitres_yields_no_portion()
    {
        var product=Product("""{"serving_quantity":1000,"serving_quantity_unit":"ml","serving_size":"1l"}""");

        Assert.Empty(FoodSearchService.MapPortions(product));
    }

    [Fact]
    public void A_serving_without_a_normalized_unit_requires_grams_in_its_label()
    {
        var product=Product("""{"serving_quantity":30,"serving_size":"1 biscuit (30 g)"}""");

        Assert.Equal(30,Assert.Single(FoodSearchService.MapPortions(product)).Grams);
    }

    [Theory]
    [InlineData("1 scoop")]
    [InlineData("30 ml")]
    [InlineData("")]
    [InlineData("15 g")]
    public void An_ambiguous_or_conflicting_serving_weight_is_not_assumed_to_be_grams(string label)
    {
        var product=Product(JsonSerializer.Serialize(new {serving_quantity=30,serving_size=label}));
        Assert.Empty(FoodSearchService.MapPortions(product));
    }

    [Fact]
    public void A_serving_without_a_label_is_named_rather_than_left_blank()
    {
        var product=Product("""{"serving_quantity":45,"serving_quantity_unit":"g"}""");

        Assert.Equal("serving",Assert.Single(FoodSearchService.MapPortions(product)).Label);
    }

    [Fact]
    public void An_absent_serving_leaves_the_food_without_portions()
    {
        var product=Product("""{"product_name":"Nasi Goreng","nutriments":{"energy-kcal_100g":92}}""");

        Assert.Empty(FoodSearchService.ReadProduct(product,null)!.Portions!);
    }

    [Fact]
    public void Name_relevance_is_primary_and_a_declared_serving_breaks_name_ties()
    {
        var noServing=Result("Nasi Goreng");
        var withServing=Result("Nasi Goreng · Brand",[new FoodPortion("serving",250)]);
        var weakerName=Result("Chicken nasi goreng",[new FoodPortion("serving",300)]);

        var ranked=FoodSearchService.PrioritizeResults([weakerName,noServing,withServing],"nasi goreng");

        Assert.Equal([withServing.Name,noServing.Name,weakerName.Name],ranked.Select(result=>result.Name));
    }

    [Theory]
    [InlineData(HttpStatusCode.TooManyRequests,429,"Wait a few seconds")]
    [InlineData(HttpStatusCode.ServiceUnavailable,503,"temporarily unavailable")]
    [InlineData(HttpStatusCode.InternalServerError,503,"temporarily unavailable")]
    [InlineData(HttpStatusCode.BadGateway,503,"temporarily unavailable")]
    public void Upstream_failures_keep_their_own_status_and_remedy(HttpStatusCode upstream,int status,string remedy)
    {
        var error=FoodSearchService.SearchUnavailable(upstream);

        Assert.Equal(status,error.Status);
        Assert.Contains(remedy,error.Message);
    }

    [Fact]
    public void A_shed_search_is_not_reported_as_a_rate_limit()
    {
        Assert.NotEqual(
            FoodSearchService.SearchUnavailable(HttpStatusCode.ServiceUnavailable).Message,
            FoodSearchService.SearchUnavailable(HttpStatusCode.TooManyRequests).Message);
    }

    [Fact]
    public void Portions_stay_within_the_stored_limits()
    {
        var portions=FoodSearchService.LimitPortions([
            new("serving",30),
            new("SERVING",40),
            new(new string('x',25),50),
            new("zero",0),
            new("huge",10001),
        ]);

        var only=Assert.Single(portions);
        Assert.Equal("serving",only.Label);
        Assert.Equal(30,only.Grams);
    }
}
