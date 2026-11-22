// In-memory Bearer token store (never persisted to localStorage/sessionStorage)
let memoryAuthToken: string | null = null;

export function setMemoryAuthToken(token: string | null): void {
  memoryAuthToken = token;
}

export function getMemoryAuthToken(): string | null {
  return memoryAuthToken;
}

export async function apiFetch<T = unknown>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (memoryAuthToken) {
    headers.set('Authorization', `Bearer ${memoryAuthToken}`);
  }
  if (!(options.body instanceof FormData) && !headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, {
    ...options,
    headers,
  });

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text || `HTTP ${res.status}` };
  }

  if (!res.ok) {
    const errMsg =
      data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string'
        ? (data as { error: string }).error
        : `Request failed with status ${res.status}`;
    throw new Error(errMsg);
  }

  return data as T;
}
