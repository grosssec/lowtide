export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** JSON fetch to the Worker. Every call carries the header the API requires for state-changing requests (CSRF guard). */
export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const headers = new Headers(rest.headers);
  headers.set('X-Requested-With', 'finance-dashboard');
  if (json !== undefined) headers.set('Content-Type', 'application/json');
  const response = await fetch(`/api${path}`, {
    ...rest,
    headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    credentials: 'same-origin',
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string; issues?: string[] };
  if (!response.ok) {
    const detail = data.issues?.length ? ` (${data.issues.join('; ')})` : '';
    throw new ApiError(`${data.error ?? `Request failed (${response.status})`}${detail}`, response.status);
  }
  return data as T;
}
