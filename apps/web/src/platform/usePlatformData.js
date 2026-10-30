import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../api/client.js';

export function usePlatformData(path) {
  const [result, setResult] = useState({ path: null, data: null });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!path) {
      setResult({ path: null, data: null });
      setError('');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      setResult({ path, data: await apiRequest(path) });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    if (path) refresh();
    else {
      setResult({ path: null, data: null });
      setLoading(false);
    }
  }, [path, refresh]);

  return { data: result.path === path ? result.data : null, error, loading, refresh, setError };
}

export async function downloadCsv(path, filename) {
  const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000/api/v1').replace(
    /\/$/,
    '',
  );
  const response = await fetch(`${apiBaseUrl}${path}`, { credentials: 'include' });
  if (!response.ok) {
    let message = 'The export could not be downloaded.';
    try {
      const payload = await response.json();
      message = payload.error?.message ?? message;
    } catch {
      // The export endpoint may return a non-JSON server error.
    }
    throw new Error(message);
  }
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return response.headers.get('x-export-truncated') === 'true';
}
