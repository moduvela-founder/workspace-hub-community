import { describe, expect, it } from 'vitest';
import type { HubAsset } from '../src/lib/hub/types';
import { assetView, type ViewOptions, type View, type Focus } from '../src/lib/hub/view';

function asset(id: string, overrides: Partial<HubAsset> = {}): HubAsset {
  return { id, title: id, kind: 'tool', workspace: 'workspace-a', summary: '', stage: 'implementation', activity: 'active', readiness: 'partial', tags: [], repositoryIds: [], uses: [], sources: [], ownerPath: null, entrypoint: null, statusFile: null, manualStepsFile: null, confirmedAt: null, startedAt: null, documentState: 'unregistered', warnings: [], manualSteps: { pending: 0, completed: 0, items: [], available: false }, ...overrides };
}
const assets = [
  asset('tool-archive', { activity: 'archived', tags: ['serial'] }),
  asset('tool-ready', { confirmedAt: '2026-10-12', tags: ['SERIAL'] }),
  asset('product-archive', { kind: 'product', activity: 'archived' }),
  asset('product-blocked', { kind: 'product', activity: 'blocked', workspace: 'workspace-b', tags: ['serial'] }),
  asset('ai-intention', { kind: 'ai', stage: 'intention', workspace: 'workspace-b' }),
];
function options(overrides: Partial<ViewOptions> = {}): ViewOptions {
  return { view: 'all', focus: 'all', workspace: 'all', query: '', sort: 'title', ...overrides };
}

describe('sidebar counts and filtered results', () => {
  it('treats services as a registered capability view across asset kinds, with matching facet counts', () => {
    const registered = ['tool-ready', 'tool-ready', 'product-blocked'];
    const state = options({ view: 'services', serviceAssetIds: registered });
    const result = assetView(assets, state);
    expect(result.filtered.map(a => a.id)).toEqual(['product-blocked', 'tool-ready']);
    expect(result.serviceCount).toBe(2);
    expect(result.globalServiceCount).toBe(2);
    expect(result.focusCounts.blocked).toBe(1);
    expect(result.focusCounts.unconfirmed).toBe(1);
    expect(result.globalFocusCounts.all).toBe(assets.length);
    const focused = assetView(assets, { ...state, focus: 'blocked' });
    expect(focused.filtered.map(a => a.id)).toEqual(['product-blocked']);
    expect(focused.serviceCount).toBe(1);
    expect(focused.globalServiceCount).toBe(2);
    expect(assetView(assets, { ...state, workspace: 'workspace-a', query: 'serial' }).serviceCount).toBe(1);
    expect(assetView(assets, options({ view: 'services' })).filtered).toEqual([]);
    expect(assetView(assets, options({ view: 'tool', serviceAssetIds: registered })).serviceCount).toBe(2);
  });
  it('uses persisted manual order without changing filtered membership or counts', () => {
    const result = assetView(assets, options({ view: 'tool', sort: 'manual', order: ['tool-ready', 'product-archive', 'tool-archive'] }));
    expect(result.filtered.map(asset => asset.id)).toEqual(['tool-ready', 'tool-archive']);
    expect(result.focusCounts.archived).toBe(1);
    expect(result.globalFocusCounts.archived).toBe(2);
  });
  it('counts attention items within the selected category instead of using global totals', () => {
    const global = assetView(assets, options());
    const tools = assetView(assets, options({ view: 'tool' }));
    expect(global.focusCounts.archived).toBe(2);
    expect(tools.focusCounts).toEqual({ all: 2, archived: 1, blocked: 0, intention: 0, unconfirmed: 1 });
    expect(tools.globalFocusCounts).toEqual({ all: 5, archived: 2, blocked: 1, intention: 1, unconfirmed: 4 });
    expect(assetView(assets, options({ view: 'tool', focus: 'archived' })).filtered.map(a => a.id)).toEqual(['tool-archive']);
  });
  it('applies workspace and search to both facets and ignores only the facet being counted', () => {
    const current = assetView(assets, options({ view: 'product', focus: 'archived', workspace: 'workspace-a', query: ' SERIAL ' }));
    expect(current.categoryCounts).toEqual({ tool: 1 });
    expect(current.globalCategoryCounts).toEqual({ tool: 2, product: 2, ai: 1 });
    expect(current.totalCount).toBe(1);
    expect(current.focusCounts).toEqual({ all: 0, intention: 0, blocked: 0, archived: 0, unconfirmed: 0 });
    expect(current.globalFocusCounts).toEqual(assetView(assets, options()).globalFocusCounts);
    expect(current.filtered).toEqual([]);
    expect(assetView(assets, options({ view: 'tool', workspace: 'workspace-a', query: 'serial' })).filtered).toHaveLength(2);
  });
  it('every category or focus badge predicts the resulting list for combined filters', () => {
    for (const view of ['all', 'tool', 'product', 'ai'] as View[]) {
      for (const focus of ['all', 'intention', 'blocked', 'unconfirmed', 'archived'] as Focus[]) {
        const state = options({ view, focus, query: 'serial' });
        const current = assetView(assets, state);
        expect(current.focusCounts[focus]).toBe(current.filtered.length);
        expect(current.globalCategoryCounts).toEqual({ tool: 2, product: 2, ai: 1 });
        for (const nextView of ['all', 'tool', 'product', 'ai'] as View[]) {
          expect(nextView === 'all' ? current.totalCount : (current.categoryCounts[nextView] || 0))
            .toBe(assetView(assets, { ...state, view: nextView }).filtered.length);
        }
        for (const nextFocus of ['all', 'intention', 'blocked', 'unconfirmed', 'archived'] as Focus[]) {
          expect(current.focusCounts[nextFocus]).toBe(assetView(assets, { ...state, focus: nextFocus }).filtered.length);
        }
      }
    }
  });
  it('counts each service asset once globally and keeps totals when the current range is empty', () => {
    const result = assetView(assets, options({ view: 'services', focus: 'archived', query: 'absent',
      workspace: 'workspace-a', serviceAssetIds: ['tool-ready', 'tool-ready', 'product-blocked', 'missing'] }));
    expect(result.filtered).toEqual([]);
    expect(result.totalCount).toBe(0);
    expect(result.categoryCounts).toEqual({});
    expect(result.globalCategoryCounts).toEqual({ tool: 2, product: 2, ai: 1 });
    expect(result.serviceCount).toBe(0);
    expect(result.globalServiceCount).toBe(2);
    const empty = assetView([], options());
    expect(empty.globalCategoryCounts).toEqual({});
    expect(empty.globalServiceCount).toBe(0);
  });
  it('keeps confirmation dates separate from development stage and rejects invalid status evidence', () => {
    const evidence = [asset('dated', { confirmedAt: '2026-10-12' }), asset('invalid', { confirmedAt: '2026-10-12', documentState: 'invalid' }), asset('undated-delivery', { stage: 'delivered' })];
    expect(assetView(evidence, options({ focus: 'unconfirmed' })).filtered.map(a => a.id)).toEqual(['invalid', 'undated-delivery']);
  });
});
