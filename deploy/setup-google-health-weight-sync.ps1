[CmdletBinding()]
param(
    [string]$ProjectId = (gcloud config get-value project 2>$null),
    [string]$Region = 'asia-southeast1',
    [string]$JobName = 'nutrition-google-health-weight-sync',
    [string]$ApiOrigin = '',
    [string]$SchedulerToken = $env:NUTRITION_CLEANUP_TOKEN
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($ProjectId) -or $ProjectId -eq '(unset)') {
    throw 'Provide -ProjectId or configure a gcloud project.'
}
if ([string]::IsNullOrWhiteSpace($ApiOrigin)) {
    throw 'Provide -ApiOrigin with the public Cloud Run API origin.'
}
if ([string]::IsNullOrWhiteSpace($SchedulerToken)) {
    throw 'Provide -SchedulerToken from Secret Manager or set NUTRITION_CLEANUP_TOKEN; do not store it in source control.'
}

$uri = "$($ApiOrigin.TrimEnd('/'))/internal/google-health-weight-sync"
$locationArgs = @('--project', $ProjectId, '--location', $Region)
$targetArgs = @(
    '--schedule', '* * * * *',
    '--time-zone', 'UTC',
    '--uri', $uri,
    '--http-method', 'POST',
    '--headers', "X-Cleanup-Token=$SchedulerToken",
    '--message-body', '{}',
    '--attempt-deadline', '60s',
    '--quiet'
)

$existingName = & gcloud scheduler jobs describe $JobName @locationArgs '--format=value(name)' 2>$null
if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($existingName)) {
    & gcloud scheduler jobs update http $JobName @locationArgs @targetArgs
} else {
    & gcloud scheduler jobs create http $JobName @locationArgs @targetArgs
}

if ($LASTEXITCODE -ne 0) {
    throw "Cloud Scheduler could not configure $JobName."
}

Write-Output "Configured $JobName in $Region to POST every minute."