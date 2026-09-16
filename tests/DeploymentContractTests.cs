using Xunit;

namespace Nutrition.Tests;

public sealed class DeploymentContractTests
{
    [Fact]
    public void Database_secret_is_dedicated_to_nutrition()
    {
        var build = File.ReadAllText(Path.Combine(RepositoryRoot(), "deploy", "cloudbuild.yaml"));
        Assert.Contains("ConnectionStrings__Database=nutrition-neon-database:latest", build);
        Assert.DoesNotContain("fitness-account-neon-database", build);
        Assert.DoesNotContain("workout-neon-database", build);
    }

    [Fact]
    public void Database_secrets_across_fitness_stack_are_distinct()
    {
        var root = RepositoryRoot();
        var nutritionBuild = File.ReadAllText(Path.Combine(root, "deploy", "cloudbuild.yaml"));
        var parent = Directory.GetParent(root);
        if (parent is null) return;
        var fitnessBuildPath = Path.Combine(parent.FullName, "FitnessAccount", "cloudbuild.yaml");
        var workoutBuildPath = Path.Combine(parent.FullName, "WorkoutApp", "cloudbuild.yaml");
        if (File.Exists(fitnessBuildPath) && File.Exists(workoutBuildPath))
        {
            var fitnessBuild = File.ReadAllText(fitnessBuildPath);
            var workoutBuild = File.ReadAllText(workoutBuildPath);
            Assert.Contains("nutrition-neon-database", nutritionBuild);
            Assert.Contains("fitness-account-neon-database", fitnessBuild);
            Assert.Contains("workout-neon-database", workoutBuild);
            Assert.DoesNotContain("nutrition-neon-database", fitnessBuild);
            Assert.DoesNotContain("nutrition-neon-database", workoutBuild);
            Assert.DoesNotContain("fitness-account-neon-database", nutritionBuild);
            Assert.DoesNotContain("fitness-account-neon-database", workoutBuild);
            Assert.DoesNotContain("workout-neon-database", nutritionBuild);
            Assert.DoesNotContain("workout-neon-database", fitnessBuild);
        }
    }

    private static string RepositoryRoot()
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
            if (File.Exists(Path.Combine(directory.FullName, "deploy", "cloudbuild.yaml")) &&
                File.Exists(Path.Combine(directory.FullName, "NutritionApp.slnx")) &&
                Directory.Exists(Path.Combine(directory.FullName, "api"))) return directory.FullName;
        throw new DirectoryNotFoundException("NutritionApp repository root was not found.");
    }
}
