using Npgsql;
using Nutrition.Api.Data;
using Xunit;
namespace Nutrition.Tests;
public sealed class ConnectionSettingsTests
{
    [Fact] public void Neon_url_is_decoded_and_uses_verified_tls_and_bounded_pooling()
    {
        var input="postgresql://owner:example%3Bvalue@ep-example-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require";
        var pooled=new NpgsqlConnectionStringBuilder(ConnectionSettings.Normalize(input));
        Assert.Equal("example;value",pooled.Password);Assert.Equal(SslMode.VerifyFull,pooled.SslMode);Assert.Equal(ChannelBinding.Require,pooled.ChannelBinding);Assert.Equal(10,pooled.MaxPoolSize);
        Assert.Equal("ep-example.ap-southeast-1.aws.neon.tech",new NpgsqlConnectionStringBuilder(ConnectionSettings.Direct(input)).Host);
    }
}
