import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

// A throwaway SQLite file per run so an end-to-end suite never reads another run's accounts.
const database = resolve('e2e/.e2e.db');
for (const suffix of ['', '-shm', '-wal']) {
  try { rmSync(database + suffix); } catch { /* first run has no file */ }
}

export const testServers = [
  { command: 'node e2e/mock-idp.mjs', url: 'http://127.0.0.1:5085/.well-known/openid-configuration', reuseExistingServer: true, timeout: 30000 },
  {
    command: `dotnet run --project ../api/Nutrition.Api.csproj --urls http://127.0.0.1:5087`,
    url: 'http://127.0.0.1:5087/health',
    reuseExistingServer: true,
    timeout: 180000,
    env: {
      ASPNETCORE_ENVIRONMENT: 'Development',
      Database__SqlitePath: database,
      Auth__MaxUsers: '2',
      PublicOrigin: 'http://127.0.0.1:5088',
      Identity__Authority: 'http://127.0.0.1:5085',
      Identity__Issuer: 'http://127.0.0.1:5085',
      Identity__RequireHttpsMetadata: 'false',
      Identity__ClientId: 'nutrition-api',
      Identity__ClientSecret: 'nutrition-secret',
      Identity__RedirectUri: 'http://127.0.0.1:5088/api/auth/central/callback',
      Identity__ReturnUrl: '/'
    }
  },
  { command: 'npm run preview', url: 'http://127.0.0.1:5088', reuseExistingServer: true, timeout: 120000 }
];
