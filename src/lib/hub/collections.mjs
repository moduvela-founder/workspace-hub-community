import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import yaml from 'js-yaml';
import { guardedPath, loadCatalog, loadConfig } from './core.mjs';

const ASSET_ID = /^[a-z0-9][a-z0-9._-]{0,99}$/;
const MEMBER_ID = /^[a-z0-9][a-z0-9._/-]{0,239}$/;
const FILE_LIMIT = 256 * 1024;
const TOTAL_LIMIT = 32 * 1024 * 1024;
const COUNT_LIMIT = 500;
const inside = (root, candidate) => candidate === root || candidate.startsWith(root + path.sep);
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const excluded = name => name.startsWith('.') || /^(?:node_modules|vendor|dist|build|out|tmp|temp|credentials?|secrets?|backups?|archives?|chats?|conversations?|memory|worktrees)$/i.test(name)
  || /^(?:context|credentials?|secrets?|passwords?|tokens?|chat(?:[-_].*)?|conversation(?:[-_].*)?)\.(?:md|json|txt)$/i.test(name);

function relative(value, { dot = false } = {}) {
  if (typeof value !== 'string' || value.length > 240 || (!value && !dot) || value.includes('\\') || path.isAbsolute(value)) fail('INVALID_COLLECTION', 'Collection paths must be relative');
  if (value === '.' && dot) return value;
  if (value.split('/').some(part => !part || part === '.' || part === '..' || excluded(part))) fail('INVALID_COLLECTION', 'Collection path is excluded or escapes its root');
  return value;
}

async function safeRead(file, roots, limit) {
  const canonical = await guardedPath(file, roots);
  if (canonical !== path.resolve(file)) fail('COLLECTION_PATH_ESCAPE', 'Symbolic collection paths are not readable');
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > limit) fail('COLLECTION_LIMIT', 'Collection document exceeds the supported size');
    const bytes = await handle.readFile();
    if (bytes.length > limit) fail('COLLECTION_LIMIT', 'Collection document exceeds the supported size');
    return bytes;
  } finally { await handle.close(); }
}

async function context(base, requestedId) {
  const assetId = typeof requestedId === 'string' ? requestedId.replace(/^workspace-hub:/, '') : requestedId;
  if (typeof assetId !== 'string' || !ASSET_ID.test(assetId)) fail('INVALID_ASSET_ID', 'Invalid asset ID');
  const realBase = await fs.realpath(base);
  const catalog = await loadCatalog(base);
  const asset = catalog.assets.find(item => item.id === assetId);
  if (!asset) fail('ASSET_NOT_FOUND', 'Asset does not exist');
  const config = await loadConfig(base);
  let raw;
  try { raw = JSON.parse((await safeRead(path.join(realBase, 'catalog/collections.json'), [realBase], FILE_LIMIT)).toString('utf8')); }
  catch (error) { if (error.code === 'ENOENT') return { assetId, asset, config, collection: null }; throw error; }
  if (!raw || raw.schemaVersion !== 1 || !Array.isArray(raw.collections) || raw.collections.length > 1000) fail('INVALID_COLLECTION', 'Invalid collection registry');
  const ids = new Set();
  for (const item of raw.collections) {
    if (!item || typeof item !== 'object' || Object.keys(item).some(key => !['assetId', 'rootRelative', 'include', 'kind', 'metadata'].includes(key)) || !ASSET_ID.test(item.assetId)
      || ids.has(item.assetId) || !catalog.assets.some(entry => entry.id === item.assetId) || !['role', 'skill', 'reference'].includes(item.kind) || !['frontmatter', 'document'].includes(item.metadata)
      || !Array.isArray(item.include) || !item.include.length || item.include.length > 100) fail('INVALID_COLLECTION', 'Invalid or duplicate collection registration');
    ids.add(item.assetId);
    relative(item.rootRelative, { dot: true });
    item.include.forEach(value => relative(value, { dot: true }));
    if (new Set(item.include).size !== item.include.length) fail('INVALID_COLLECTION', 'Duplicate collection include');
  }
  const collection = raw.collections.find(item => item.assetId === assetId) ?? null;
  return { assetId, asset, config, collection };
}

export async function collectionInfo(base, assetId) {
  const { collection } = await context(base, assetId);
  if (!collection) return null;
  return { kind: collection.kind, metadata: collection.metadata, rootRelative: collection.rootRelative, include: [...collection.include] };
}

function queryTerms(query, required) {
  if (query === undefined && !required) return [];
  if (typeof query !== 'string' || !query.trim() || query.length > 200 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(query)) fail('INVALID_QUERY', 'Query must contain 1–200 printable characters');
  return query.trim().toLocaleLowerCase().split(/\s+/);
}

function metadata(content, mode) {
  if (mode === 'frontmatter') {
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!match) fail('INVALID_MEMBER', 'Missing member frontmatter');
    let parsed;
    try { parsed = yaml.load(match[1], { schema: yaml.JSON_SCHEMA }); } catch { fail('INVALID_MEMBER', 'Invalid member frontmatter'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || typeof parsed.name !== 'string' || !parsed.name.trim() || parsed.name.length > 200
      || typeof parsed.description !== 'string' || parsed.description.length > 1600) fail('INVALID_MEMBER', 'Invalid member name or description');
    return { title: parsed.name.replace(/[\r\n]/g, ' ').trim(), description: parsed.description.replace(/[\r\n]/g, ' ').trim() };
  }
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '');
  const heading = body.match(/^#\s+(.+)$/m);
  return { title: heading ? heading[1].trim().slice(0, 200) : '', description: '' };
}

async function readMembers(ctx) {
  const { asset, config, collection } = ctx;
  if (!collection) fail('COLLECTION_NOT_FOUND', 'No collection registered for this asset');
  if (!asset.ownerPath) fail('COLLECTION_UNAVAILABLE', 'Collection owner path is unavailable');
  const owner = await guardedPath(asset.ownerPath, config.roots);
  const root = await guardedPath(path.resolve(owner, collection.rootRelative), config.roots);
  if (!inside(owner, root) || root !== path.resolve(owner, collection.rootRelative) || !(await fs.lstat(root)).isDirectory()) fail('COLLECTION_PATH_ESCAPE', 'Collection root must remain within its owner directory');
  const warnings = [];
  const files = new Map();
  const visited = new Set();
  let visitedEntries = 0;
  async function walk(directory) {
    if (visited.has(directory)) return;
    visited.add(directory);
    const canonical = await guardedPath(directory, config.roots);
    if (canonical !== directory || !inside(root, canonical)) fail('COLLECTION_PATH_ESCAPE', 'Collection directory escaped its registered root');
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (++visitedEntries > 5000) fail('COLLECTION_LIMIT', 'Collection traversal exceeds 5000 entries');
      if (excluded(entry.name) || config.excludedNames.has(entry.name)) continue;
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) { warnings.push(`Symbolic link skipped: ${path.relative(root, file)}`); continue; }
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile() && /\.md$/i.test(entry.name)) {
        const relativeFile = path.relative(root, file).split(path.sep).join('/');
        const normalized = relativeFile.replace(/\.md$/i, '').toLowerCase();
        const id = MEMBER_ID.test(normalized) && normalized.split('/').every(part => /^[a-z0-9][a-z0-9._-]*$/.test(part) && part !== '.' && part !== '..')
          ? normalized : `document-${crypto.createHash('sha256').update(relativeFile).digest('hex').slice(0, 24)}`;
        if (files.has(id) && files.get(id) !== file) fail('DUPLICATE_MEMBER', 'Duplicate member ID');
        files.set(id, file);
        if (files.size > COUNT_LIMIT) fail('COLLECTION_LIMIT', 'Collection exceeds 500 Markdown files');
      } else if (entry.isFile() && /\.pdf$/i.test(entry.name)) warnings.push(`PDF content unsupported: ${path.relative(root, file)}`);
    }
  }
  for (const include of collection.include) {
    const directory = path.resolve(root, include);
    const canonical = await guardedPath(directory, config.roots);
    if (!inside(root, canonical) || directory !== canonical || !(await fs.lstat(directory)).isDirectory()) fail('COLLECTION_PATH_ESCAPE', 'Include must be a directory inside the collection root');
    await walk(directory);
  }
  let totalBytes = 0;
  const records = [];
  for (const [id, file] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    const bytes = await safeRead(file, config.roots, FILE_LIMIT);
    totalBytes += bytes.length;
    if (totalBytes > TOTAL_LIMIT) fail('COLLECTION_LIMIT', 'Collection exceeds 32 MiB');
    const content = bytes.toString('utf8');
    let fields;
    try { fields = metadata(content, collection.metadata); }
    catch { warnings.push(`Invalid member metadata skipped: ${id}`); continue; }
    const relativeFile = path.relative(root, file).split(path.sep).join('/');
    records.push({ member: { id, ...fields, title: fields.title || path.basename(file, path.extname(file)), group: relativeFile.includes('/') ? relativeFile.split('/')[0] : '', kind: collection.kind, path: file,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex') }, content });
  }
  return { records, warnings };
}

/**
 * @param {string} base
 * @param {string} assetId
 * @param {{query?: string, mode?: 'metadata' | 'content'}} [options]
 */
export async function listMembers(base, assetId, options = {}) {
  const { query, mode = 'metadata' } = options;
  if (!['metadata', 'content'].includes(mode)) fail('INVALID_QUERY', 'Unsupported member search mode');
  const terms = queryTerms(query, mode === 'content');
  const ctx = await context(base, assetId);
  const { records, warnings } = await readMembers(ctx);
  const members = [];
  for (const { member, content } of records) {
    const searchable = mode === 'content' ? content : [member.id, member.title, member.description, member.group, member.kind].join('\n');
    if (!terms.every(term => searchable.toLocaleLowerCase().includes(term))) continue;
    if (mode === 'metadata') members.push(member);
    else {
      const matches = [];
      let matchedLines = 0;
      for (const [index, line] of content.split(/\r?\n/).entries()) {
        const lowered = line.toLocaleLowerCase();
        const positions = terms.map(term => lowered.indexOf(term)).filter(position => position >= 0);
        if (!positions.length) continue;
        matchedLines++;
        if (matches.length < 5) {
          const position = Math.min(...positions);
          const start = Math.max(0, position - 65);
          matches.push({ line: index + 1, excerpt: line.slice(start, start + 240) });
        }
      }
      members.push({ ...member, matches, matchedLines, truncated: matchedLines > matches.length });
    }
  }
  return { schemaVersion: 1, assetId: ctx.assetId, total: records.length, matched: members.length, mode, members, warnings, readOnly: true };
}

export async function resolveMember(base, assetId, memberId) {
  if (typeof memberId !== 'string' || !MEMBER_ID.test(memberId) || memberId.split('/').some(part => !part || part === '.' || part === '..' || excluded(part))) fail('INVALID_MEMBER_ID', 'Invalid member ID');
  const result = await listMembers(base, assetId);
  const member = result.members.find(item => item.id === memberId);
  if (!member) fail('MEMBER_NOT_FOUND', 'Member does not exist in the registered collection');
  return { schemaVersion: 1, assetId: result.assetId, member, warnings: result.warnings, readOnly: true };
}
