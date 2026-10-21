import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { resolveAsset, searchAssets } from '../src/lib/hub/index.mjs';
import { formatReference, formatMemberReference } from '../src/lib/hub/reference.mjs';
import { initializeEntity, loadCatalog } from '../src/lib/hub/core.mjs';

let base: string;
let root: string;
let asset: Record<string, any>;
let capability: Record<string, any>;
async function save() {
  await fs.writeFile(path.join(base, 'catalog/assets.json'), JSON.stringify({ schemaVersion: 1, assets: [asset, capability], repositories: [{ id: 'shared', title: 'Shared MCU repository', path: capability.ownerPath, checkouts: [{ path: path.join(root, 'parallel'), role: 'parallel branch' }] }] }));
}
beforeEach(async () => {
  base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'hub-index-')));
  root = path.join(base, 'workspace');
  for (const target of [path.join(base, 'catalog'), path.join(root, 'product'), path.join(root, 'tool')]) await fs.mkdir(target, { recursive: true });
  await fs.writeFile(path.join(base, 'hub.config.json'), JSON.stringify({ schemaVersion: 1, roots: [root] }));
  asset = { id: 'board', kind: 'product', title: 'Board', workspace: 'lab', summary: 'Low power recorder', stage: 'validation', tags: ['audio'], repositoryIds: ['shared'], uses: ['debugger'], ownerPath: path.join(root, 'product'), statusFile: path.join(root, 'product/STATUS.md'), manualStepsFile: path.join(root, 'product/MANUAL_STEPS.md'), sources: [{ path: path.join(root, 'product/README.md'), note: 'Owning document' }] };
  capability = { id: 'debugger', kind: 'tool', title: 'ST-LINK debug tool', workspace: 'lab', summary: 'MCU development', stage: 'implementation', tags: ['debug'], repositoryIds: ['shared'], uses: [], ownerPath: path.join(root, 'tool'), entrypoint: path.join(root, 'tool/README.md'), sources: [{ path: 'https://example.com/tool', note: 'Source link only' }] };
  for (const relative of ['AGENTS.md', 'product/AGENTS.md', 'tool/AGENTS.md']) await fs.writeFile(path.join(root, relative), 'PRIVATE_RULE_BODY');
  await fs.writeFile(path.join(root, 'product/README.md'), 'PRIVATE_SOURCE_BODY');
  await fs.writeFile(path.join(root, 'tool/README.md'), 'PRIVATE_TOOL_BODY');
  await fs.writeFile(asset.statusFile, '---\nschemaVersion: 1\ngoal: PRIVATE_STATUS_GOAL\nstage: validation\n---\nPRIVATE_STATUS_BODY');
  await fs.writeFile(asset.manualStepsFile, '- [ ] PRIVATE_MANUAL_ACTION');
  await save();
});
afterEach(async () => { await fs.rm(base, { recursive: true, force: true }); });

describe('read-only asset index', () => {
  it('resolves service instructions for a tool and its consumers without reading profiles or probing processes', async () => {
    await fs.mkdir(path.join(base, 'docs/capabilities'), { recursive: true });
    await fs.mkdir(path.join(base, '.local'));
    const guide = path.join(base, 'docs/capabilities/service.md');
    await fs.writeFile(guide, 'PRIVATE_SERVICE_GUIDE');
    await fs.writeFile(path.join(base, '.local/service-profiles.json'), 'PRIVATE_RUNTIME_CONFIGURATION');
    await fs.writeFile(path.join(base, 'catalog/services.json'), JSON.stringify({ schemaVersion: 1, services: [{
      id: 'debug-bridge', title: 'Debug bridge', assetIds: ['debugger'], transport: 'http-bridge',
      guide: 'docs/capabilities/service.md', health: { ports: [49620], path: '/health', identity: 'example-bridge' },
    }] }));
    for (const id of ['debugger', 'board']) {
      const result = await resolveAsset(base, id);
      expect(result.services).toEqual([{
        id: 'debug-bridge', title: 'Debug bridge', assetIds: ['debugger'], transport: 'http-bridge', guide,
        statusCommand: { command: 'node', args: [path.join(base, 'scripts/hub-services.mjs'), 'status', '--id', 'debug-bridge'] },
      }]);
      expect(JSON.stringify(result)).not.toContain('PRIVATE_');
      expect(result.services[0]).not.toHaveProperty('state');
      expect(result.services[0]).not.toHaveProperty('endpoint');
      expect(result.readOnly).toBe(true);
    }
  });
  it('resolves a member handoff through its parent asset and original file without importing its role instructions', async () => {
    await fs.mkdir(path.join(root, 'tool/roles'));
    const role = path.join(root, 'tool/roles/reviewer.md');
    await fs.writeFile(role, '---\nname: Reviewer\ndescription: Review embedded code\n---\nPRIVATE_ROLE_INSTRUCTIONS');
    await fs.writeFile(path.join(base, 'catalog/collections.json'), JSON.stringify({ schemaVersion: 1, collections: [{ assetId: 'debugger', rootRelative: '.', include: ['roles'], kind: 'role', metadata: 'frontmatter' }] }));
    const result = await resolveAsset(base, 'workspace-hub:debugger#roles/reviewer');
    expect(result.member).toMatchObject({ id: 'roles/reviewer', title: 'Reviewer', path: role });
    expect(result.reference).toContain('workspace-hub:debugger#roles/reviewer');
    expect(result.collection).toMatchObject({ kind: 'role', include: ['roles'] });
    expect(result.sources.some(source => source.path === role)).toBe(true);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_ROLE_INSTRUCTIONS');
    await expect(resolveAsset(base, 'debugger#roles/absent')).rejects.toMatchObject({ code: 'MEMBER_NOT_FOUND' });
    for (const id of ['debugger#../secret', 'debugger#roles/reviewer#extra', 'debugger#', 'debugger#/roles/reviewer']) await expect(resolveAsset(base, id)).rejects.toMatchObject({ code: 'INVALID_ASSET_ID' });
  });
  it('formats safe member references and preserves literal replacement characters in source names', () => {
    expect(formatMemberReference({ id: 'debugger', title: 'Tools' }, { id: 'roles/reviewer', title: '$& Reviewer\nsecond' }, '/hub')).toBe('workspace-hub:debugger#roles/reviewer\n名称：Tools / $& Reviewer second\n索引库：/hub/catalog/assets.json');
    expect(() => formatMemberReference({ id: 'debugger', title: 'Tools' }, { id: 'roles/../../secret', title: 'Secret' }, '/hub')).toThrow();
  });
  it('resolves a marker into shared repository, capability, source and ancestor instruction pointers without copying content', async () => {
    const before = await fs.readFile(path.join(base, 'catalog/assets.json'), 'utf8');
    const result = await resolveAsset(base, 'workspace-hub:board');
    expect(result.asset).toMatchObject({ id: 'board', ownerPath: asset.ownerPath, statusFile: asset.statusFile });
    expect(result.repositories).toMatchObject([{ id: 'shared', checkouts: [{ role: 'parallel branch' }] }]);
    expect(result.capabilities).toMatchObject([{ id: 'debugger', entrypoint: capability.entrypoint }]);
    expect(result.instructions.map(item => item.path)).toEqual([path.join(root, 'AGENTS.md'), path.join(root, 'product/AGENTS.md'), path.join(root, 'tool/AGENTS.md')]);
    expect(result.readOnly).toBe(true);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_');
    expect(result.asset).not.toHaveProperty('stage');
    expect(await fs.readFile(path.join(base, 'catalog/assets.json'), 'utf8')).toBe(before);
  });
  it('uses bounded literal terms and searches identity, tags and repository labels', async () => {
    expect((await searchAssets(base, 'low power')).results.map(item => item.asset.id)).toEqual(['board']);
    expect((await searchAssets(base, 'MCU')).total).toBe(2);
    expect((await searchAssets(base, '.*')).total).toBe(0);
    await expect(searchAssets(base, '')).rejects.toMatchObject({ code: 'INVALID_QUERY' });
    await expect(searchAssets(base, 'x'.repeat(201))).rejects.toMatchObject({ code: 'INVALID_QUERY' });
  });
  it('prefers same-layer override instructions and includes repository instructions independently of capabilities', async () => {
    await fs.writeFile(path.join(root, 'product/AGENTS.override.md'), 'PRIVATE_OVERRIDE_BODY');
    asset.uses = [];
    await save();
    const result = await resolveAsset(base, 'board');
    expect(result.instructions.map(item => item.path)).toEqual([
      path.join(root, 'AGENTS.md'),
      path.join(root, 'product/AGENTS.override.md'),
      path.join(root, 'tool/AGENTS.md'),
    ]);
    expect(result.instructions.map(item => item.path)).not.toContain(path.join(root, 'product/AGENTS.md'));
    expect(result.capabilities).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_OVERRIDE_BODY');
  });
  it('returns explicit not-found and rejects arbitrary path identifiers', async () => {
    await expect(resolveAsset(base, 'absent')).rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });
    await expect(resolveAsset(base, '../../outside')).rejects.toMatchObject({ code: 'INVALID_ASSET_ID' });
  });
  it('omits escaped source and instruction pointers, never reads their contents', async () => {
    const outside = path.join(base, 'outside');
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, 'README.md'), 'ESCAPED_SECRET');
    await fs.writeFile(path.join(outside, 'AGENTS.md'), 'ESCAPED_SECRET');
    await fs.symlink(outside, path.join(root, 'escape'));
    asset.ownerPath = path.join(root, 'escape');
    asset.sources = [{ path: path.join(root, 'escape/README.md'), note: 'Invalid source' }];
    await save();
    const result = await resolveAsset(base, 'board');
    expect(result.asset.ownerPath).toBeNull();
    expect(result.sources).toEqual([]);
    expect(result.instructions.map(item => item.path)).not.toContain(path.join(outside, 'AGENTS.md'));
    expect(JSON.stringify(result)).not.toContain('ESCAPED_SECRET');
  });
  it('copies only stable identity and index location, with no state or chat context', () => {
    const reference = formatReference({ ...asset, title: 'Board\nsecond line', goal: 'PRIVATE_GOAL', stage: 'validation' }, '/hub/');
    expect(reference).toBe('workspace-hub:board\n名称：Board second line\n索引库：/hub/catalog/assets.json');
    expect(reference).not.toContain('PRIVATE');
    expect(reference).not.toContain('validation');
  });
  it('initializes a new start date from the template without treating it as a confirmed result', async () => {
    await fs.mkdir(path.join(base, 'templates/entity'), { recursive: true });
    for (const name of ['README.md', 'AGENTS.md', 'MANUAL_STEPS.md']) await fs.writeFile(path.join(base, 'templates/entity', name), '# {{title}}');
    const productionTemplate = await fs.readFile(new URL('../templates/entity/STATUS.md', import.meta.url), 'utf8');
    await fs.writeFile(path.join(base, 'templates/entity/STATUS.md'), productionTemplate);
    const destination = path.join(root, 'new');
    await initializeEntity(base, { id: 'new', title: 'New', kind: 'product', path: destination, apply: true });
    asset.id = 'new';
    asset.statusFile = path.join(destination, 'STATUS.md');
    await save();
    const result = (await loadCatalog(base)).assets.find(item => item.id === 'new');
    expect(result.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.confirmedAt).toBeNull();
    expect(result.documentState).toBe('confirmed');
  });
});
