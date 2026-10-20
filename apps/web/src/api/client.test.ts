import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiRequestError } from './client';

afterEach(() => vi.unstubAllGlobals());

describe('api client', () => {
  it('resolves on an empty 202 response (summary retry)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 202 })));
    await expect(api.retrySummary('7')).resolves.toBeUndefined();
  });

  it('reads the next cursor from the X-Next-Cursor header', async () => {
    const response = new Response('[]', { status: 200, headers: { 'X-Next-Cursor': '41' } });
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.listSnapshotsPage('acme-crm', 50, '90')).resolves.toEqual({ items: [], nextCursor: '41' });
    expect(fetchMock).toHaveBeenCalledWith('/api/competitors/acme-crm/snapshots?limit=50&before=90', expect.anything());
  });

  it('surfaces API error messages', async () => {
    const body = JSON.stringify({ statusCode: 409, message: 'already tracked' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 409 })));
    await expect(api.trackCompetitor({ id: 'acme-crm' })).rejects.toEqual(new ApiRequestError(409, 'already tracked'));
  });
});
