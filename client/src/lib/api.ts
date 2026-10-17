export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields: Record<string, string> = {},
  ) {
    super(message);
  }
  /** True when the request never reached the server (offline, DNS, CORS, timeout). */
  get isNetwork() {
    return this.status === 0;
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: init.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: 'same-origin',
      signal: init.signal ?? AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ApiError(0, 'network', 'Can’t reach the server. Check your connection.');
  }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    const e = data?.error;
    throw new ApiError(res.status, e?.code ?? 'http_error', e?.message ?? `Request failed (${res.status})`, e?.fields);
  }
  return data as T;
}

/** Offline fallback for small, non-sensitive GETs the scanner needs after a reload without network. */
export async function cachedApi<T>(path: string, key: string): Promise<T> {
  try {
    const data = await api<T>(path);
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch {
      /* storage full or blocked: caching is best-effort */
    }
    return data;
  } catch (e) {
    const cached = e instanceof ApiError && e.isNetwork ? localStorage.getItem(key) : null;
    if (cached) return JSON.parse(cached) as T;
    throw e;
  }
}

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');
