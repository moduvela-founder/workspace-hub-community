import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import yaml from 'js-yaml';

export const KINDS = ['product', 'tool', 'framework', 'workflow', 'skill', 'ai', 'reference'];
export const STAGES = ['intention', 'research', 'design', 'implementation', 'validation', 'delivered', 'unknown'];
export const ACTIVITIES = ['active', 'blocked', 'paused', 'maintenance', 'archived', 'unknown'];
export const READINESS = ['unimplemented', 'unverified', 'partial', 'verified', 'unknown'];
const ID = /^[a-z0-9][a-z0-9._-]{0,99}$/;
const DENIED = new Set(['.git', '.ssh', '.codex', '.claude', '.env', 'node_modules', '.next', '.agents', 'credentials', 'secrets']);
const DEFAULT_EXCLUSIONS = ['tmp', 'temp', 'out', 'dist', 'build', 'backups', 'backup', 'worktrees', '.worktrees', 'node_modules', 'vendor'];
const inside = (base, target) => target === base || target.startsWith(base + path.sep);
const fail = (message) => { throw new Error(message); };
const text = (v, field) => typeof v === 'string' && v.length <= 4000 ? v : fail(`Invalid ${field}`);
const strings = (v, field) => Array.isArray(v) && v.length <= 1000 ? v.map(x => text(x, field)) : fail(`Invalid ${field}`);
const date = (v, field) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}(?:T\S+)?$/.test(v) && Number.isFinite(Date.parse(v)) ? v : fail(`Invalid ${field}`);
const calendarDate = (v, field) => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) fail(`Invalid ${field}`);
  const parsed = Date.parse(v);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== v) fail(`Invalid ${field}`);
  return v;
};
const choice = (v, list, field) => list.includes(v) ? v : fail(`Invalid ${field}`);
const digest = data => crypto.createHash('sha256').update(data).digest('hex');

async function readSmall(file, extension = path.extname(file), limit = 1024 * 1024, allowedExtensions = ['.md', '.json']) {
  if (!allowedExtensions.includes(extension)) fail('Unsupported document format');
  const stat = await fs.stat(file);
  if (!stat.isFile() || stat.size > limit) fail('Unsupported or oversized document');
  return fs.readFile(file, 'utf8');
}

// Resolve the nearest existing ancestor, so a future scaffold path is checked too.
export async function guardedPath(candidate, roots, { allowMissing = false } = {}) {
  if (typeof candidate !== 'string' || !path.isAbsolute(candidate)) fail('Path must be absolute');
  const absolute = path.resolve(candidate);
  let current = absolute;
  const tail = [];
  while (true) {
    try {
      const resolved = path.join(await fs.realpath(current), ...tail.reverse());
      const matching = roots.filter(root => inside(root, resolved)).sort((a, b) => b.length - a.length);
      if (!matching.length) fail('Path escapes configured roots');
      const root = matching[0];
      const relativeParts = path.relative(root, resolved).split(path.sep);
      if (inside(root, absolute)) relativeParts.push(...path.relative(root, absolute).split(path.sep));
      if (relativeParts.some(part => DENIED.has(part))) fail('Sensitive or runtime path is excluded');
      return resolved;
    } catch (error) {
      if (!allowMissing || error.code !== 'ENOENT') throw error;
      if (current === path.dirname(current)) throw error;
      tail.push(path.basename(current));
      current = path.dirname(current);
    }
  }
}

export async function loadConfig(base) {
  const realBase = await fs.realpath(base);
  const configPath = await guardedPath(path.join(base, 'hub.config.json'), [realBase]);
  const config = JSON.parse(await readSmall(configPath));
  if (config.schemaVersion !== 1 || !Array.isArray(config.roots) || !config.roots.length || config.roots.length > 30) fail('Invalid hub configuration');
  const roots = [];
  const warnings = [];
  for (const root of config.roots) {
    if (typeof root !== 'string' || !path.isAbsolute(root) || path.resolve(root) === path.parse(root).root) fail('Invalid root');
    try { roots.push(await fs.realpath(root)); }
    catch { warnings.push(`Configured root unavailable: ${root}`); }
  }
  return { roots: [...new Set(roots)], excludedNames: new Set([...DEFAULT_EXCLUSIONS, ...strings(config.excludedNames ?? [], 'excludedNames')]), warnings };
}

async function fingerprintFiles(base, directory, output) {
  let entries;
  try { entries = await fs.readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await fingerprintFiles(base, file, output);
    else if (entry.isFile() && entry.name.endsWith('.md')) {
      const canonical = await guardedPath(file, [await fs.realpath(base)]);
      output.push({ path: path.relative(base, file), sha256: digest(await readSmall(canonical)) });
    }
    if (output.length > 512) fail('Too many rule documents');
  }
}

export async function rulesFingerprint(base, since) {
  const files = [];
  const closeoutPolicy = 'skills/session-closeout/agents/openai.yaml';
  for (const name of ['AGENTS.md', 'AGENTS.override.md', 'examples/codex/GLOBAL-AGENTS-SNIPPET.md', 'skills/session-closeout/SKILL.md', closeoutPolicy]) {
    const file = path.join(base, name);
    const stat = await fs.lstat(file).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (stat?.isFile()) {
      const canonical = await guardedPath(file, [await fs.realpath(base)]);
      const allowedExtensions = name === closeoutPolicy ? ['.yaml'] : undefined;
      files.push({ path: name, sha256: digest(await readSmall(canonical, path.extname(name), undefined, allowedExtensions)) });
    }
  }
  for (const rel of ['docs/hub', 'templates/entity', 'templates/workspace', 'skills/workspace-catalog', 'skills/agency-guide']) {
    await fingerprintFiles(base, path.join(base, rel), files);
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  const fingerprint = digest(JSON.stringify(files));
  return { fingerprint, changed: since ? fingerprint !== since : true, files };
}

function validateEntry(raw) {
  if (!raw || !ID.test(raw.id)) fail('Invalid asset ID');
  const asset = {
    id: raw.id, kind: choice(raw.kind, KINDS, 'kind'), title: text(raw.title, 'title'),
    workspace: text(raw.workspace, 'workspace'), summary: text(raw.summary, 'summary'),
    stage: choice(raw.stage, STAGES, 'stage'), tags: strings(raw.tags, 'tags'),
    repositoryIds: strings(raw.repositoryIds, 'repositoryIds'), uses: strings(raw.uses, 'uses'),
    sources: [],
  };
  for (const field of ['goal']) if (raw[field] != null) asset[field] = text(raw[field], field);
  for (const field of ['ownerPath', 'entrypoint', 'statusFile', 'manualStepsFile']) asset[field] = raw[field] == null ? null : text(raw[field], field);
  if (raw.activity != null) asset.activity = choice(raw.activity, ACTIVITIES, 'activity');
  if (raw.readiness != null) asset.readiness = choice(raw.readiness, READINESS, 'readiness');
  if (raw.priority != null) asset.priority = choice(raw.priority, ['high', 'normal', 'low'], 'priority');
  asset.confirmedAt = raw.confirmedAt == null ? null : date(raw.confirmedAt, 'confirmedAt');
  asset.startedAt = raw.startedAt == null ? null : calendarDate(raw.startedAt, 'startedAt');
  if (!Array.isArray(raw.sources) || raw.sources.length > 100) fail('Invalid sources');
  asset.sources = raw.sources.map(source => ({
    ...(source.path ? { path: text(source.path, 'source.path') } : {}),
    note: text(source.note, 'source.note'),
    ...(source.checkedAt ? { checkedAt: date(source.checkedAt, 'checkedAt') } : {}),
  }));
  return asset;
}

function statusFields(content, assetId) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) fail('STATUS.md requires YAML frontmatter');
  const meta = yaml.load(match[1], { schema: yaml.JSON_SCHEMA });
  if (!meta || typeof meta !== 'object' || Array.isArray(meta) || meta.schemaVersion !== 1) fail('Invalid status frontmatter');
  if (meta.id !== undefined && meta.id !== assetId) fail('Status ID does not match catalogue asset');
  const updates = {};
  if (meta.goal !== undefined) updates.goal = text(meta.goal, 'status goal');
  if (meta.stage !== undefined) updates.stage = choice(meta.stage, STAGES, 'status stage');
  if (meta.activity !== undefined) updates.activity = choice(meta.activity, ACTIVITIES, 'status activity');
  if (meta.readiness !== undefined) updates.readiness = choice(meta.readiness, READINESS, 'status readiness');
  if (meta.confirmedAt !== undefined) updates.confirmedAt = meta.confirmedAt === null ? null : date(meta.confirmedAt, 'status confirmedAt');
  if (meta.startedAt !== undefined) updates.startedAt = meta.startedAt === null ? null : calendarDate(meta.startedAt, 'status startedAt');
  return updates;
}

function checkboxes(content) {
  const items = []; let completed = 0; let fenced = false;
  for (const line of content.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const match = line.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.+)$/);
    if (match) { if (match[1] === ' ') items.push(match[2].slice(0, 2000)); else completed++; }
  }
  return { pending: items.length, completed, items, available: true };
}

export async function loadCatalog(base) {
  const config = await loadConfig(base);
  const localRoots = [await fs.realpath(base)];
  const raw = JSON.parse(await readSmall(await guardedPath(path.join(base, 'catalog/assets.json'), localRoots)));
  if (raw.schemaVersion !== 1 || !Array.isArray(raw.assets) || !Array.isArray(raw.repositories) || raw.assets.length > 1000 || raw.repositories.length > 1000) fail('Invalid catalogue');
  const assets = raw.assets.map(validateEntry);
  const assetIds = new Set(); const repoIds = new Set();
  for (const asset of assets) { if (assetIds.has(asset.id)) fail(`Duplicate asset ID: ${asset.id}`); assetIds.add(asset.id); }
  const repositories = [];
  for (const repo of raw.repositories) {
    if (!ID.test(repo.id) || repoIds.has(repo.id)) fail('Invalid or duplicate repository ID');
    repoIds.add(repo.id);
    const normalized = { id: repo.id, title: text(repo.title, 'repository title'), path: text(repo.path, 'repository path'), checkouts: [] };
    await guardedPath(normalized.path, config.roots, { allowMissing: true });
    if (repo.remoteHint != null) normalized.remoteHint = text(repo.remoteHint, 'remoteHint');
    if (repo.checkouts != null && (!Array.isArray(repo.checkouts) || repo.checkouts.length > 100)) fail('Invalid checkouts');
    for (const checkout of repo.checkouts ?? []) {
      await guardedPath(checkout.path, config.roots, { allowMissing: true });
      normalized.checkouts.push({ path: text(checkout.path, 'checkout path'), role: text(checkout.role, 'checkout role') });
    }
    repositories.push(normalized);
  }
  const warnings = [...config.warnings];
  for (const asset of assets) {
    if (asset.repositoryIds.some(id => !repoIds.has(id))) fail(`Unknown repository relation: ${asset.id}`);
    if (asset.uses.some(id => !assetIds.has(id))) fail(`Unknown asset relation: ${asset.id}`);
    asset.warnings = [];
    asset.manualSteps = { pending: 0, completed: 0, items: [], available: false };
    asset.documentState = asset.statusFile ? 'missing' : 'unregistered';
    // Online source references are links only: validate but never fetch them.
    const localSources = [];
    for (const source of asset.sources) {
      if (!source.path) continue;
      if (/^https?:\/\//i.test(source.path)) {
        let url;
        try { url = new URL(source.path); } catch { fail('Invalid source URL'); }
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) fail('Invalid or credential-bearing source URL');
      } else localSources.push(source.path);
    }
    // Validate all registered local pointers, even if they will not be read.
    for (const pointer of [asset.ownerPath, asset.entrypoint, ...localSources].filter(Boolean)) {
      try { await guardedPath(pointer, config.roots); }
      catch { asset.warnings.push('A registered source is missing, outside allowed roots, or inaccessible'); }
    }
    if (!asset.sources.length) asset.warnings.push('No confirmation source registered');
    if (asset.statusFile) {
      try {
        const file = await guardedPath(asset.statusFile, config.roots);
        if (path.extname(file) !== '.md') fail('Status must be Markdown');
        Object.assign(asset, statusFields(await readSmall(file, '.md', 128 * 1024), asset.id));
        asset.documentState = 'confirmed';
      } catch (error) {
        asset.documentState = error.code === 'ENOENT' ? 'missing' : 'invalid';
        asset.warnings.push('Status document missing, invalid, or outside allowed roots; catalogue values retained');
      }
    } else asset.warnings.push('Status document not registered; initial catalogue summary only');
    if (asset.manualStepsFile) {
      try {
        const file = await guardedPath(asset.manualStepsFile, config.roots);
        if (path.extname(file) !== '.md') fail('Manual steps must be Markdown');
        asset.manualSteps = checkboxes(await readSmall(file, path.extname(file), 128 * 1024));
      } catch { asset.warnings.push('Manual steps document missing, invalid, or outside allowed roots'); }
    }
    warnings.push(...asset.warnings.map(w => `${asset.id}: ${w}`));
  }
  const registered = new Set();
  for (const pointer of [...assets.map(a => a.ownerPath), ...repositories.flatMap(r => [r.path, ...r.checkouts.map(c => c.path)])].filter(Boolean)) {
    try { registered.add(await guardedPath(pointer, config.roots, { allowMissing: true })); } catch { /* Already reported above. */ }
  }
  const discoveries = [];
  for (const root of config.roots) {
    let entries;
    try { entries = await fs.readdir(root, { withFileTypes: true }); }
    catch { warnings.push(`Discovery root unavailable: ${root}`); continue; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith('.') || config.excludedNames.has(entry.name) || DENIED.has(entry.name)) continue;
      const candidate = path.join(root, entry.name);
      if (!registered.has(candidate)) discoveries.push({ path: candidate, title: entry.name, workspace: path.basename(root) });
    }
  }
  return { assets, repositories, discoveries, hubRoot: await fs.realpath(base), generatedAt: new Date().toISOString(), warnings, rulesFingerprint: (await rulesFingerprint(base)).fingerprint };
}

export async function initializeEntity(base, options) {
  if (!ID.test(options.id)) fail('Invalid entity ID');
  const title = text(options.title, 'title');
  if (title.includes('\n') || title.includes('\r')) fail('Title must be a single line');
  choice(options.kind, KINDS, 'kind');
  const config = await loadConfig(base);
  const destination = await guardedPath(options.path, config.roots, { allowMissing: true });
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const newDirectory = await fs.stat(destination).then(() => false).catch(error => { if (error.code === 'ENOENT') return true; throw error; });
  const realBase = await fs.realpath(base);
  const documentLink = relative => path.join(realBase, relative).split(path.sep).map(encodeURIComponent).join(path.sep);
  const replacements = {
    id: options.id, title, kind: options.kind, date: today, startedAt: newDirectory ? today : null,
    hubRulesPath: documentLink('docs/hub/project-rules.md'),
    storageRulesPath: documentLink('docs/hub/storage-and-outputs.md'),
  };
  const files = [];
  const planned = [];
  for (const name of ['README.md', 'AGENTS.md', 'STATUS.md', 'MANUAL_STEPS.md']) {
    const template = await guardedPath(path.join(base, 'templates/entity', name), [await fs.realpath(base)]);
    const content = (await readSmall(template))
      .replace(/"\{\{(id|title|kind|date|startedAt|hubRulesPath|storageRulesPath)\}\}"/g, (_, key) => JSON.stringify(replacements[key]))
      .replace(/\{\{(id|title|kind|date|startedAt|hubRulesPath|storageRulesPath)\}\}/g, (_, key) => key === 'startedAt' ? JSON.stringify(replacements[key]) : replacements[key]);
    const target = path.join(destination, name);
    await guardedPath(target, config.roots, { allowMissing: true });
    let exists = false;
    try { await fs.lstat(target); exists = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    planned.push({ target, content, exists });
  }
  // Complete all path and template checks before any filesystem mutation.
  for (const item of planned) {
    const { target, content } = item;
    let { exists } = item;
    if (options.apply && !exists) {
      await fs.mkdir(destination, { recursive: true });
      await guardedPath(destination, config.roots);
      try { await fs.writeFile(target, content, { flag: 'wx', mode: 0o644 }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; exists = true; }
    }
    files.push({ path: target, action: exists ? 'preserved' : options.apply ? 'created' : 'would-create' });
  }
  return { dryRun: !options.apply, id: options.id, kind: options.kind, path: destination, files, note: 'No catalogue registration or existing document changes performed.' };
}
