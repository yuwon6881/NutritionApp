$ErrorActionPreference = 'Stop'
$nutritionRoot = Split-Path $PSScriptRoot -Parent
$env:ASPNETCORE_ENVIRONMENT = 'Development'
$env:ASPNETCORE_URLS = 'http://127.0.0.1:5088'
$env:PublicOrigin = 'http://127.0.0.1:5088'
dotnet run --project (Join-Path $nutritionRoot 'api/Nutrition.Api.csproj') --no-launch-profile
