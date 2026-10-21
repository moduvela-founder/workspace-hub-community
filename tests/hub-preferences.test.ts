import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { getLayout, saveLayout, MAX_LAYOUT_ITEMS } from '../src/lib/hub/preferences.mjs';

let base: string;
let root: string;
let originals: Map<string, string>;
async function catalog(ids = ['alpha', 'beta']) {
  await fs.writeFile(path.join(base, 'catalog/assets.json'), JSON.stringify({ schemaVersion: 1, assets: ids.map(id => ({
    id, kind: 'product', title: id, workspace: 'fixture', summary: 'Recorded evidence', stage: 'design',
    tags: [], repositoryIds: [], uses: [], ownerPath: root, statusFile: path.join(root, 'STATUS.md'), sources: [],
  })), repositories: [] }));
}
beforeEach(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), 'hub-preferences-test-'));
  root = path.join(base, 'project');
  await fs.mkdir(root);
  await fs.mkdir(path.join(base, 'catalog'));
  await fs.writeFile(path.join(base, 'hub.config.json'), JSON.stringify({ schemaVersion: 1, roots: [root], excludedNames: [] }));
  await catalog();
  originals = new Map([
    [path.join(root, 'README.md'), '# Original product goal\n'],
    [path.join(root, 'STATUS.md'), '---\nschemaVersion: 1\nstage: design\n---\nOriginal evidence\n'],
    [path.join(root, 'MANUAL_STEPS.md'), '- [ ] Measure hardware\n'],
    [path.join(root, 'AGENTS.md'), '# Original constraints\n'],
    [path.join(base, 'catalog/assets.json'), await fs.readFile(path.join(base, 'catalog/assets.json'), 'utf8')],
  ]);
  for (const [file, content] of originals) await fs.writeFile(file, content);
});
afterEach(async () => { await fs.rm(base, { recursive: true, force: true }); });

describe('local layout preferences', () => {
  it('reads an absent layout without creating files, then writes only private preferences', async () => {
    expect(await getLayout(base)).toEqual({ schemaVersion: 1, order: [], revision: 0 });
    await expect(fs.lstat(path.join(base, '.local'))).rejects.toThrow();
    const saved = await saveLayout(base, { order: ['beta', 'alpha'], revision: 0 });
    expect(saved).toEqual({ schemaVersion: 1, order: ['beta', 'alpha'], revision: 1 });
    expect(await getLayout(base)).toEqual(saved);
    expect(JSON.parse(await fs.readFile(path.join(base, '.local/view-preferences.json'), 'utf8'))).toEqual(saved);
    expect((await fs.stat(path.join(base, '.local/view-preferences.json'))).mode & 0o777).toBe(0o600);
    expect(await fs.readdir(path.join(base, '.local'))).toEqual(['view-preferences.json']);
    for (const [file, content] of originals) expect(await fs.readFile(file, 'utf8')).toBe(content);
  });
  it('rejects duplicate, unregistered, traversal IDs, path fields and malformed revisions before writing', async () => {
    for (const payload of [
      { order: ['alpha', 'alpha'], revision: 0 }, { order: ['unregistered'], revision: 0 },
      { order: ['../project/STATUS.md'], revision: 0 }, { order: [], revision: -1 },
      { order: [], revision: 0.5 }, { order: [], revision: Number.MAX_SAFE_INTEGER },
      { order: 'alpha', revision: 0 }, { order: [], revision: 0, path: root },
      { order: [], revision: 0, schemaVersion: 1 }, { order: Array(MAX_LAYOUT_ITEMS + 1).fill('alpha'), revision: 0 },
    ]) await expect(saveLayout(base, payload)).rejects.toMatchObject({ status: 400, code: 'INVALID_LAYOUT' });
    await expect(fs.lstat(path.join(base, '.local'))).rejects.toThrow();
  });
  it('serializes competing writes, reports a revision conflict and recovers after errors', async () => {
    const results = await Promise.allSettled([
      saveLayout(base, { order: ['alpha', 'beta'], revision: 0 }),
      saveLayout(base, { order: ['beta', 'alpha'], revision: 0 }),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const conflict = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
    expect(conflict.reason).toMatchObject({ status: 409, code: 'REVISION_CONFLICT', layout: { revision: 1 } });
    await expect(saveLayout(base, { order: ['not-registered'], revision: 1 })).rejects.toMatchObject({ status: 400 });
    expect(await saveLayout(base, { order: ['beta'], revision: 1 })).toEqual({ schemaVersion: 1, order: ['beta'], revision: 2 });
    expect(await getLayout(base)).toEqual({ schemaVersion: 1, order: ['beta'], revision: 2 });
    expect(await fs.readdir(path.join(base, '.local'))).toEqual(['view-preferences.json']);
  });
  it('removes vanished IDs only from returned views while retaining the stored revision', async () => {
    await saveLayout(base, { order: ['beta', 'alpha'], revision: 0 });
    await catalog(['alpha']);
    expect(await getLayout(base)).toEqual({ schemaVersion: 1, order: ['alpha'], revision: 1 });
    expect(JSON.parse(await fs.readFile(path.join(base, '.local/view-preferences.json'), 'utf8')).order).toEqual(['beta', 'alpha']);
  });
  it('refuses a symlinked preference directory without creating or touching its target', async () => {
    const outside = path.join(base, 'outside');
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'sentinel'), 'UNCHANGED');
    await fs.symlink(outside, path.join(base, '.local'));
    await expect(getLayout(base)).rejects.toMatchObject({ status: 503 });
    await expect(saveLayout(base, { order: ['alpha'], revision: 0 })).rejects.toMatchObject({ status: 503 });
    expect(await fs.readdir(outside)).toEqual(['sentinel']);
    expect(await fs.readFile(path.join(outside, 'sentinel'), 'utf8')).toBe('UNCHANGED');
  });
  it('refuses linked destination files, corrupt state and unknown stored fields', async () => {
    await fs.mkdir(path.join(base, '.local'));
    const target = path.join(root, 'STATUS.md');
    const file = path.join(base, '.local/view-preferences.json');
    await fs.symlink(target, file);
    await expect(getLayout(base)).rejects.toMatchObject({ status: 503 });
    await expect(saveLayout(base, { order: ['alpha'], revision: 0 })).rejects.toMatchObject({ status: 503 });
    expect(await fs.readFile(target, 'utf8')).toBe(originals.get(target));
    await fs.unlink(file);
    for (const content of ['PRIVATE_CORRUPT_STATE', JSON.stringify({ schemaVersion: 1, order: [], revision: 0, path: target }), ' '.repeat(64 * 1024 + 1)]) {
      await fs.writeFile(file, content);
      await expect(getLayout(base)).rejects.toMatchObject({ status: 503, message: 'Local layout storage or catalogue is unavailable.' });
      await expect(saveLayout(base, { order: [], revision: 0 })).rejects.toMatchObject({ status: 503 });
      expect(await fs.readFile(file, 'utf8')).toBe(content);
    }
  });
});
