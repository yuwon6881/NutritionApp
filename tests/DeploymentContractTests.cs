using Xunit;

namespace Nutrition.Tests;

public sealed class DeploymentContractTests
{
    [Fact]
    public void Database_secret_is_dedicated_to_nutrition()
    {
        var build = File.ReadAllText(Path.Combine(RepositoryRoot(), "deploy", "cloudbuild.yaml"));
        Assert.Contains("ConnectionStrings__Database=nutrition-neon-database:${_NUTRITION_DATABASE_SECRET_VERSION}", build);
        Assert.Contains("_NUTRITION_DATABASE_SECRET_VERSION: '1'", build);
        Assert.DoesNotContain("fitness-account-neon-database", build);
        Assert.DoesNotContain("workout-neon-database", build);
    }

    [Fact]
    public void Google_health_credentials_are_runtime_only()
    {
        var build = File.ReadAllText(Path.Combine(RepositoryRoot(), "deploy", "cloudbuild.yaml"));
        Assert.Contains("GoogleHealth__ClientId=${_GOOGLE_HEALTH_CLIENT_ID}", build);
        Assert.Contains("GoogleHealth__ClientSecret=google-health-client-secret:latest", build);
        Assert.Contains("_GOOGLE_HEALTH_CLIENT_ID:", build);
        Assert.Contains("/api/integrations/google-health/callback", File.ReadAllText(Path.Combine(RepositoryRoot(), "deploy", "README.md")));
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

    /// No provider needs a fixed source IP since fatsecret was retired, so outbound traffic uses
    /// Cloud Run's default egress. `gcloud run deploy` keeps an omitted network setting, so the
    /// route must be cleared explicitly or the revision would keep sending through a deleted NAT.
    [Fact]
    public void Outbound_traffic_uses_default_egress_without_a_fixed_ip()
    {
        var build = File.ReadAllText(Path.Combine(RepositoryRoot(), "deploy", "cloudbuild.yaml"));
        Assert.Contains("--clear-network", build);
        Assert.DoesNotContain("--vpc-egress", build);
        Assert.DoesNotContain("--network=", build);
        Assert.DoesNotContain("FatSecret", build, StringComparison.OrdinalIgnoreCase);
    }

    /// Reminders and Google Health uploads must not depend on a job that polls, or the API and the
    /// database could never sleep between visits.
    [Fact]
    public void Reminder_wakeups_and_uploads_need_no_polling_scheduler_job()
    {
        var root = RepositoryRoot();
        var build = File.ReadAllText(Path.Combine(root, "deploy", "cloudbuild.yaml"));
        Assert.Contains("CloudTasks__Queue=nutrition-check-in", build);
        Assert.Contains("CloudTasks__TargetUrl=${_NUTRITION_API_ORIGIN}/internal/nutrition-check-in-dispatch", build);
        Assert.False(File.Exists(Path.Combine(root, "deploy", "setup-nutrition-check-in-push.ps1")));
        Assert.False(File.Exists(Path.Combine(root, "deploy", "setup-google-health-sync.ps1")));
        Assert.True(File.Exists(Path.Combine(root, "deploy", "setup-nutrition-check-in-queue.ps1")));
    }

    /// Startup CPU boost shortens a cold start without keeping an instance running.
    [Fact]
    public void Nutrition_api_boosts_cpu_only_while_starting_and_still_scales_to_zero()
    {
        var build = File.ReadAllText(Path.Combine(RepositoryRoot(), "deploy", "cloudbuild.yaml"));
        Assert.Contains("--cpu-boost", build);
        Assert.DoesNotContain("--no-cpu-boost", build);
        Assert.Contains("--min-instances=0", build);
        Assert.DoesNotContain("--no-cpu-throttling", build);
    }

    /// Short-lived scale-to-zero instances never run long enough to repay PGO instrumentation.
    [Fact]
    public void Cold_start_runtime_settings_skip_profile_guided_instrumentation()
    {
        var project = File.ReadAllText(Path.Combine(RepositoryRoot(), "api", "Nutrition.Api.csproj"));
        Assert.Contains("<TieredPGO>false</TieredPGO>", project);
        Assert.Contains("PublishReadyToRun=true", File.ReadAllText(Path.Combine(RepositoryRoot(), "Dockerfile")));
    }

    [Fact]
    public void Request_body_limit_fits_a_full_set_of_maximum_size_photos()
    {
        var jpeg = new byte[Nutrition.Api.Services.PhotoService.MaxPhotoBytes];
        jpeg[0] = 0xff; jpeg[1] = 0xd8; jpeg[^2] = 0xff; jpeg[^1] = 0xd9;
        var image = Convert.ToBase64String(jpeg);
        Assert.Equal(jpeg.Length, Nutrition.Api.Services.PhotoService.DecodeJpeg(image).Length);
        var angles = new[] { "front", "side", "back" };
        Assert.Equal(angles.Length, Nutrition.Api.Services.PhotoService.MaxPhotosPerSet);
        var set = new Nutrition.Api.Services.PhotoSetInput(Guid.NewGuid(), new DateOnly(2026, 11, 18),
            angles.Select(angle => new Nutrition.Api.Services.PhotoPart(Guid.NewGuid(), angle, image)).ToList(), Guid.NewGuid(), long.MaxValue);
        var estimate = new Nutrition.Api.Services.BodyFatEstimateInput(new DateOnly(2026, 11, 18),
            angles.Select(angle => new Nutrition.Api.Services.BodyFatEstimatePhoto(angle, null, image)).ToList(),
            new Dictionary<string, double?> { ["waist"] = 80.5, ["hips"] = 95.25, ["chest"] = 101, ["neck"] = 38 });
        foreach (var request in new object[] { set, estimate })
            Assert.True(System.Text.Encoding.UTF8.GetByteCount(Nutrition.Api.Services.Json.Write(request)) <= Nutrition.Api.Services.PhotoService.MaxRequestBodyBytes);
        Assert.Contains("MaxRequestBodySize=PhotoService.MaxRequestBodyBytes", File.ReadAllText(Path.Combine(RepositoryRoot(), "api", "Program.cs")));
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
