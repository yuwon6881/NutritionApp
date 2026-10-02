using Nutrition.Api.Services.FoodLookup;
using Xunit;
using static Nutrition.Tests.FoodResultsFor;

namespace Nutrition.Tests;

public sealed class FoodResultMergerTests
{
    private static readonly FakeFoodProvider Usda=new("usda");
    private static readonly FakeFoodProvider FatSecret=new("fatsecret");
    private static readonly FakeFoodProvider Off=new("off");

    private static IReadOnlyList<FoodResult> Merge(string query,params (IFoodProvider Provider,IReadOnlyList<FoodResult> Results)[] answers)
        =>FoodResultMerger.Merge(answers,query);

    [Fact]
    public void The_same_barcode_from_two_providers_keeps_the_richer_record()
    {
        var sparse=Branded("Cornflakes · Kellogg's","0038000000000");
        var rich=new FoodResult("Corn Flakes · Kellogg's",357,7.5,0.4,84,3.3,"Powered by fatsecret",100,[new FoodPortion("1 cup",28)],"038000000000",100,"per100g");

        var merged=Merge("cornflakes",(Off,[sparse]),(FatSecret,[rich]));

        Assert.Equal(rich,Assert.Single(merged));
    }

    [Fact]
    public void The_same_name_within_five_percent_calories_keeps_the_higher_priority_provider()
    {
        var usda=Generic("Banana",89);
        var fatSecret=Generic("banana",92,"Powered by fatsecret");
        var distinct=Generic("Banana",120,"Powered by fatsecret");

        var merged=Merge("banana",(Usda,[usda]),(FatSecret,[fatSecret,distinct]));

        Assert.Equal([usda,distinct],merged);
    }

    [Theory]
    [InlineData("Bananas, raw","Banana")]
    [InlineData("Rice, white, cooked","Cooked white rice")]
    [InlineData("Eggs, whole, raw, fresh","Whole egg")]
    public void Plural_word_order_and_raw_or_fresh_do_not_make_a_different_food(string usdaName,string fatSecretName)
    {
        var usda=Generic(usdaName,130);
        var fatSecret=Generic(fatSecretName,128,"Powered by fatsecret");

        Assert.Equal([usda],Merge("banana",(Usda,[usda]),(FatSecret,[fatSecret])));
    }

    [Theory]
    [InlineData("Milk, whole","Milk",61,61)]
    [InlineData("Chicken breast, raw","Chicken breast",120,165)]
    [InlineData("Banana","Banana · Dole",89,89)]
    public void A_different_food_or_calorie_count_stays_separate(string usdaName,string otherName,double usdaCalories,double otherCalories)
    {
        var usda=Generic(usdaName,usdaCalories);
        var other=Generic(otherName,otherCalories,"Powered by fatsecret");

        Assert.Equal(2,Merge("x",(Usda,[usda]),(FatSecret,[other])).Count);
    }

    [Fact]
    public void Two_rows_from_one_provider_are_never_merged_by_name()
    {
        var first=Branded("Nasi Goreng","111111111111",100);
        var second=Branded("Nasi Goreng","222222222222",101);

        Assert.Equal(2,Merge("nasi goreng",(Off,[first,second])).Count);
    }

    [Fact]
    public void A_short_generic_query_puts_generic_foods_ahead_of_branded_matches()
    {
        var branded=Branded("Banana · Dole","0033383000000");
        var generic=Generic("Bananas, raw");

        var merged=Merge("banana",(Off,[branded]),(Usda,[generic]));

        Assert.Equal([generic,branded],merged);
    }

    [Fact]
    public void A_query_naming_a_brand_puts_branded_matches_first()
    {
        var branded=Branded("Banana · Dole","0033383000000");
        var generic=Generic("Bananas, raw");

        var merged=Merge("dole banana",(Usda,[generic]),(Off,[branded]));

        Assert.Equal([branded,generic],merged);
    }

    [Fact]
    public void Name_relevance_still_beats_the_generic_preference()
    {
        var generic=Generic("Bread, banana, prepared from recipe");
        var branded=Branded("Banana · Dole","0033383000000");

        var merged=Merge("banana",(Usda,[generic]),(Off,[branded]));

        Assert.Equal([branded,generic],merged);
    }

    [Fact]
    public void The_merged_list_is_capped()
    {
        var many=Enumerable.Range(0,30).Select(index=>Generic($"Rice {index}",100+index*10)).ToArray();

        Assert.Equal(FoodResultMerger.MaxResults,Merge("rice",(Usda,many)).Count);
    }

    [Fact]
    public void Personal_ranking_keeps_the_generic_preference()
    {
        var branded=Branded("Banana · Dole","0033383000000");
        var generic=Generic("Bananas, raw");

        var ranked=FoodRanking.PrioritizeResults([branded,generic],"banana",new Dictionary<string,int>(StringComparer.Ordinal));

        Assert.Equal([generic,branded],ranked);
    }

    [Fact]
    public void A_brand_match_ranks_with_name_matches_and_unrelated_rows_are_dropped()
    {
        var named=Branded("Sunglo Natural Low Fat Probiotic Greek Yoghurt","9557337800090");
        var hummus=new FoodResult("Cilantro Jalapeno Hummus (Small) · Pita Jungle",165,null,null,null,null,"Powered by fatsecret");
        var pita=new FoodResult("Wheat Pita · Pita Jungle",205,null,null,null,null,"Powered by fatsecret");
        var brandOnly=Branded("Full Cream Greek Yoghurt · Sunglo","9557337800106");

        var merged=Merge("sunglo",(FatSecret,[hummus,pita]),(Off,[named,brandOnly]));

        Assert.Equal([named,brandOnly],merged);
    }

    [Fact]
    public void Loose_provider_matches_stay_when_nothing_matches_the_query()
    {
        var first=new FoodResult("Banana bread",320,null,null,null,null,"Powered by fatsecret");
        var second=new FoodResult("Banana",89,null,null,null,null,"Powered by fatsecret");

        Assert.Equal(2,Merge("bananna",(FatSecret,[first,second])).Count);
    }

    [Theory]
    [InlineData("eggs","Egg, whole")]
    [InlineData("greek yog","Full Cream Greek Yoghurt · Sunglo")]
    public void Plural_and_partly_typed_words_still_match(string query,string name)
    {
        var match=Branded(name,"111111111111");
        var unrelated=Branded("Wheat Pita · Pita Jungle","222222222222");

        Assert.Equal([match],Merge(query,(Off,[unrelated,match])));
    }
}
