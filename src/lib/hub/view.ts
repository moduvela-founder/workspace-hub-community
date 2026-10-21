import type { AssetKind, HubAsset } from './types';

export type View = 'all' | 'services' | AssetKind;
export type Focus = 'all' | 'intention' | 'blocked' | 'unconfirmed' | 'archived';
export interface ViewOptions { view: View; focus: Focus; workspace: string; query: string; sort: string; order?: string[]; serviceAssetIds?: string[] }

export function intention(asset: HubAsset) { return /intention|intent|planned|idea|意向/i.test(asset.stage); }
export function blocked(asset: HubAsset) { return /blocked|阻塞/i.test(`${asset.stage} ${asset.activity || ''}`); }
export function archived(asset: HubAsset) { return asset.activity?.toLowerCase() === 'archived'; }
export function unconfirmed(asset: HubAsset) { return !asset.confirmedAt || asset.documentState === 'invalid' || asset.documentState === 'missing'; }

function matchesFocus(asset: HubAsset, focus: Focus) {
  return focus === 'all' || ({ intention, blocked, archived, unconfirmed })[focus](asset);
}

function countFocus(assets: HubAsset[]) {
  return {
    all: assets.length,
    intention: assets.filter(intention).length,
    blocked: assets.filter(blocked).length,
    archived: assets.filter(archived).length,
    unconfirmed: assets.filter(unconfirmed).length,
  };
}

export function assetView(assets: HubAsset[], options: ViewOptions) {
  const term = options.query.trim().toLowerCase();
  const scope = assets.filter(asset => (options.workspace === 'all' || asset.workspace === options.workspace)
    && (!term || [asset.title, asset.summary, asset.goal, ...asset.tags].filter(Boolean).join(' ').toLowerCase().includes(term)));
  // Each navigation count predicts changing that facet, keeping the other filters.
  const categoryScope = scope.filter(asset => matchesFocus(asset, options.focus));
  const categoryCounts: Partial<Record<AssetKind, number>> = {};
  for (const asset of categoryScope) categoryCounts[asset.kind] = (categoryCounts[asset.kind] || 0) + 1;
  const globalCategoryCounts: Partial<Record<AssetKind, number>> = {};
  for (const asset of assets) globalCategoryCounts[asset.kind] = (globalCategoryCounts[asset.kind] || 0) + 1;
  const serviceIds = new Set(options.serviceAssetIds || []);
  const serviceCount = categoryScope.filter(asset => serviceIds.has(asset.id)).length;
  const globalServiceCount = assets.filter(asset => serviceIds.has(asset.id)).length;
  const focusScope = scope.filter(asset => options.view === 'all' || (options.view === 'services' ? serviceIds.has(asset.id) : asset.kind === options.view));
  const focusCounts = countFocus(focusScope);
  const globalFocusCounts = countFocus(assets);
  const rank = new Map((options.order || []).map((id, index) => [id, index]));
  const filtered = focusScope.filter(asset => matchesFocus(asset, options.focus))
    .sort((a, b) => options.sort === 'date' ? (b.confirmedAt || '').localeCompare(a.confirmedAt || '')
      : options.sort === 'manual' ? (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity) || a.title.localeCompare(b.title, 'zh-CN')
      : a.title.localeCompare(b.title, 'zh-CN'));
  return { filtered, categoryCounts, globalCategoryCounts, focusCounts, globalFocusCounts,
    totalCount: categoryScope.length, serviceCount, globalServiceCount };
}
