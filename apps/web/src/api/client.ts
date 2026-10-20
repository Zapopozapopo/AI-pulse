import type { ApiError, Competitor, CreateCompetitorRequest, Snapshot } from '@competitor-pulse/contracts';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface SnapshotPage {
  items: Snapshot[];
  /** Pass as `before` to load the next (older) page; null when this was the last page. */
  nextCursor: string | null;
}

async function send(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json', ...init.headers } : init?.headers,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiError | null;
    const message = Array.isArray(body?.message) ? body.message.join(', ') : body?.message;
    throw new ApiRequestError(response.status, message ?? `Request failed (${response.status})`);
  }
  return response;
}

/** Parses JSON only when there is a body: 202/204 responses are empty. */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const text = await (await send(path, init)).text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  listCompetitors: () => request<Competitor[]>('/competitors'),
  trackCompetitor: (body: CreateCompetitorRequest) =>
    request<{ id: string }>('/competitors', { method: 'POST', body: JSON.stringify(body) }),
  removeCompetitor: (id: string) => request<void>(`/competitors/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  async listSnapshotsPage(id: string, limit: number, before?: string): Promise<SnapshotPage> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (before) params.set('before', before);
    const response = await send(`/competitors/${encodeURIComponent(id)}/snapshots?${params}`);
    return { items: (await response.json()) as Snapshot[], nextCursor: response.headers.get('X-Next-Cursor') };
  },
  retrySummary: (snapshotId: string) => request<void>(`/snapshots/${snapshotId}/summary/retry`, { method: 'POST' }),
};
