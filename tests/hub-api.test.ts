import { afterEach, describe, expect, it, vi } from 'vitest';
const core = vi.hoisted(() => ({ loadCatalog: vi.fn() }));
vi.mock('../src/lib/hub/core.mjs', () => core);
import * as route from '../src/app/api/hub/catalog/route';
afterEach(() => vi.clearAllMocks());
describe('hub HTTP catalogue', () => {
  it('returns a fresh read-only snapshot and exposes no mutation handler', async () => {
    core.loadCatalog.mockResolvedValue({ assets: [], repositories: [], discoveries: [], warnings: [], generatedAt: '2026-10-12T00:00:00Z', rulesFingerprint: 'abc' });
    const response = await route.GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ assets: [], rulesFingerprint: 'abc' });
    expect(core.loadCatalog).toHaveBeenCalledOnce();
    expect(Object.keys(route).sort()).toEqual(['GET', 'dynamic', 'runtime']);
  });
  it('does not leak filesystem errors or document contents on failures', async () => {
    core.loadCatalog.mockRejectedValue(new Error('PRIVATE_DOCUMENT_CONTENT /outside/credentials'));
    const response = await route.GET();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('PRIVATE_DOCUMENT_CONTENT');
  });
});
