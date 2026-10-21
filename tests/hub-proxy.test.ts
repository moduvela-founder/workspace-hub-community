import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '../src/proxy';
afterEach(() => vi.unstubAllEnvs());
function req(path = '/api/hub/layout', method = 'PUT', headers: Record<string, string> = {}) {
  return new NextRequest(`http://127.0.0.1:4176${path}`, { method, headers: { host: '127.0.0.1:4176', origin: 'http://127.0.0.1:4176', 'content-type': 'application/json', ...headers } });
}
describe('catalogue proxy with bounded local write exceptions', () => {
  it('allows only same-origin JSON layout PUT and catalogue reads', () => {
    expect(proxy(req()).headers.get('x-middleware-next')).toBe('1');
    for (const path of ['/hub', '/api/hub/catalog', '/api/hub/layout', '/api/hub/asset', '/api/hub/members', '/api/hub/services']) {
      expect(proxy(req(path, 'GET')).headers.get('x-middleware-next')).toBe('1');
      expect(proxy(req(path, 'HEAD')).headers.get('x-middleware-next')).toBe('1');
    }
    expect(proxy(req('/api/hub/layout', 'PUT', { 'content-type': 'application/json; charset=utf-8' })).status).toBe(200);
    expect(proxy(req('/api/hub/layout', 'PUT', { 'content-type': 'text/plain' })).status).toBe(415);
  });
  it('permits only same-origin JSON POST to the exact registered service endpoint', () => {
    expect(proxy(req('/api/hub/services', 'POST')).headers.get('x-middleware-next')).toBe('1');
    expect(proxy(req('/api/hub/services', 'POST', { 'content-type': 'text/plain' })).status).toBe(415);
    for (const headers of [
      { origin: 'http://localhost:4176' }, { origin: 'http://127.0.0.1:9999' },
      { origin: 'https://127.0.0.1:4176' }, { origin: 'null' }, { host: 'localhost:9999' },
      { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' },
    ]) expect(proxy(req('/api/hub/services', 'POST', headers)).status).toBe(403);
    const missing = req('/api/hub/services', 'POST'); missing.headers.delete('origin');
    expect(proxy(missing).status).toBe(403);
    for (const method of ['PUT', 'PATCH', 'DELETE', 'OPTIONS']) expect(proxy(req('/api/hub/services', method)).status).toBe(405);
    expect(proxy(req('/api/hub/services/extra', 'POST')).status).toBe(405);
    expect(proxy(req('/api/hub/services/extra', 'GET')).status).toBe(404);
  });
  it('compares full Host, port, scheme and Origin and requires Origin for the write', () => {
    for (const headers of [
      { host: '127.0.0.1:9999' }, { origin: 'http://localhost:4176' }, { origin: 'http://127.0.0.1:9999' },
      { origin: 'https://127.0.0.1:4176' }, { origin: 'http://127.0.0.1:4176/path' },
      { origin: 'http://user@127.0.0.1:4176' }, { origin: 'null' },
      { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' },
    ]) expect(proxy(req('/api/hub/layout', 'PUT', headers))).toMatchObject({ status: 403 });
    const missing = req(); missing.headers.delete('origin');
    expect(proxy(missing).status).toBe(403);
    const read = req('/hub', 'GET'); read.headers.delete('origin');
    expect(proxy(read).headers.get('x-middleware-next')).toBe('1');
    vi.stubEnv('PORT', '9876');
    expect(proxy(req()).status).toBe(403);
  });
  it('leaves project, task, device and upstream mutation entry points inaccessible', () => {
    for (const method of ['POST', 'PATCH', 'DELETE', 'OPTIONS']) expect(proxy(req('/api/hub/layout', method)).status).toBe(405);
    for (const path of ['/hub', '/api/hub/catalog', '/api/hub/asset', '/api/projects', '/api/tasks', '/api/devices']) {
      expect(proxy(req(path, 'PUT')).status).toBe(405);
    }
    for (const path of ['/api/tasks', '/api/projects', '/api/devices', '/api/hub/layout/extra']) expect(proxy(req(path, 'GET')).status).toBe(404);
  });
});
