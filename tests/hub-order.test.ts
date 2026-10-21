import { describe, expect, it } from 'vitest';
import { canonicalOrder, moveToFront, reorderVisible } from '../src/lib/hub/order';
import type { HubAsset } from '../src/lib/hub/types';

describe('persistent manual order', () => {
  it('preserves hidden slots during filtered dragging', () => {
    const order = ['a', 'hidden-1', 'b', 'hidden-2', 'c'];
    expect(reorderVisible(order, ['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'hidden-1', 'a', 'hidden-2', 'b']);
    expect(order).toEqual(['a', 'hidden-1', 'b', 'hidden-2', 'c']);
    expect(reorderVisible(order, ['a', 'b', 'c'], 'hidden-1', 'a')).toEqual(order);
  });
  it('moves an existing asset to the global front and ignores unknown targets', () => {
    expect(moveToFront(['a', 'b', 'c'], 'c')).toEqual(['c', 'a', 'b']);
    expect(moveToFront(['a', 'b'], 'unknown')).toEqual(['a', 'b']);
  });
  it('retains chosen order, drops retired IDs and appends new assets deterministically', () => {
    const assets = [{ id: 'a', title: 'Alpha' }, { id: 'b', title: 'Beta' }, { id: 'c', title: 'Gamma' }] as HubAsset[];
    expect(canonicalOrder(assets, ['c', 'retired', 'c'])).toEqual(['c', 'a', 'b']);
    expect(canonicalOrder(assets, [])).toEqual(['a', 'b', 'c']);
  });
});
