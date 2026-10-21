import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadCatalog } from './core.mjs';

export const MAX_LAYOUT_BYTES = 64 * 1024;
export const MAX_LAYOUT_ITEMS = 1000;
const ID = /^[a-z0-9][a-z0-9._-]{0,99}$/;
const queueKey = Symbol.for('moduvela.workspace-hub.layout-queues');
const queues = globalThis[queueKey] ??= new Map();
const emptyLayout = () => ({ schemaVersion: 1, order: [], revision: 0 });

export class LayoutError extends Error {
  constructor(status, code, message, layout) {
    super(message);
    this.status = status;
    this.code = code;
    if (layout) this.layout = layout;
  }
}
const invalid = () => { throw new LayoutError(400, 'INVALID_LAYOUT', 'Layout must contain unique registered asset IDs and a valid revision.'); };
const unavailable = () => { throw new LayoutError(503, 'LAYOUT_UNAVAILABLE', 'Local layout storage or catalogue is unavailable.'); };

function validate(value, stored = false) {
  const keys = stored ? ['schemaVersion', 'order', 'revision'] : ['order', 'revision'];
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))
    || (stored && value.schemaVersion !== 1)
    || !Number.isSafeInteger(value.revision) || value.revision < 0 || (!stored && value.revision >= Number.MAX_SAFE_INTEGER)
    || !Array.isArray(value.order) || value.order.length > MAX_LAYOUT_ITEMS
    || value.order.some(id => typeof id !== 'string' || !ID.test(id))
    || new Set(value.order).size !== value.order.length) invalid();
  return { schemaVersion: 1, order: [...value.order], revision: value.revision };
}

async function paths(base) {
  const root = await fs.realpath(base);
  return { root, directory: path.join(root, '.local'), file: path.join(root, '.local', 'view-preferences.json') };
}

// Reject links even when their target is within the workspace. Browser input never supplies paths.
async function checkDirectory(location, create = false) {
  let stat;
  try { stat = await fs.lstat(location.directory); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (!create) return null;
    try { await fs.mkdir(location.directory, { mode: 0o700 }); }
    catch (cause) { if (cause.code !== 'EEXIST') throw cause; }
    stat = await fs.lstat(location.directory);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(location.directory) !== location.directory) unavailable();
  return stat;
}

async function readStored(location) {
  if (!await checkDirectory(location)) return emptyLayout();
  let handle;
  try {
    const stat = await fs.lstat(location.file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_LAYOUT_BYTES) unavailable();
    handle = await fs.open(location.file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size > MAX_LAYOUT_BYTES || opened.ino !== stat.ino || opened.dev !== stat.dev) unavailable();
    const content = await handle.readFile('utf8');
    if (Buffer.byteLength(content) > MAX_LAYOUT_BYTES) unavailable();
    return validate(JSON.parse(content), true);
  } catch (error) {
    if (error.code === 'ENOENT') return emptyLayout();
    unavailable();
  } finally { await handle?.close(); }
}

async function ids(base) {
  const catalog = await loadCatalog(base);
  return new Set(catalog.assets.map(asset => asset.id));
}
const visible = (layout, registered) => ({ ...layout, order: layout.order.filter(id => registered.has(id)) });

export async function getLayout(base) {
  try {
    const location = await paths(base);
    const [layout, registered] = await Promise.all([readStored(location), ids(location.root)]);
    return visible(layout, registered);
  } catch { unavailable(); }
}

async function atomicSave(location, layout) {
  const directory = await checkDirectory(location, true);
  const temp = path.join(location.directory, `.view-preferences-${crypto.randomUUID()}.tmp`);
  let handle;
  try {
    handle = await fs.open(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    await handle.writeFile(JSON.stringify(layout, null, 2) + '\n', 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    const current = await checkDirectory(location);
    if (!current || current.ino !== directory.ino || current.dev !== directory.dev) unavailable();
    // Do not replace a linked destination introduced after the initial read.
    try {
      const target = await fs.lstat(location.file);
      if (!target.isFile() || target.isSymbolicLink()) unavailable();
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await fs.rename(temp, location.file);
  } finally {
    await handle?.close();
    // Never follow a swapped directory while cleaning an unsuccessful temporary write.
    const current = await checkDirectory(location).catch(() => null);
    if (current?.ino === directory.ino && current?.dev === directory.dev) await fs.unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

export async function saveLayout(base, payload) {
  const desired = validate(payload);
  let location;
  try { location = await paths(base); }
  catch { unavailable(); }
  // Shared by route-module instances in one server process; errors never poison the queue.
  const prior = queues.get(location.root) ?? Promise.resolve();
  const operation = prior.catch(() => {}).then(async () => {
    try {
      const [current, registered] = await Promise.all([readStored(location), ids(location.root)]);
      if (desired.order.some(id => !registered.has(id))) invalid();
      if (desired.revision !== current.revision) {
        throw new LayoutError(409, 'REVISION_CONFLICT', 'Layout changed in another view. Reload before saving.', visible(current, registered));
      }
      const next = { schemaVersion: 1, order: desired.order, revision: current.revision + 1 };
      if (Buffer.byteLength(JSON.stringify(next, null, 2) + '\n') > MAX_LAYOUT_BYTES) invalid();
      await atomicSave(location, next);
      return next;
    } catch (error) {
      if (error instanceof LayoutError && error.status !== 503) throw error;
      unavailable();
    }
  });
  const settled = operation.catch(() => {});
  queues.set(location.root, settled);
  try { return await operation; }
  finally { if (queues.get(location.root) === settled) queues.delete(location.root); }
}
