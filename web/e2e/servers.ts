import { resolve } from 'node:path';

// Keep the path stable when Playwright reuses an API process. auth.setup resets the
// development database through the running API before creating the shared test session.
const managed = process.env.NUTRITION_TEST_MANAGED === '1';
const origin = process.env.NUTRITION_TEST_URL ?? 'http://127.0.0.1:5088';
const port = Number(new URL(origin).port || 5088);
const apiOrigin = `http://127.0.0.1:${port - 1}`;
const identityOrigin = `http://127.0.0.1:${port - 3}`;
const database = resolve(process.env.NUTRITION_TEST_DATABASE ?? 'e2e/.e2e.db');

export const testServers = [
  { command: `node e2e/mock-idp.mjs ${port - 3}`, url: `${identityOrigin}/.well-known/openid-configuration`, reuseExistingServer: !managed, timeout: 30000 },
  {
    command: `dotnet run --project ../api/Nutrition.Api.csproj --urls ${apiOrigin}`,
    url: `${apiOrigin}/health`,
    reuseExistingServer: !managed,
    timeout: 180000,
    env: {
      ASPNETCORE_ENVIRONMENT: 'Development',
      Database__SqlitePath: database,
      Auth__MaxUsers: '2',
      PublicOrigin: origin,
      Identity__Authority: identityOrigin,
      Identity__Issuer: identityOrigin,
      Identity__RequireHttpsMetadata: 'false',
      Identity__ClientId: 'nutrition-api',
      Identity__ClientSecret: 'nutrition-secret',
      Identity__RedirectUri: `${origin}/api/auth/central/callback`,
      Identity__ReturnUrl: '/',
      Identity__ConnectReturnUrl: '/settings',
      RateLimits__FoodLookup__PermitLimit: '10000',
      RateLimits__Coaching__PermitLimit: '10000',
      RateLimits__Progress__PermitLimit: '10000',
      RateLimits__Scans__PermitLimit: '10000',
      RateLimits__DeviceRevocation__PermitLimit: '10000'
    }
  },
  { command: `npm run preview -- --port ${port}`, url: origin, reuseExistingServer: !managed, timeout: 120000, env:{NUTRITION_API:apiOrigin} }
];
