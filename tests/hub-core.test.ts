import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { loadCatalog, guardedPath, rulesFingerprint, initializeEntity } from '../src/lib/hub/core.mjs';

let base: string;
let root: string;
let product: string;
let asset: Record<string, unknown>;
async function write(relative: string, data: string) {
  const target = path.join(base, relative);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, data);
}
async function save(assets = [asset], repositories: unknown[] = []) {
  await write('catalog/assets.json', JSON.stringify({ schemaVersion: 1, assets, repositories }));
}
beforeEach(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), 'hub-test-'));
  root = path.join(base, 'workspace');
  product = path.join(root, 'device');
  await fs.mkdir(product, { recursive: true });
  await write('hub.config.json', JSON.stringify({ schemaVersion: 1, roots: [root], excludedNames: ['ignored'] }));
  asset = { id: 'device', kind: 'product', title: 'Device', workspace: 'test', summary: 'Initial evidence', stage: 'design', tags: [], repositoryIds: [], uses: [], ownerPath: product, sources: [{ path: path.join(product, 'README.md'), note: 'Design source' }] };
  await fs.writeFile(path.join(product, 'README.md'), '# Original evidence');
  await save();
});
afterEach(async () => { await fs.rm(base, { recursive: true, force: true }); });

describe('catalogue evidence boundaries', () => {
  it('defaults unknown start dates to null and rejects impossible calendar dates', async () => {
    const initial = await loadCatalog(base);
    expect(initial.hubRoot).toBe(await fs.realpath(base));
    expect(initial.assets[0].startedAt).toBeNull();
    asset.startedAt = '2024-02-29';
    await save();
    expect((await loadCatalog(base)).assets[0].startedAt).toBe('2024-02-29');
    for (const invalid of ['2026-02-29', '2026-02-30', '2026-04-31', '2026-13-01', '2026-10-12T00:00:00Z']) {
      asset.startedAt = invalid;
      await save();
      await expect(loadCatalog(base)).rejects.toThrow('Invalid startedAt');
    }
  });
  it('loads an explicit status start date atomically and retains the catalogue when invalid', async () => {
    asset.startedAt = '2026-10-01';
    asset.statusFile = path.join(product, 'STATUS.md');
    await save();
    await fs.writeFile(asset.statusFile as string, '---\nschemaVersion: 1\nstartedAt: "2026-10-12"\nstage: validation\n---\n');
    expect((await loadCatalog(base)).assets[0]).toMatchObject({ startedAt: '2026-10-12', stage: 'validation', documentState: 'confirmed' });
    await fs.writeFile(asset.statusFile as string, '---\nschemaVersion: 1\nstartedAt: "2026-02-30"\nstage: delivered\n---\n');
    expect((await loadCatalog(base)).assets[0]).toMatchObject({ startedAt: '2026-10-01', stage: 'design', documentState: 'invalid' });
    await fs.writeFile(asset.statusFile as string, '---\nschemaVersion: 1\nstartedAt: null\n---\n');
    expect((await loadCatalog(base)).assets[0].startedAt).toBeNull();
  });
  it('keeps archived AI work and skill sources without fetching links or accepting URL credentials', async () => {
    asset.kind = 'ai';
    asset.activity = 'archived';
    asset.sources = [{ path: 'https://github.com/HKUDS/CLI-Anything', note: 'Source link only' }];
    await save([asset, { ...asset, id: 'skill-source', kind: 'skill' }]);
    const result = await loadCatalog(base);
    expect(result.assets[0]).toMatchObject({ kind: 'ai', activity: 'archived' });
    expect(result.assets[0].warnings).not.toContain('A registered source is missing, outside allowed roots, or inaccessible');
    asset.sources = [{ path: 'https://user:secret@example.com/repo', note: 'Invalid' }];
    await save();
    await expect(loadCatalog(base)).rejects.toThrow('credential-bearing');
    asset.sources = [{ path: 'https://example.com/repo?token=secret', note: 'Invalid' }];
    await save();
    await expect(loadCatalog(base)).rejects.toThrow('credential-bearing');
  });
  it('reads validated status and actionable checkboxes without changing files', async () => {
    const status = '---\nschemaVersion: 1\ngoal: Deliver a measured result\nstage: validation\nactivity: blocked\nreadiness: partial\nconfirmedAt: "2026-10-12"\n---\n# Evidence\n';
    const manual = '- [ ] Measure the board\n- [x] Prepare fixture\n```\n- [ ] Ignore example\n```\n';
    await fs.writeFile(path.join(product, 'STATUS.md'), status);
    await fs.writeFile(path.join(product, 'MANUAL_STEPS.md'), manual);
    asset.statusFile = path.join(product, 'STATUS.md');
    asset.manualStepsFile = path.join(product, 'MANUAL_STEPS.md');
    await save();
    const before = await fs.readdir(product);
    const result = await loadCatalog(base);
    expect(result.assets[0]).toMatchObject({ stage: 'validation', activity: 'blocked', readiness: 'partial', goal: 'Deliver a measured result', confirmedAt: '2026-10-12', documentState: 'confirmed', manualSteps: { pending: 1, completed: 1, items: ['Measure the board'], available: true } });
    expect(await fs.readdir(product)).toEqual(before);
    expect(await fs.readFile(path.join(product, 'STATUS.md'), 'utf8')).toBe(status);
  });
  it('retains catalogue state if status has an invalid enum', async () => {
    await fs.writeFile(path.join(product, 'STATUS.md'), '---\nschemaVersion: 1\ngoal: Should not override\nstage: magically-complete\n---\n');
    asset.statusFile = path.join(product, 'STATUS.md');
    await save();
    const result = await loadCatalog(base);
    expect(result.assets[0].stage).toBe('design');
    expect(result.assets[0].goal).toBeUndefined();
    expect(result.assets[0].documentState).toBe('invalid');
  });
  it('refuses status symlink escapes and credential-like paths', async () => {
    const external = path.join(base, 'external.md');
    await fs.writeFile(external, '---\nstage: delivered\n---\nSECRET');
    await fs.symlink(external, path.join(product, 'STATUS.md'));
    asset.statusFile = path.join(product, 'STATUS.md');
    await save();
    const result = await loadCatalog(base);
    expect(result.assets[0].documentState).toBe('invalid');
    expect(result.assets[0].stage).toBe('design');
    expect(JSON.stringify(result)).not.toContain('SECRET');
    await expect(guardedPath(path.join(root, '.ssh', 'README.md'), [await fs.realpath(root)], { allowMissing: true })).rejects.toThrow('excluded');
  });
  it('validates status identity and permits explicitly scoped rule roots', async () => {
    await fs.writeFile(path.join(product, 'STATUS.md'), '---\nschemaVersion: 1\nid: other-product\nstage: delivered\n---\n');
    asset.statusFile = path.join(product, 'STATUS.md');
    await save();
    expect((await loadCatalog(base)).assets[0]).toMatchObject({ stage: 'design', documentState: 'invalid' });
    const ruleRoot = path.join(base, '.codex', 'instructions');
    await fs.mkdir(ruleRoot, { recursive: true });
    const document = path.join(ruleRoot, 'release.md');
    await fs.writeFile(document, '# Allowed scoped rule');
    expect(await guardedPath(document, [await fs.realpath(ruleRoot)])).toBe(await fs.realpath(document));
    await expect(guardedPath(document, [await fs.realpath(base)])).rejects.toThrow('excluded');
  });
  it('accepts shared repositories but rejects unknown relationships and duplicate IDs', async () => {
    const shared = { id: 'shared', title: 'Shared', path: product, checkouts: [{ path: path.join(root, 'worktrees', 'branch'), role: 'parallel' }] };
    asset.repositoryIds = ['shared'];
    await save([asset, { ...asset, id: 'another-product' }], [shared]);
    const result = await loadCatalog(base);
    expect(result.assets).toHaveLength(2);
    expect(result.repositories).toHaveLength(1);
    expect(result.repositories[0].checkouts).toHaveLength(1);
    await save([asset]);
    await expect(loadCatalog(base)).rejects.toThrow('Unknown repository');
    await save([asset, asset], [shared]);
    await expect(loadCatalog(base)).rejects.toThrow('Duplicate asset');
  });
  it('discovers only direct directories, skips exclusions and does not register them', async () => {
    await fs.mkdir(path.join(root, 'new-product', 'nested'), { recursive: true });
    await fs.mkdir(path.join(root, 'worktrees'));
    await fs.mkdir(path.join(root, 'ignored'));
    await fs.symlink(base, path.join(root, 'outside-link'));
    const before = await fs.readFile(path.join(base, 'catalog/assets.json'), 'utf8');
    const result = await loadCatalog(base);
    expect(result.discoveries.map(d => d.title)).toEqual(['new-product']);
    expect(result.assets[0].documentState).toBe('unregistered');
    expect(await fs.readFile(path.join(base, 'catalog/assets.json'), 'utf8')).toBe(before);
  });
});

describe('rule and scaffolding CLI core', () => {
  it('records a new directory start date but does not invent a date for an existing project', async () => {
    for (const name of ['README.md', 'AGENTS.md', 'MANUAL_STEPS.md']) await write(`templates/entity/${name}`, '# {{title}}');
    await write('templates/entity/STATUS.md', '---\nschemaVersion: 1\nstartedAt: {{startedAt}}\n---\n');
    const newPath = path.join(root, 'brand-new');
    await initializeEntity(base, { path: newPath, id: 'brand-new', title: 'New', kind: 'tool', apply: true });
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    expect(await fs.readFile(path.join(newPath, 'STATUS.md'), 'utf8')).toContain(`startedAt: "${today}"`);
    await initializeEntity(base, { path: product, id: 'device', title: 'Existing', kind: 'product', apply: true });
    expect(await fs.readFile(path.join(product, 'STATUS.md'), 'utf8')).toContain('startedAt: null');
    expect(await fs.readFile(path.join(product, 'README.md'), 'utf8')).toBe('# Original evidence');
  });
  it('changes fingerprints only when rule contents change', async () => {
    await write('AGENTS.md', '# Hub development constraints');
    await write('docs/hub/rules.md', '# Contract');
    await write('templates/entity/README.md', '# {{title}}');
    await write('skills/workspace-catalog/SKILL.md', '# Skill');
    const first = await rulesFingerprint(base);
    await write('unrelated.md', '# Not a rule');
    await write('STATUS.md', '# Progress');
    expect((await rulesFingerprint(base, first.fingerprint)).changed).toBe(false);
    await write('docs/hub/rules.md', '# Changed contract');
    const next = await rulesFingerprint(base, first.fingerprint);
    expect(next.changed).toBe(true);
    expect(next.files).toHaveLength(4);
    await write('AGENTS.md', '# Changed Hub constraints');
    const changedAgents = await rulesFingerprint(base, next.fingerprint);
    expect(changedAgents.changed).toBe(true);
    expect(changedAgents.files.find(file => file.path === 'AGENTS.md')?.sha256).not.toBe(next.files.find(file => file.path === 'AGENTS.md')?.sha256);
    await write('AGENTS.override.md', '# Temporary local constraints');
    const override = await rulesFingerprint(base, changedAgents.fingerprint);
    expect(override.changed).toBe(true);
    await write('templates/workspace/AGENTS.md', '# Workspace adoption');
    const workspaceRules = await rulesFingerprint(base, override.fingerprint);
    expect(workspaceRules.changed).toBe(true);
    await write('examples/codex/GLOBAL-AGENTS-SNIPPET.md', '# Optional merge suggestion');
    expect((await rulesFingerprint(base, workspaceRules.fingerprint)).changed).toBe(true);
  });
  it('fingerprints only the closeout skill and its explicit invocation policy', async () => {
    const skill = 'skills/session-closeout/SKILL.md';
    const policy = 'skills/session-closeout/agents/openai.yaml';
    await write(skill, '# Closeout procedure');
    await write(policy, 'policy:\n  allow_implicit_invocation: false\n');
    const first = await rulesFingerprint(base);
    expect(first.files.map(file => file.path).sort()).toEqual([skill, policy].sort());
    expect((await rulesFingerprint(base, first.fingerprint)).changed).toBe(false);
    for (const unrelated of ['STATUS.md', 'skills/session-closeout/STATUS.md', 'skills/session-closeout/agents/other.yaml', 'docs/hub/other.yaml', 'skills/other/SKILL.md', 'skills/other/agents/openai.yaml']) {
      await write(unrelated, 'Unrelated state');
    }
    const unchanged = await rulesFingerprint(base, first.fingerprint);
    expect(unchanged.changed).toBe(false);
    expect(unchanged.files).toEqual(first.files);
    await write(skill, '# Revised closeout procedure');
    const changedSkill = await rulesFingerprint(base, first.fingerprint);
    expect(changedSkill.changed).toBe(true);
    expect(changedSkill.files.find(file => file.path === skill)?.sha256).not.toBe(first.files.find(file => file.path === skill)?.sha256);
    expect(changedSkill.files.find(file => file.path === policy)).toEqual(first.files.find(file => file.path === policy));
    await write(policy, 'policy:\n  allow_implicit_invocation: true\n');
    const changedPolicy = await rulesFingerprint(base, changedSkill.fingerprint);
    expect(changedPolicy.changed).toBe(true);
    expect(changedPolicy.files.find(file => file.path === policy)?.sha256).not.toBe(changedSkill.files.find(file => file.path === policy)?.sha256);
    expect(changedPolicy.files.find(file => file.path === skill)).toEqual(changedSkill.files.find(file => file.path === skill));
  });
  it('generates working rule links from a relocated Hub without rewriting existing project instructions', async () => {
    const relocated = path.join(base, 'hub with spaces # [test]');
    await fs.mkdir(path.join(relocated, 'templates/entity'), { recursive: true });
    await fs.mkdir(path.join(relocated, 'docs/hub'), { recursive: true });
    await fs.writeFile(path.join(relocated, 'hub.config.json'), JSON.stringify({ schemaVersion: 1, roots: [root] }));
    for (const name of ['README.md', 'STATUS.md', 'MANUAL_STEPS.md']) await fs.writeFile(path.join(relocated, 'templates/entity', name), '# {{title}}');
    await fs.copyFile(new URL('../templates/entity/AGENTS.md', import.meta.url), path.join(relocated, 'templates/entity/AGENTS.md'));
    const documentPaths = ['project-rules.md', 'storage-and-outputs.md'].map(name => path.join(relocated, 'docs/hub', name));
    for (const file of documentPaths) await fs.writeFile(file, '# Shared contract');
    const target = path.join(root, 'portable');
    const options = { path: target, id: 'portable', title: 'Portable', kind: 'tool' };
    await initializeEntity(relocated, options);
    await expect(fs.stat(target)).rejects.toThrow();
    await initializeEntity(relocated, { ...options, apply: true });
    const generated = await fs.readFile(path.join(target, 'AGENTS.md'), 'utf8');
    const links = [...generated.matchAll(/\]\(<([^>]+)>\)/g)].map(match => decodeURIComponent(match[1]));
    expect(links).toEqual(await Promise.all(documentPaths.map(file => fs.realpath(file))));
    for (const file of links) expect((await fs.stat(file)).isFile()).toBe(true);
    expect(generated).not.toContain('{{');
    await fs.writeFile(path.join(target, 'AGENTS.md'), '# Existing product gates');
    await initializeEntity(relocated, { ...options, apply: true });
    expect(await fs.readFile(path.join(target, 'AGENTS.md'), 'utf8')).toBe('# Existing product gates');
  });
  it('dry-runs without directory creation and applies idempotently preserving original instructions', async () => {
    for (const name of ['README.md', 'AGENTS.md', 'STATUS.md', 'MANUAL_STEPS.md']) await write(`templates/entity/${name}`, '# {{title}}\n{{id}} {{kind}} {{date}}');
    const target = path.join(root, 'new');
    const options = { path: target, id: 'new', title: 'New project', kind: 'product' };
    const preview = await initializeEntity(base, options);
    expect(preview.dryRun).toBe(true);
    await expect(fs.stat(target)).rejects.toThrow();
    await fs.mkdir(target);
    await fs.writeFile(path.join(target, 'AGENTS.md'), '# Existing constraints');
    const applied = await initializeEntity(base, { ...options, apply: true });
    expect(applied.files.filter(f => f.action === 'created')).toHaveLength(3);
    expect(await fs.readFile(path.join(target, 'AGENTS.md'), 'utf8')).toBe('# Existing constraints');
    expect(await fs.readFile(path.join(target, 'README.md'), 'utf8')).toContain('New project');
    const again = await initializeEntity(base, { ...options, apply: true });
    expect(again.files.every(f => f.action === 'preserved')).toBe(true);
    expect(await fs.readFile(path.join(base, 'catalog/assets.json'), 'utf8')).not.toContain('New project');
  });
  it('preflights all templates and quotes YAML titles safely', async () => {
    const options = { path: path.join(root, 'quoted'), id: 'quoted', title: 'Tool "alpha"', kind: 'tool', apply: true };
    await write('templates/entity/README.md', '# {{title}}');
    await expect(initializeEntity(base, options)).rejects.toThrow();
    await expect(fs.stat(options.path)).rejects.toThrow();
    await write('templates/entity/AGENTS.md', '# {{title}}');
    await write('templates/entity/MANUAL_STEPS.md', '# {{title}}');
    await write('templates/entity/STATUS.md', '---\nschemaVersion: 1\nid: "{{id}}"\ntitle: "{{title}}"\nstage: intention\n---\n');
    await initializeEntity(base, options);
    asset.id = 'quoted';
    asset.statusFile = path.join(options.path, 'STATUS.md');
    await save();
    expect((await loadCatalog(base)).assets[0].documentState).toBe('confirmed');
  });
  it('rejects scaffold paths outside roots including missing descendants of symlinks', async () => {
    await fs.symlink(base, path.join(root, 'escape'));
    await expect(initializeEntity(base, { path: path.join(root, 'escape', 'new'), id: 'new', title: 'New', kind: 'tool', apply: true })).rejects.toThrow('escapes');
    await expect(guardedPath(path.join(base, 'new'), [root], { allowMissing: true })).rejects.toThrow('escapes');
  });
});
