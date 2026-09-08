$ErrorActionPreference = 'Stop'
$nutritionRoot = Split-Path $PSScriptRoot -Parent
Push-Location (Join-Path $nutritionRoot 'web')
try { npm.cmd ci --no-fund; if ($LASTEXITCODE) { throw 'Dependency install failed' }; npm.cmd run build; if ($LASTEXITCODE) { throw 'Frontend build failed' } } finally { Pop-Location }
$nutritionWebRoot = Join-Path $nutritionRoot 'api/wwwroot'
New-Item -ItemType Directory -Force -Path $nutritionWebRoot | Out-Null
Copy-Item -Path (Join-Path $nutritionRoot 'web/dist/*') -Destination $nutritionWebRoot -Recurse -Force
dotnet build (Join-Path $nutritionRoot 'api/Nutrition.Api.csproj')
if ($LASTEXITCODE) { throw 'API build failed' }
