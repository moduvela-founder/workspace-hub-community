import { afterEach, describe, expect, it, vi } from 'vitest';
const collection = vi.hoisted(() => ({ collectionInfo: vi.fn(), listMembers: vi.fn() }));
vi.mock('../src/lib/hub/collections.mjs', () => collection);
import * as route from '../src/app/api/hub/members/route';
afterEach(() => vi.clearAllMocks());
const request = (query: string) => new Request(`http://localhost/api/hub/members?${query}`);
describe('read-only member queries', () => {
  it('validates scope and bounded printable queries before reading a source', async () => {
    for (const query of ['id=../outside', 'id=agency&mode=install', 'id=agency&mode=content', 'id=agency&query=%00', `id=agency&query=${'x'.repeat(201)}`]) expect((await route.GET(request(query))).status).toBe(400);
    expect(collection.listMembers).not.toHaveBeenCalled();
    expect(Object.keys(route).sort()).toEqual(['GET', 'dynamic', 'runtime']);
  });
  it('returns registration info without listing files and non-cacheable bounded search results', async () => {
    collection.collectionInfo.mockResolvedValue(null);
    const info = await route.GET(request('id=tool&mode=info'));
    expect(await info.json()).toEqual({ collection: null, readOnly: true });
    expect(collection.listMembers).not.toHaveBeenCalled();
    collection.listMembers.mockResolvedValue({ total: 2, matched: 1, members: [{ title: 'Firmware' }], warnings: [], readOnly: true });
    const response = await route.GET(request('id=agency&mode=content&query=ISR'));
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(collection.listMembers).toHaveBeenCalledWith(expect.any(String), 'agency', { query: 'ISR', mode: 'content' });
    expect(await response.json()).toMatchObject({ matched: 1, readOnly: true });
  });
  it('distinguishes missing collections from invalid source data without leaking local errors', async () => {
    collection.listMembers.mockRejectedValue(Object.assign(new Error('PRIVATE_SOURCE_PATH'), { code: 'COLLECTION_NOT_FOUND' }));
    expect((await route.GET(request('id=agency'))).status).toBe(404);
    collection.listMembers.mockRejectedValue(new Error('PRIVATE_SOURCE_CONTENT'));
    const result = await route.GET(request('id=agency'));
    expect(result.status).toBe(503);
    expect(await result.text()).not.toContain('PRIVATE');
  });
});
