import { afterEach, describe, expect, it, vi } from 'vitest';
const methods = vi.hoisted(() => ({ getLayout: vi.fn(), saveLayout: vi.fn() }));
vi.mock('../src/lib/hub/preferences.mjs', async importOriginal => ({ ...(await importOriginal() as object), ...methods }));
import { LayoutError, MAX_LAYOUT_BYTES } from '../src/lib/hub/preferences.mjs';
import * as route from '../src/app/api/hub/layout/route';
afterEach(() => vi.clearAllMocks());
const request = (body: string, contentType = 'application/json') => new Request('http://127.0.0.1:4176/api/hub/layout', { method: 'PUT', headers: { 'Content-Type': contentType }, body });

describe('layout HTTP boundary', () => {
  it('returns an uncached layout and handles only GET / PUT', async () => {
    methods.getLayout.mockResolvedValue({ schemaVersion: 1, order: ['alpha'], revision: 1 });
    const response = await route.GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ order: ['alpha'], revision: 1 });
    expect(Object.keys(route).sort()).toEqual(['GET', 'PUT', 'dynamic', 'runtime']);
    methods.saveLayout.mockResolvedValue({ schemaVersion: 1, order: ['beta'], revision: 2 });
    const saved = await route.PUT(request('{"order":["beta"],"revision":1}'));
    expect(saved.status).toBe(200);
    expect(methods.saveLayout).toHaveBeenCalledWith(process.cwd(), { order: ['beta'], revision: 1 });
  });
  it('rejects unsupported types, malformed JSON, oversized bodies and invalid UTF-8 before storage', async () => {
    expect((await route.PUT(request('{}', 'text/plain'))).status).toBe(415);
    expect((await route.PUT(request('not json'))).status).toBe(400);
    expect((await route.PUT(request(' '.repeat(MAX_LAYOUT_BYTES + 1)))).status).toBe(413);
    // A forged Content-Length cannot bypass streaming byte accounting.
    const huge = request(' '.repeat(MAX_LAYOUT_BYTES + 1));
    huge.headers.set('Content-Length', '2');
    expect((await route.PUT(huge)).status).toBe(413);
    const invalid = new Request('http://127.0.0.1:4176/api/hub/layout', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: new Uint8Array([0xff]) });
    expect((await route.PUT(invalid)).status).toBe(400);
    expect(methods.saveLayout).not.toHaveBeenCalled();
  });
  it('returns conflicts with the current layout and sanitizes unexpected storage errors', async () => {
    methods.saveLayout.mockRejectedValueOnce(new LayoutError(409, 'REVISION_CONFLICT', 'Reload before saving.', { schemaVersion: 1, order: ['alpha'], revision: 3 }));
    const conflict = await route.PUT(request('{"order":[],"revision":0}'));
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: 'REVISION_CONFLICT', layout: { revision: 3 } });
    methods.saveLayout.mockRejectedValueOnce(new Error('PRIVATE_PATH /outside/credentials'));
    const failure = await route.PUT(request('{"order":[],"revision":0}'));
    expect(failure.status).toBe(503);
    expect(await failure.text()).not.toContain('PRIVATE_PATH');
  });
});
