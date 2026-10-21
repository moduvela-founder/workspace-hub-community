import { afterEach, describe, expect, it, vi } from 'vitest';
const index = vi.hoisted(() => ({ resolveAsset: vi.fn() }));
vi.mock('../src/lib/hub/index.mjs', async importOriginal => ({ ...await importOriginal<typeof import('../src/lib/hub/index.mjs')>(), ...index }));
import * as route from '../src/app/api/hub/asset/route';
afterEach(() => vi.clearAllMocks());
describe('read-only HTTP asset resolution', () => {
  it('requires an ID and offers no project mutation handler', async () => {
    for (const suffix of ['', '?id=../../private']) expect((await route.GET(new Request(`http://localhost/api/hub/asset${suffix}`))).status).toBe(400);
    expect(index.resolveAsset).not.toHaveBeenCalled();
    expect(Object.keys(route).sort()).toEqual(['GET', 'dynamic', 'runtime']);
  });
  it('returns only the resolver result without caching', async () => {
    index.resolveAsset.mockResolvedValue({ asset: { id: 'rea' }, repositories: [], readOnly: true });
    const response = await route.GET(new Request('http://localhost/api/hub/asset?id=rea'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ asset: { id: 'rea' }, readOnly: true });
  });
  it('accepts member references but rejects path traversal and missing members', async () => {
    const memberId = 'agency#engineering/reviewer';
    index.resolveAsset.mockResolvedValue({ member: { id: 'engineering/reviewer' }, readOnly: true });
    expect((await route.GET(new Request(`http://localhost/api/hub/asset?id=${encodeURIComponent(memberId)}`))).status).toBe(200);
    index.resolveAsset.mockRejectedValue(Object.assign(new Error('Not found'), { code: 'MEMBER_NOT_FOUND' }));
    expect((await route.GET(new Request(`http://localhost/api/hub/asset?id=${encodeURIComponent(memberId)}`))).status).toBe(404);
    expect((await route.GET(new Request('http://localhost/api/hub/asset?id=agency%23..%2Fsecret'))).status).toBe(400);
  });
  it('distinguishes unknown assets from unavailable indexes without leaking filesystem errors', async () => {
    index.resolveAsset.mockRejectedValue(Object.assign(new Error('Not found'), { code: 'ASSET_NOT_FOUND' }));
    expect((await route.GET(new Request('http://localhost/api/hub/asset?id=absent'))).status).toBe(404);
    index.resolveAsset.mockRejectedValue(new Error('PRIVATE_FILE_CONTENT /outside/private'));
    const response = await route.GET(new Request('http://localhost/api/hub/asset?id=rea'));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('PRIVATE');
  });
});
