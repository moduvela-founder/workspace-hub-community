import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { loadServiceRegistry, getServiceMetadata, listServices, controlService, validateServiceRequest } from '../src/lib/hub/services.mjs';

let base: string;
let owner: string;
let registry: { schemaVersion: number; services: any[] };
let loaded: boolean;
let running: boolean;
let launch: ReturnType<typeof vi.fn>;
let fetcher: ReturnType<typeof vi.fn>;
const profileFile = () => path.join(base, '.local/service-profiles.json');
const plistFile = () => path.join(base, '.local/services/eda/service.plist');
const options = () => ({ platform: 'darwin', uid: 123, launch, fetch: fetcher });
const refused = () => Object.assign(new Error('PRIVATE NETWORK DETAIL'), { cause: { code: 'ECONNREFUSED' } });
async function saveRegistry() { await fs.writeFile(path.join(base, 'catalog/services.json'), JSON.stringify(registry)); }
async function saveProfiles(value: unknown) { await fs.writeFile(profileFile(), JSON.stringify(value), { mode: 0o600 }); }
const validProfiles = () => ({ schemaVersion: 1, profiles: { eda: { command: process.execPath, args: ['--eval', 'process.exit(0)'], cwd: owner } } });

beforeEach(async () => {
  base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'hub-services-test-')));
  owner = path.join(base, 'owner');
  await fs.mkdir(owner);
  await fs.mkdir(path.join(base, 'catalog'));
  await fs.mkdir(path.join(base, 'docs/capabilities'), { recursive: true });
  await fs.mkdir(path.join(base, '.local'), { mode: 0o700 });
  await fs.writeFile(path.join(base, 'docs/capabilities/service.md'), '# Service guide\n');
  await fs.writeFile(path.join(base, 'hub.config.json'), JSON.stringify({ schemaVersion: 1, roots: [owner], excludedNames: [] }));
  await fs.writeFile(path.join(base, 'catalog/assets.json'), JSON.stringify({ schemaVersion: 1, repositories: [], assets: [{
    id: 'eda-tool', title: 'EDA tool', kind: 'tool', workspace: 'fixture', summary: 'Registered tool', stage: 'delivered',
    ownerPath: owner, tags: [], repositoryIds: [], uses: [], sources: [],
  }] }));
  registry = { schemaVersion: 1, services: [{ id: 'eda', title: 'EDA bridge', assetIds: ['eda-tool'], transport: 'http-bridge', guide: 'docs/capabilities/service.md', health: { ports: [20123], path: '/health', identity: 'easyeda-bridge' } }] };
  await saveRegistry();
  await saveProfiles(validProfiles());
  loaded = false; running = false;
  launch = vi.fn(async (args: string[]) => {
    if (args[0] === 'print') return loaded ? { ok: true, stdout: `gui/123/service = {\n path = ${plistFile()}\n state = ${running ? 'running' : 'waiting'}\n${running ? ' pid = 999\n' : ''}}` } : { ok: false, missing: true, stdout: '' };
    if (args[0] === 'bootstrap') { loaded = true; running = true; return { ok: true, stdout: '' }; }
    if (args[0] === 'bootout') { loaded = false; running = false; return { ok: true, stdout: '' }; }
    throw new Error('Unexpected mock command');
  });
  fetcher = vi.fn(async () => { throw refused(); });
});
afterEach(async () => { await fs.rm(base, { recursive: true, force: true }); });

describe('registered local services', () => {
  it('resolves only static metadata without reading a private profile or probing services', async () => {
    await fs.writeFile(profileFile(), 'PRIVATE INVALID PROFILE');
    expect(await loadServiceRegistry(base)).toEqual(registry.services);
    expect(await getServiceMetadata(base, 'eda')).toEqual(registry.services[0]);
    expect(await getServiceMetadata(base, 'missing')).toBeNull();
    expect(launch).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    await fs.unlink(path.join(base, 'catalog/services.json'));
    expect(await loadServiceRegistry(base)).toEqual([]);
  });
  it('rejects unregistered assets, duplicate IDs, traversal guides, arbitrary health URLs and linked escapes', async () => {
    const original = structuredClone(registry);
    for (const changes of [
      { id: 123 }, { assetIds: ['not-registered'] }, { guide: '../outside.md' }, { guide: 'docs/../hub/service.md' },
      { health: { ports: [20123], path: 'http://outside.test/health', identity: 'easyeda-bridge' } },
      { health: { ports: [20123, 20123], path: '/health', identity: 'easyeda-bridge' } },
      { command: '/bin/sh' }, { transport: 'stdio' },
    ]) {
      registry = structuredClone(original);
      Object.assign(registry.services[0], changes);
      await saveRegistry();
      await expect(loadServiceRegistry(base)).rejects.toMatchObject({ status: 503, code: 'SERVICES_UNAVAILABLE' });
    }
    registry = structuredClone(original); registry.services.push(structuredClone(registry.services[0]));
    await saveRegistry(); await expect(loadServiceRegistry(base)).rejects.toMatchObject({ status: 503 });
    registry = structuredClone(original); await saveRegistry();
    await fs.unlink(path.join(base, 'docs/capabilities/service.md'));
    await fs.symlink('/etc/hosts', path.join(base, 'docs/capabilities/service.md'));
    await expect(loadServiceRegistry(base)).rejects.toMatchObject({ status: 503 });
    expect(launch).not.toHaveBeenCalled();
  });
  it('starts and stops only an owned LaunchAgent, preserving products and disabling automatic restart', async () => {
    const before = await fs.readFile(path.join(base, 'catalog/assets.json'), 'utf8');
    const stopped = (await listServices(base, options())).services[0];
    expect(stopped).toMatchObject({ state: 'stopped', managed: true, canStart: true, canStop: false });
    expect(await fs.readdir(path.join(base, '.local'))).toEqual(['service-profiles.json']);
    const started = (await controlService(base, 'eda', 'start', options())).services[0];
    expect(started).toMatchObject({ state: 'running', managed: true, canStart: false, canStop: true, health: 'not-ready' });
    const content = await fs.readFile(plistFile(), 'utf8');
    expect(content).toContain('<key>RunAtLoad</key><true/><key>KeepAlive</key><false/>');
    expect(content).toContain('com.moduvela.workspace-hub.service.eda');
    expect((await fs.stat(plistFile())).mode & 0o777).toBe(0o600);
    expect(launch).toHaveBeenCalledWith(['bootstrap', 'gui/123', plistFile()]);
    const stoppedAgain = (await controlService(base, 'eda', 'stop', options())).services[0];
    expect(stoppedAgain).toMatchObject({ state: 'stopped', managed: true, canStart: true, canStop: false });
    expect(launch).toHaveBeenCalledWith(['bootout', 'gui/123/com.moduvela.workspace-hub.service.eda']);
    expect(await fs.readFile(path.join(base, 'catalog/assets.json'), 'utf8')).toBe(before);
    expect(await fs.readdir(path.join(base, '.local/services/eda'))).toEqual(['service.plist']);
  });
  it('checks all ten registered bridge ports without following arbitrary addresses', async () => {
    registry.services[0].health.ports = Array.from({ length: 10 }, (_, index) => 20120 + index);
    await saveRegistry();
    fetcher.mockImplementation(async (url: string) => {
      if (url === 'http://127.0.0.1:20129/health') return new Response(JSON.stringify({ service: 'easyeda-bridge' }));
      throw refused();
    });
    expect((await listServices(base, options())).services[0]).toMatchObject({ state: 'running', managed: false, endpoint: 'http://127.0.0.1:20129' });
    expect(fetcher).toHaveBeenCalledTimes(10);
  });
  it('serializes competing starts, makes owned operations idempotent and never creates duplicate jobs', async () => {
    await Promise.all([controlService(base, 'eda', 'start', options()), controlService(base, 'eda', 'start', options())]);
    expect(launch.mock.calls.filter(call => call[0][0] === 'bootstrap')).toHaveLength(1);
    await Promise.all([controlService(base, 'eda', 'stop', options()), controlService(base, 'eda', 'stop', options())]);
    expect(launch.mock.calls.filter(call => call[0][0] === 'bootout')).toHaveLength(1);
  });
  it('displays an external healthy bridge without adopting it or exposing editor details', async () => {
    fetcher.mockImplementation(async () => new Response(JSON.stringify({ service: 'easyeda-bridge', status: 'ok', edaConnected: true, activeWindowId: 'PRIVATE-EDITOR-WINDOW' })));
    expect((await listServices(base, options())).services[0]).toMatchObject({ state: 'running', managed: false, canStart: false, canStop: false, health: 'ready', endpoint: 'http://127.0.0.1:20123' });
    expect(JSON.stringify(await listServices(base, options()))).not.toContain('PRIVATE-EDITOR-WINDOW');
    for (const action of ['start', 'stop']) await expect(controlService(base, 'eda', action, options())).rejects.toMatchObject({ status: 409, code: 'SERVICE_NOT_CONTROLLABLE' });
    expect(launch.mock.calls.every(call => call[0][0] === 'print')).toBe(true);
    const [url, request] = fetcher.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:20123/health');
    expect(request).toMatchObject({ method: 'GET', redirect: 'error' });
  });
  it('blocks duplicate starts on occupied, oversized or uncertain endpoints and never mistakes health failure for a stopped owned process', async () => {
    for (const response of [
      () => new Response(JSON.stringify({ service: 'different-service' })),
      () => new Response('X'.repeat(8193)),
      () => Promise.reject(new Error('timeout PRIVATE DETAILS')),
    ]) {
      fetcher.mockImplementation(response);
      expect((await listServices(base, options())).services[0]).toMatchObject({ state: 'unknown', canStart: false, canStop: false });
      await expect(controlService(base, 'eda', 'start', options())).rejects.toMatchObject({ status: 409 });
    }
    fetcher.mockImplementation(async () => { throw refused(); });
    await controlService(base, 'eda', 'start', options());
    fetcher.mockImplementation(async () => { throw new Error('timeout'); });
    expect((await listServices(base, options())).services[0]).toMatchObject({ state: 'running', canStart: false, canStop: true });
  });
  it('refuses foreign jobs or changed launch files without overwriting or stopping them', async () => {
    loaded = true; running = true;
    launch.mockImplementation(async () => ({ ok: true, stdout: 'state = running\npid = 123\npath = /outside/private.plist\n' }));
    expect((await listServices(base, options())).services[0]).toMatchObject({ state: 'running', managed: false, canStart: false, canStop: false });
    await expect(controlService(base, 'eda', 'stop', options())).rejects.toMatchObject({ status: 409 });
    expect(launch.mock.calls.every(call => call[0][0] === 'print')).toBe(true);
    loaded = false;
    launch.mockImplementation(async () => ({ ok: false, missing: true, stdout: '' }));
    await fs.mkdir(path.dirname(plistFile()), { recursive: true, mode: 0o700 });
    await fs.writeFile(plistFile(), 'FOREIGN CONFIGURATION', { mode: 0o600 });
    expect((await listServices(base, options())).services[0]).toMatchObject({ state: 'unknown', canStart: false, error: 'Stored launch file does not match the current profile.' });
    await expect(controlService(base, 'eda', 'start', options())).rejects.toMatchObject({ status: 409, code: 'SERVICE_NOT_CONTROLLABLE' });
    expect(await fs.readFile(plistFile(), 'utf8')).toBe('FOREIGN CONFIGURATION');
  });
  it('reports a valid profile change after stopping without promising a conflicting launch can start', async () => {
    await controlService(base, 'eda', 'start', options());
    await controlService(base, 'eda', 'stop', options());
    const existing = await fs.readFile(plistFile(), 'utf8');
    const changed = validProfiles(); changed.profiles.eda.args = ['--eval', 'process.exit(1)']; await saveProfiles(changed);
    expect((await listServices(base, options())).services[0]).toMatchObject({ state: 'unknown', managed: false, canStart: false, canStop: false, error: 'Stored launch file does not match the current profile.' });
    await expect(controlService(base, 'eda', 'start', options())).rejects.toMatchObject({ status: 409, code: 'SERVICE_NOT_CONTROLLABLE' });
    expect(await fs.readFile(plistFile(), 'utf8')).toBe(existing);
    expect(launch.mock.calls.filter(call => call[0][0] === 'bootstrap')).toHaveLength(1);
  });
  it('does not launch stdio servers, unsupported platforms, unsafe profiles or unverifiable process state', async () => {
    registry.services[0].transport = 'stdio'; delete registry.services[0].health; await saveRegistry();
    expect((await listServices(base, options())).services[0]).toMatchObject({ state: 'unavailable', managed: false, canStart: false, canStop: false });
    await expect(controlService(base, 'eda', 'start', options())).rejects.toMatchObject({ status: 409 });
    expect(launch).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
    registry.services[0].transport = 'http-bridge'; await saveRegistry();
    expect((await listServices(base, { ...options(), platform: 'linux' })).services[0].canStart).toBe(false);
    for (const change of [{ cwd: '/tmp' }, { command: 'node' }, { env: { TOKEN: 'PRIVATE' } }, { args: ['\0'] }]) {
      const value = validProfiles(); Object.assign(value.profiles.eda, change); await saveProfiles(value);
      expect((await listServices(base, options())).services[0].canStart).toBe(false);
      await expect(controlService(base, 'eda', 'start', options())).rejects.toMatchObject({ status: 409 });
    }
    await saveProfiles(validProfiles());
    launch.mockImplementation(async () => ({ ok: false, missing: false, stdout: '' }));
    expect((await listServices(base, options())).services[0]).toMatchObject({ state: 'unknown', canStart: false, canStop: false });
  });
  it('rejects exposed or linked profiles and handles a cross-process lock and launch timeout without leaked details', async () => {
    await fs.chmod(profileFile(), 0o644);
    await expect(listServices(base, options())).rejects.toMatchObject({ status: 503 });
    await fs.chmod(profileFile(), 0o600);
    await fs.mkdir(path.dirname(plistFile()), { recursive: true, mode: 0o700 });
    const lock = path.join(path.dirname(plistFile()), '.control.lock');
    await fs.writeFile(lock, 'OTHER OPERATOR');
    await expect(controlService(base, 'eda', 'start', options())).rejects.toMatchObject({ status: 409, code: 'SERVICE_BUSY' });
    expect(await fs.readFile(lock, 'utf8')).toBe('OTHER OPERATOR');
    await fs.unlink(lock);
    launch.mockImplementation(async (args: string[]) => args[0] === 'print' ? { ok: false, missing: true } : { ok: false, timedOut: true, stdout: 'PRIVATE ERROR' });
    await expect(controlService(base, 'eda', 'start', options())).rejects.toMatchObject({ status: 503, code: 'SERVICE_CONTROL_FAILED', message: 'The local process operation timed out.' });
    await expect(fs.lstat(lock)).rejects.toThrow();
    await fs.unlink(profileFile()); await fs.symlink(path.join(owner, 'PRIVATE.json'), profileFile());
    await fs.writeFile(path.join(owner, 'PRIVATE.json'), JSON.stringify(validProfiles()));
    await expect(listServices(base, options())).rejects.toMatchObject({ status: 503 });
  });
  it('rejects linked logging destinations and preserves their external target', async () => {
    await fs.mkdir(path.dirname(plistFile()), { recursive: true, mode: 0o700 });
    const sentinel = path.join(owner, 'sentinel.md'); await fs.writeFile(sentinel, 'UNCHANGED');
    await fs.symlink(sentinel, path.join(path.dirname(plistFile()), 'stdout.log'));
    await expect(controlService(base, 'eda', 'start', options())).rejects.toMatchObject({ status: 503 });
    expect(await fs.readFile(sentinel, 'utf8')).toBe('UNCHANGED');
    expect(launch.mock.calls.every(call => call[0][0] === 'print')).toBe(true);
  });
  it('recovers a trusted lock only when its PID is confirmed absent, then starts exactly once', async () => {
    await fs.mkdir(path.dirname(plistFile()), { recursive: true, mode: 0o700 });
    const lock = path.join(path.dirname(plistFile()), '.control.lock');
    await fs.writeFile(lock, JSON.stringify({ pid: 999999999, createdAt: '2020-01-01T00:00:00.000Z' }), { mode: 0o600 });
    const probePID = vi.fn(async () => 'dead');
    const recoveryOptions = { ...options(), probePID };
    await Promise.all([controlService(base, 'eda', 'start', recoveryOptions), controlService(base, 'eda', 'start', recoveryOptions)]);
    expect(probePID).toHaveBeenCalledTimes(1); expect(probePID).toHaveBeenCalledWith(999999999);
    expect(launch.mock.calls.filter(call => call[0][0] === 'bootstrap')).toHaveLength(1);
    expect(await fs.readdir(path.dirname(plistFile()))).toEqual(['service.plist']);
  });
  it('preserves live, inaccessible, uncertain, malformed or competing recovery locks', async () => {
    await fs.mkdir(path.dirname(plistFile()), { recursive: true, mode: 0o700 });
    const lock = path.join(path.dirname(plistFile()), '.control.lock');
    const valid = JSON.stringify({ pid: 999999999, createdAt: '2020-01-01T00:00:00.000Z' });
    for (const value of ['alive', 'unknown', undefined, new Error('EPERM PRIVATE DETAILS')]) {
      await fs.writeFile(lock, valid, { mode: 0o600 });
      const probePID = vi.fn(async () => { if (value instanceof Error) throw value; return value; });
      await expect(controlService(base, 'eda', 'start', { ...options(), probePID })).rejects.toMatchObject({ status: 409, code: 'SERVICE_BUSY' });
      expect(await fs.readFile(lock, 'utf8')).toBe(valid);
      expect(await fs.readdir(path.dirname(plistFile()))).toEqual(['.control.lock']);
    }
    for (const value of ['INVALID', JSON.stringify({ pid: -1, createdAt: '2020-01-01T00:00:00.000Z' }), JSON.stringify({ pid: 999999999, createdAt: 'not-a-date' }), JSON.stringify({ pid: 999999999, createdAt: '2020-01-01T00:00:00.000Z', command: '/bin/sh' })]) {
      await fs.writeFile(lock, value);
      const probePID = vi.fn(async () => 'dead');
      await expect(controlService(base, 'eda', 'start', { ...options(), probePID })).rejects.toMatchObject({ status: 409, code: 'SERVICE_BUSY' });
      expect(await fs.readFile(lock, 'utf8')).toBe(value); expect(probePID).not.toHaveBeenCalled();
    }
    await fs.writeFile(lock, valid); await fs.chmod(lock, 0o644);
    await expect(controlService(base, 'eda', 'start', { ...options(), probePID: () => 'dead' })).rejects.toMatchObject({ status: 409, code: 'SERVICE_BUSY' });
    await fs.chmod(lock, 0o600);
    const recoveryLock = path.join(path.dirname(plistFile()), '.recovery.lock'); await fs.writeFile(recoveryLock, 'ANOTHER RECOVERER', { mode: 0o600 });
    await expect(controlService(base, 'eda', 'start', { ...options(), probePID: () => 'dead' })).rejects.toMatchObject({ status: 409, code: 'SERVICE_BUSY' });
    expect(await fs.readFile(recoveryLock, 'utf8')).toBe('ANOTHER RECOVERER'); expect(await fs.readFile(lock, 'utf8')).toBe(valid);
    expect(launch.mock.calls.every(call => call[0][0] === 'print')).toBe(true);
  });
  it('does not remove a new lock swapped in during stale PID verification', async () => {
    await fs.mkdir(path.dirname(plistFile()), { recursive: true, mode: 0o700 });
    const lock = path.join(path.dirname(plistFile()), '.control.lock');
    await fs.writeFile(lock, JSON.stringify({ pid: 999999999, createdAt: '2020-01-01T00:00:00.000Z' }), { mode: 0o600 });
    const replacement = JSON.stringify({ pid: 12345, createdAt: '2026-01-01T00:00:00.000Z' });
    const probePID = async () => {
      await fs.rename(lock, `${lock}.old`);
      await fs.writeFile(lock, replacement, { mode: 0o600 });
      return 'dead';
    };
    await expect(controlService(base, 'eda', 'start', { ...options(), probePID })).rejects.toMatchObject({ status: 409, code: 'SERVICE_BUSY' });
    expect(await fs.readFile(lock, 'utf8')).toBe(replacement);
    expect(launch.mock.calls.every(call => call[0][0] === 'print')).toBe(true);
  });
  it('rejects browser command injection and unregistered IDs before launch or storage writes', async () => {
    for (const payload of [{ id: 'eda', action: 'start', command: '/bin/sh' }, { id: '../eda', action: 'stop' }, { id: 'eda', action: 'restart' }, { id: 'eda', action: 'start', env: {} }]) {
      expect(() => validateServiceRequest(payload)).toThrow();
    }
    await expect(controlService(base, 'not-registered', 'start', options())).rejects.toMatchObject({ status: 404 });
    expect(launch).not.toHaveBeenCalled();
    expect(await fs.readdir(path.join(base, '.local'))).toEqual(['service-profiles.json']);
  });
});
