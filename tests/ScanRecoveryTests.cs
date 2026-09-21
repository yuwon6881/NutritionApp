using Nutrition.Api.Data;
using Nutrition.Api.Services;
using Xunit;

namespace Nutrition.Tests;

public sealed class ScanRecoveryTests
{
    [Fact]
    public void OnlyTheSameFailedUploadCanRetryWithoutCreatingAnotherScan()
    {
        var requestHash="same-request";
        var interrupted=new ScanJob
        {
            RequestHash=requestHash,
            ImageBytes=128,
            ObjectPath="nutrition-scans/user/scan.jpg",
            Status="failed",
            Error="Upload interrupted. Try again."
        };
        var uploading=new ScanJob
        {
            RequestHash=requestHash,
            ImageBytes=128,
            ObjectPath="nutrition-scans/user/scan.jpg",
            Status="uploading"
        };

        Assert.True(ScanService.CanRetryExistingUpload(interrupted,requestHash,true));
        Assert.True(ScanService.CanRetryExistingUpload(uploading,requestHash,true));
        Assert.False(ScanService.CanRetryExistingUpload(interrupted,"different-request",true));
        Assert.False(ScanService.CanRetryExistingUpload(new ScanJob
        {
            RequestHash=requestHash,ImageBytes=128,ObjectPath=interrupted.ObjectPath,
            Status="failed",Error="AI processing failed."
        },requestHash,true));
        Assert.False(ScanService.CanRetryExistingUpload(new ScanJob
        {
            RequestHash=requestHash,ImageBytes=128,ObjectPath=null,
            Status="complete",Error=null
        },requestHash,true));
    }
}
