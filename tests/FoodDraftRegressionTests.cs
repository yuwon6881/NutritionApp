using System.Text.Json;
using Nutrition.Api.Domain;
using Nutrition.Api.Services.AI.Agent;
using Nutrition.Api.Services.AI.Tools;
using Nutrition.Api.Services.FoodLookup;
using Xunit;

namespace Nutrition.Tests;

public sealed class FoodDraftRegressionTests
{
    [Theory]
    [InlineData("null")]
    [InlineData("\"30\"")]
    [InlineData("true")]
    [InlineData("{}")]
    public void MalformedPortionWeightIsADomainError(string weight)
    {
        Assert.Throws<DomainException>(() => Validation.Portions("[{\"label\":\"scoop\",\"grams\":" + weight + "}]"));
    }

    [Theory]
    [InlineData("100g (3.5 oz)", null)]
    [InlineData("30 GRM (30 g)", null)]
    [InlineData("240 ml (8 fl oz)", null)]
    [InlineData("100 g", null)]
    [InlineData("cup (240 ml)", "cup (240 ml)")]
    [InlineData("1 slice (30 g)", "1 slice (30 g)")]
    [InlineData("1 serving (200 ml)", "1 serving (200 ml)")]
    public void PortionLabelsKeepHouseholdMeaning(string description, string? expected)
    {
        Assert.Equal(expected, FoodResults.PortionLabel(description));
    }

    [Theory]
    [InlineData("12345678")]
    [InlineData("Rolled oats")]
    public async Task FoodIdOnlyProposalCarriesItsVerifiedName(string id)
    {
        var evidence = new AiToolContext("kcal", "kg", new DateOnly(2026, 10, 16));
        evidence.Evidence.RecordFood(id, "Rolled oats");
        var context = new AiToolContext("kcal", "kg", evidence.Today);
        context.Evidence.MergeFrom(evidence.Evidence);
        var proposer = new AiActionProposer(context);
        await proposer.ProposeAsync(JsonSerializer.Serialize(new { actions = new[] {
            new { type = "openAddFoodDraft", payload = new { foodId = id } }
        }}), default);
        Assert.Equal("Rolled oats", Assert.Single(proposer.Accepted).Payload["query"]);
    }

    [Fact]
    public async Task UnknownFoodIdCannotBecomeSearchText()
    {
        var proposer = new AiActionProposer(new AiToolContext("kcal", "kg", new DateOnly(2026, 10, 16)));
        await proposer.ProposeAsync("{\"actions\":[{\"type\":\"openAddFoodDraft\",\"payload\":{\"foodId\":\"guessed\"}}]}", default);
        Assert.Empty(proposer.Accepted);
    }
}
