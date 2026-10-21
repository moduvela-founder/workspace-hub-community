import type { HubAsset } from './types';

export function canonicalOrder(assets: HubAsset[], saved: string[]) {
  const known = new Set(assets.map(asset => asset.id));
  const kept = [...new Set(saved)].filter(id => known.has(id));
  const present = new Set(kept);
  return [...kept, ...[...assets].sort((a, b) => a.title.localeCompare(b.title, 'zh-CN')).filter(asset => !present.has(asset.id)).map(asset => asset.id)];
}

// Refill only visible slots; assets hidden by a filter keep their global positions.
export function reorderVisible(order: string[], visible: string[], from: string, to: string) {
  const visibleSet = new Set(visible);
  const subset = order.filter(id => visibleSet.has(id));
  const source = subset.indexOf(from), target = subset.indexOf(to);
  if (source < 0 || target < 0 || source === target) return [...order];
  subset.splice(source, 1); subset.splice(target, 0, from);
  let next = 0;
  return order.map(id => visibleSet.has(id) ? subset[next++] : id);
}

export function moveToFront(order: string[], id: string) {
  return order.includes(id) ? [id, ...order.filter(item => item !== id)] : [...order];
}
