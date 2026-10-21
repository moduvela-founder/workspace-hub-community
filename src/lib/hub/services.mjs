import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadCatalog, loadConfig, guardedPath } from './core.mjs';

export const MAX_SERVICE_REQUEST_BYTES = 4096;
const MAX_FILE_BYTES = 64 * 1024;
const ID = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const TRANSPORTS = ['http-bridge', 'stdio', 'streamable-http'];
const exec = promisify(execFile);
const queues = globalThis[Symbol.for('moduvela.workspace-hub.service-queues')] ??= new Map();
const inside = (root, target) => target === root || target.startsWith(root + path.sep);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const keys = (value, allowed, required = allowed) => object(value) && Object.keys(value).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(value, key));
const validText = (value, max = 4096) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value);
const digest = value => crypto.createHash('sha256').update(value).digest('hex');

export class ServiceError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const unavailable = () => { throw new ServiceError(503, 'SERVICES_UNAVAILABLE', 'Local service configuration is unavailable.'); };

async function readRegular(file, { optional = false, privateFile = false } = {}) {
  let handle;
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES
      || (privateFile && ((stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid())))) unavailable();
    handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = await handle.stat();
    if (opened.ino !== stat.ino || opened.dev !== stat.dev || opened.size > MAX_FILE_BYTES) unavailable();
    const value = await handle.readFile('utf8');
    if (Buffer.byteLength(value) > MAX_FILE_BYTES) unavailable();
    return value;
  } catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
  finally { await handle?.close(); }
}

/** Static pointers only: no machine profile, launchctl, process or health reads. */
export async function loadServiceRegistry(base) {
  try {
    const root = await fs.realpath(base);
    const file = path.join(root, 'catalog/services.json');
    const source = await readRegular(file, { optional: true });
    if (source === null) return [];
    if (await fs.realpath(file) !== file) unavailable();
    const raw = JSON.parse(source);
    if (!keys(raw, ['schemaVersion', 'services']) || raw.schemaVersion !== 1 || !Array.isArray(raw.services) || raw.services.length > 100) unavailable();
    const registered = new Set((await loadCatalog(root)).assets.map(asset => asset.id));
    const seen = new Set();
    const services = [];
    for (const item of raw.services) {
      if (!keys(item, ['id', 'title', 'assetIds', 'transport', 'guide', 'health'], ['id', 'title', 'assetIds', 'transport', 'guide'])
        || typeof item.id !== 'string' || !ID.test(item.id) || seen.has(item.id) || !validText(item.title, 200) || !TRANSPORTS.includes(item.transport)
        || !Array.isArray(item.assetIds) || !item.assetIds.length || item.assetIds.length > 30
        || item.assetIds.some(id => typeof id !== 'string' || !registered.has(id)) || new Set(item.assetIds).size !== item.assetIds.length
        || typeof item.guide !== 'string' || !/^docs\/(?:[a-zA-Z0-9._-]+\/)*[a-zA-Z0-9._-]+\.md$/.test(item.guide)
        || item.guide.split('/').some(part => part === '..' || part === '.')) unavailable();
      const guide = await guardedPath(path.join(root, item.guide), [root]);
      if (!(await fs.stat(guide)).isFile()) unavailable();
      let health;
      if (item.health !== undefined) {
        if (!keys(item.health, ['ports', 'path', 'identity']) || !Array.isArray(item.health.ports) || !item.health.ports.length || item.health.ports.length > 16
          || item.health.ports.some(port => !Number.isInteger(port) || port < 1 || port > 65535)
          || new Set(item.health.ports).size !== item.health.ports.length || item.health.path !== '/health' || typeof item.health.identity !== 'string' || !ID.test(item.health.identity)
          || item.transport === 'stdio') unavailable();
        health = { ports: [...item.health.ports], path: '/health', identity: item.health.identity };
      }
      seen.add(item.id);
      services.push({ id: item.id, title: item.title, assetIds: [...item.assetIds], transport: item.transport, guide: item.guide, ...(health ? { health } : {}) });
    }
    return services;
  } catch { unavailable(); }
}

export async function getServiceMetadata(base, id) {
  return (await loadServiceRegistry(base)).find(service => service.id === id) ?? null;
}

async function directory(file, create = false) {
  let stat;
  try { stat = await fs.lstat(file); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (!create) return false;
    await fs.mkdir(file, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    stat = await fs.lstat(file);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(file) !== file
    || (process.getuid && stat.uid !== process.getuid())) unavailable();
  return stat;
}

async function profiles(root) {
  if (!await directory(path.join(root, '.local'))) return {};
  const source = await readRegular(path.join(root, '.local/service-profiles.json'), { optional: true, privateFile: true });
  if (source === null) return {};
  const value = JSON.parse(source);
  if (!keys(value, ['schemaVersion', 'profiles']) || value.schemaVersion !== 1 || !object(value.profiles) || Object.keys(value.profiles).length > 100) unavailable();
  return value.profiles;
}

async function validateProfile(root, raw) {
  if (!keys(raw, ['command', 'args', 'cwd']) || !validText(raw.command) || !path.isAbsolute(raw.command)
    || !validText(raw.cwd) || !path.isAbsolute(raw.cwd) || !Array.isArray(raw.args) || raw.args.length > 100
    || raw.args.some(arg => typeof arg !== 'string' || arg.length > 4096 || arg.includes('\0'))) unavailable();
  const [command, cwd, config] = await Promise.all([fs.realpath(raw.command), fs.realpath(raw.cwd), loadConfig(root)]);
  const roots = [root, ...config.roots];
  // Profiles are administrator-owned files; browser requests cannot supply any of these values.
  if (!roots.some(base => inside(base, cwd)) || !(await fs.stat(cwd)).isDirectory() || !(await fs.stat(command)).isFile()) unavailable();
  await fs.access(command, constants.X_OK);
  return { command, args: [...raw.args], cwd };
}

const xmlEscape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const label = id => `com.moduvela.workspace-hub.service.${id}`;
function locations(root, id) {
  const local = path.join(root, '.local');
  const parent = path.join(local, 'services');
  const own = path.join(parent, id);
  return { local, parent, own, plist: path.join(own, 'service.plist'), lock: path.join(own, '.control.lock') };
}
function plist(root, service, profile, location) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- workspace-hub owner=${digest(root)} profile=${digest(JSON.stringify(profile))} -->
<plist version="1.0"><dict>
<key>Label</key><string>${label(service.id)}</string>
<key>ProgramArguments</key><array>${[profile.command, ...profile.args].map(arg => `<string>${xmlEscape(arg)}</string>`).join('')}</array>
<key>WorkingDirectory</key><string>${xmlEscape(profile.cwd)}</string>
<key>RunAtLoad</key><true/><key>KeepAlive</key><false/>
<key>StandardOutPath</key><string>${xmlEscape(path.join(location.own, 'stdout.log'))}</string>
<key>StandardErrorPath</key><string>${xmlEscape(path.join(location.own, 'stderr.log'))}</string>
</dict></plist>
`;
}

async function launch(args) {
  try { const result = await exec('/bin/launchctl', args, { timeout: 6000, maxBuffer: 64 * 1024, encoding: 'utf8' }); return { ok: true, stdout: result.stdout }; }
  catch (error) {
    const missing = !error.killed && /could not find service|service not found/i.test(String(error.stderr));
    return { ok: false, missing, stdout: '', timedOut: Boolean(error.killed) };
  }
}
function dependencies(options = {}) {
  return { platform: options.platform ?? process.platform, uid: options.uid ?? process.getuid?.(), launch: options.launch ?? launch,
    fetch: options.fetch ?? globalThis.fetch, probePID: options.probePID ?? probePID };
}
function probePID(pid) {
  try { process.kill(pid, 0); return 'alive'; }
  catch (error) { return error.code === 'ESRCH' ? 'dead' : 'unknown'; }
}
async function job(root, service, profile, deps) {
  if (deps.platform !== 'darwin' || !Number.isInteger(deps.uid)) return { known: false, present: false, owned: false, running: false };
  const result = await deps.launch(['print', `gui/${deps.uid}/${label(service.id)}`]);
  if (!result.ok) return { known: Boolean(result.missing), present: false, owned: false, running: false };
  const location = locations(root, service.id);
  let owned = false;
  if (profile) {
    try {
      if (await directory(location.local) && await directory(location.parent) && await directory(location.own)) {
        const recorded = await readRegular(location.plist, { optional: true, privateFile: true });
        const printedPath = result.stdout.match(/^\s*path = (.+)\s*$/m)?.[1]?.trim();
        owned = recorded === plist(root, service, profile, location) && printedPath === location.plist;
      }
    } catch { /* A mismatching or linked job is never adopted. */ }
  }
  return { known: true, present: true, owned, running: /\bstate = running\b|\bpid = [1-9]\d*\b/.test(result.stdout) };
}

async function probe(service, deps) {
  if (!service.health) return { ready: false, contacted: false, uncertain: false };
  const results = await Promise.all(service.health.ports.map(async port => {
    const endpoint = `http://127.0.0.1:${port}`;
    try {
      const response = await deps.fetch(`${endpoint}/health`, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(1200), cache: 'no-store' });
      const reader = response.body?.getReader();
      let size = 0; const chunks = [];
      if (!reader) return { ready: false, contacted: true, uncertain: false };
      try {
        while (true) {
          const part = await reader.read(); if (part.done) break;
          size += part.value.byteLength;
          if (size > 8192) { await reader.cancel(); return { ready: false, contacted: true, uncertain: false }; }
          chunks.push(part.value);
        }
      } finally { reader.releaseLock(); }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      return { ready: response.ok && body?.service === service.health.identity, contacted: true, uncertain: false, endpoint };
    } catch (error) {
      if (error.cause?.code === 'ECONNREFUSED' || error.code === 'ECONNREFUSED') return { ready: false, contacted: false, uncertain: false };
      return { ready: false, contacted: false, uncertain: true };
    }
  }));
  return results.find(result => result.ready) ?? { ready: false, contacted: results.some(result => result.contacted), uncertain: results.some(result => result.uncertain) };
}

async function storedProfileMatches(root, service, profile) {
  const location = locations(root, service.id);
  try {
    for (const file of [location.local, location.parent, location.own]) if (!await directory(file)) return true;
    const recorded = await readRegular(location.plist, { optional: true, privateFile: true });
    return recorded === null || recorded === plist(root, service, profile, location);
  } catch { return false; }
}

async function inspect(root, service, configured, deps) {
  const common = { id: service.id, title: service.title, assetIds: service.assetIds, transport: service.transport, guide: service.guide };
  if (service.transport === 'stdio') return { ...common, state: 'unavailable', managed: false, canStart: false, canStop: false, health: 'unknown', error: 'This stdio server is managed by its MCP client.' };
  let profile = null; let profileInvalid = false;
  if (Object.hasOwn(configured, service.id)) {
    try { profile = await validateProfile(root, configured[service.id]); }
    catch { profileInvalid = true; }
  }
  const [current, health, matches] = await Promise.all([job(root, service, profile, deps), probe(service, deps), profile ? storedProfileMatches(root, service, profile) : true]);
  const supported = deps.platform === 'darwin' && Number.isInteger(deps.uid);
  const storedConflict = Boolean(profile && !matches);
  const blocked = current.present && !current.owned;
  const state = current.running || health.ready ? 'running'
    : current.present || !current.known || health.contacted || health.uncertain || storedConflict ? 'unknown'
      : profile && supported ? 'stopped' : 'unavailable';
  return { ...common, state, managed: Boolean(profile && supported && !storedConflict && (current.owned || (!current.present && !health.ready && !health.contacted && !health.uncertain))),
    canStart: Boolean(profile && supported && !storedConflict && current.known && !current.present && !health.ready && !health.contacted && !health.uncertain),
    canStop: Boolean(profile && supported && current.present && current.owned),
    health: health.ready ? 'ready' : service.health ? 'not-ready' : 'unknown',
    ...(health.ready ? { endpoint: health.endpoint } : {}),
    ...(storedConflict ? { error: 'Stored launch file does not match the current profile.' }
      : blocked ? { error: 'The existing service job belongs to another configuration.' }
      : profileInvalid ? { error: 'The local launch profile is invalid or unavailable.' }
        : !profile ? { error: 'No local launch profile is configured.' }
          : !supported ? { error: 'Local process controls require macOS.' }
            : health.ready && !current.present ? { error: 'This running service was started outside Workspace Hub.' }
              : !current.known ? { error: 'The process state could not be verified.' }
                : health.contacted && !health.ready ? { error: 'A registered port did not return the expected service identity.' }
                  : health.uncertain && !current.present ? { error: 'The registered service endpoint could not be verified.' } : {}) };
}

export async function listServices(base, options = {}) {
  try {
    const root = await fs.realpath(base);
    const registry = await loadServiceRegistry(root);
    const configured = await profiles(root);
    const deps = dependencies(options);
    return { schemaVersion: 1, services: await Promise.all(registry.map(service => inspect(root, service, configured, deps))) };
  } catch { unavailable(); }
}

export function validateServiceRequest(payload) {
  if (!keys(payload, ['id', 'action']) || typeof payload.id !== 'string' || !ID.test(payload.id) || !['start', 'stop'].includes(payload.action)) {
    throw new ServiceError(400, 'INVALID_SERVICE_REQUEST', 'Request must contain only a registered service ID and start or stop action.');
  }
  return payload;
}

async function createDirectories(location) {
  for (const file of [location.local, location.parent]) await directory(file, true);
  return directory(location.own, true);
}
const busy = () => { throw new ServiceError(409, 'SERVICE_BUSY', 'Another local service operation is active, or its lock could not be safely recovered.'); };
const sameFile = (first, second) => first && second && first.ino === second.ino && first.dev === second.dev;
async function acquireControlLock(location, ownDirectory, deps) {
  const open = file => fs.open(file, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { return await open(location.lock); }
  catch (error) { if (error.code !== 'EEXIST') unavailable(); }
  // Competing recoverers cannot both unlink a stale lock. A retained recovery lock is conservative: never adopt or delete it.
  const recoveryPath = path.join(location.own, '.recovery.lock');
  let recovery;
  try { recovery = await open(recoveryPath); }
  catch (error) { if (error.code === 'EEXIST') busy(); unavailable(); }
  const ownRecovery = await recovery.stat();
  try {
    const previous = await fs.lstat(location.lock).catch(() => null);
    if (!previous?.isFile() || previous.isSymbolicLink() || (previous.mode & 0o777) !== 0o600
      || (process.getuid && previous.uid !== process.getuid())) busy();
    let record;
    try { record = JSON.parse(await readRegular(location.lock, { privateFile: true })); }
    catch { busy(); }
    if (!keys(record, ['pid', 'createdAt']) || !Number.isSafeInteger(record.pid) || record.pid <= 0
      || typeof record.createdAt !== 'string' || !Number.isFinite(Date.parse(record.createdAt))
      || new Date(record.createdAt).toISOString() !== record.createdAt) busy();
    let state;
    try { state = await deps.probePID(record.pid); }
    catch { busy(); }
    if (state !== 'dead') busy();
    const currentDirectory = await directory(location.own).catch(() => null);
    const currentLock = await fs.lstat(location.lock).catch(() => null);
    if (!sameFile(currentDirectory, ownDirectory) || !sameFile(currentLock, previous) || currentLock.isSymbolicLink()) busy();
    await fs.unlink(location.lock);
    try { return await open(location.lock); }
    catch (error) { if (error.code === 'EEXIST') busy(); unavailable(); }
  } finally {
    await recovery.close();
    const currentDirectory = await directory(location.own).catch(() => null);
    const currentRecovery = await fs.lstat(recoveryPath).catch(() => null);
    if (sameFile(currentDirectory, ownDirectory) && sameFile(currentRecovery, ownRecovery) && !currentRecovery.isSymbolicLink()) await fs.unlink(recoveryPath);
  }
}
async function ensurePlist(root, service, profile, location) {
  const expected = plist(root, service, profile, location);
  const existing = await readRegular(location.plist, { optional: true, privateFile: true });
  if (existing !== null && existing !== expected) throw new ServiceError(409, 'SERVICE_OWNERSHIP_CONFLICT', 'The existing launch file belongs to another configuration.');
  if (existing !== null) return;
  const handle = await fs.open(location.plist, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { await handle.writeFile(expected); await handle.sync(); }
  finally { await handle.close(); }
}

export async function controlService(base, id, action, options = {}) {
  validateServiceRequest({ id, action });
  const root = await fs.realpath(base).catch(unavailable);
  const queueId = `${root}:${id}`;
  const prior = queues.get(queueId) ?? Promise.resolve();
  const operation = prior.catch(() => {}).then(async () => {
    const registry = await loadServiceRegistry(root);
    const service = registry.find(item => item.id === id);
    if (!service) throw new ServiceError(404, 'SERVICE_NOT_FOUND', 'The requested service is not registered.');
    const configured = await profiles(root).catch(unavailable);
    const deps = dependencies(options);
    const current = await inspect(root, service, configured, deps);
    // Idempotent operations still require verified ownership. External processes are never adopted.
    if (action === 'start' && current.canStop) return listServices(root, options);
    if (action === 'stop' && current.managed && current.state === 'stopped') return listServices(root, options);
    if (!current[action === 'start' ? 'canStart' : 'canStop']) throw new ServiceError(409, 'SERVICE_NOT_CONTROLLABLE', 'The requested service action is unavailable for this process.');
    const profile = await validateProfile(root, configured[id]).catch(unavailable);
    const location = locations(root, id);
    const ownDirectory = await createDirectories(location);
    const lock = await acquireControlLock(location, ownDirectory, deps);
    const ownLock = await lock.stat();
    try {
      await lock.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
      const latest = await inspect(root, service, configured, deps);
      if (!latest[action === 'start' ? 'canStart' : 'canStop']) throw new ServiceError(409, 'SERVICE_NOT_CONTROLLABLE', 'The service state changed before this operation.');
      const currentDirectory = await directory(location.own);
      if (!currentDirectory || currentDirectory.ino !== ownDirectory.ino || currentDirectory.dev !== ownDirectory.dev) unavailable();
      await ensurePlist(root, service, profile, location);
      if (action === 'start') {
        for (const name of ['stdout.log', 'stderr.log']) {
          const log = await fs.lstat(path.join(location.own, name)).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
          if (log && (!log.isFile() || log.isSymbolicLink() || (process.getuid && log.uid !== process.getuid()))) unavailable();
        }
      }
      const args = action === 'start' ? ['bootstrap', `gui/${deps.uid}`, location.plist] : ['bootout', `gui/${deps.uid}/${label(id)}`];
      const result = await deps.launch(args);
      if (!result.ok) throw new ServiceError(503, 'SERVICE_CONTROL_FAILED', result.timedOut ? 'The local process operation timed out.' : 'The local process operation failed.');
      return await listServices(root, options);
    } finally {
      await lock.close();
      // Never follow a replaced service directory while removing the lock.
      const currentDirectory = await directory(location.own).catch(() => null);
      if (currentDirectory?.ino === ownDirectory.ino && currentDirectory?.dev === ownDirectory.dev) {
        const currentLock = await fs.lstat(location.lock).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
        if (currentLock?.ino === ownLock.ino && currentLock?.dev === ownLock.dev && !currentLock.isSymbolicLink()) await fs.unlink(location.lock);
      }
    }
  });
  const settled = operation.catch(() => {});
  queues.set(queueId, settled);
  try { return await operation; }
  finally { if (queues.get(queueId) === settled) queues.delete(queueId); }
}
