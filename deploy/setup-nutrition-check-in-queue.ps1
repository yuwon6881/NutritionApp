[CmdletBinding()]
param(
    [string]$ProjectId = (gcloud config get-value project 2>$null),
    [string]$Region = 'asia-southeast1',
    [string]$QueueName = 'nutrition-check-in',
    [string]$ServiceAccount = 'nutrition-api'
)

# Creates the Cloud Tasks queue that wakes the reminder dispatcher at each due time, and lets the API
# enqueue into it. This replaces a Cloud Scheduler job that POSTed every five minutes and so kept the
# API and database awake around the clock. Safe to re-run.
$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($ProjectId) -or $ProjectId -eq '(unset)') {
    throw 'Provide -ProjectId or configure a gcloud project.'
}

$locationArgs = @('--project', $ProjectId, '--location', $Region)
$retryArgs = @(
    '--max-attempts', '5',
    '--min-backoff', '30s',
    '--max-backoff', '300s',
    '--max-doublings', '3',
    # The dispatcher only sends within 30 minutes of the chosen time, so retrying longer is pointless.
    '--max-retry-duration', '1800s',
    '--max-dispatches-per-second', '5',
    '--max-concurrent-dispatches', '2'
)

& gcloud tasks queues describe $QueueName @locationArgs --format='value(name)' 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) {
    & gcloud tasks queues update $QueueName @locationArgs @retryArgs
} else {
    & gcloud tasks queues create $QueueName @locationArgs @retryArgs
}
if ($LASTEXITCODE -ne 0) { throw "Could not configure queue $QueueName." }

$member = "serviceAccount:$ServiceAccount@$ProjectId.iam.gserviceaccount.com"
& gcloud tasks queues add-iam-policy-binding $QueueName @locationArgs --member $member --role roles/cloudtasks.enqueuer --quiet | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Could not grant $member enqueue access to $QueueName." }

Write-Output "Queue $QueueName is ready in $Region; $ServiceAccount may enqueue into it."
