param(
    [Parameter(Mandatory=$true)][string]$Image,
    [Parameter(Mandatory=$true)][string]$PublicOrigin
)
$ErrorActionPreference = 'Stop'
$nutritionProject = 'project-7eb1aec8-8636-4c86-b2a'
if (-not $PublicOrigin.StartsWith('https://') -or $PublicOrigin.EndsWith('/')) { throw 'Supply an exact HTTPS origin without a trailing slash.' }
$nutritionEnvironment = "PublicOrigin=$PublicOrigin,Auth__MaxUsers=2,Database__MigrateOnStartup=true,Retention__MealDetailDays=90,Physique__Bucket=financialapp-vault-396431756440,ScanStorage__Bucket=nourish-scans-396431756440,OpenAi__Model=gpt-5.4-mini"
gcloud.cmd run deploy nourish-api --image=$Image --region=asia-southeast1 --project=$nutritionProject --service-account="nourish-api@$nutritionProject.iam.gserviceaccount.com" --allow-unauthenticated --min-instances=0 --max-instances=1 --memory=512Mi --cpu=1 --timeout=180 --concurrency=20 --set-env-vars=$nutritionEnvironment --set-secrets=ConnectionStrings__Database=nourish-neon-database:1,OpenAi__ApiKey=financialapp-openai-api-key:latest,Cleanup__Token=nourish-cleanup-token:1 --quiet --format='value(status.url)'
if ($LASTEXITCODE) { throw 'Cloud Run deployment failed.' }
