import { ApiError, accountHeaders } from './api';

/**
 * Downloads an authenticated API export file using the active account header and CSRF guard.
 */
export async function downloadApi(path: string, filename: string): Promise<void> {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const response = await fetch(`/api${normalized}`, {
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'X-Nutrition-Request': '1', ...accountHeaders(normalized) },
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    let message = 'The export could not be generated.';
    try {
      const data = await response.json() as { message?: string };
      if (data.message) message = data.message;
    } catch { /* Keep safe fallback for proxy or gateway errors. */ }
    throw new ApiError(message, response.status);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
