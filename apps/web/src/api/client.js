const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000/api/v1').replace(
  /\/$/,
  '',
);
let csrfToken = null;

export function updateCsrfToken(token) {
  csrfToken = typeof token === 'string' && token ? token : null;
}

export async function apiRequest(path, { method = 'GET', body, headers = {} } = {}) {
  const requestHeaders = { ...headers };
  if (body !== undefined) requestHeaders['content-type'] = 'application/json';
  if (csrfToken && !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())) {
    requestHeaders['x-csrf-token'] = csrfToken;
  }

  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    credentials: 'include',
    headers: requestHeaders,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('The server returned an invalid response.');
  }

  if (!response.ok || payload.success !== true) {
    const error = new Error(payload.error?.message ?? 'The request could not be completed.');
    error.code = payload.error?.code;
    error.status = response.status;
    throw error;
  }

  const responseCsrfToken = payload.data?.csrfToken ?? response.headers.get('x-csrf-token');
  if (responseCsrfToken) updateCsrfToken(responseCsrfToken);
  return payload.data;
}

export async function downloadPdf(path, filename) {
  const response = await fetch(`${apiBaseUrl}${path}`, { credentials: 'include' });
  if (!response.ok) {
    let message = 'The bill could not be downloaded.';
    try {
      const payload = await response.json();
      message = payload.error?.message ?? message;
    } catch {
      // The endpoint may return a non-JSON server error.
    }
    throw new Error(message);
  }
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
