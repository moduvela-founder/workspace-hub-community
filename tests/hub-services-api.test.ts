import { afterEach, describe, expect, it, vi } from 'vitest';
const methods = vi.hoisted(() => ({ listServices: vi.fn(), controlService: vi.fn() }));
vi.mock('../src/lib/hub/services.mjs', async importOriginal => ({ ...(await importOriginal() as object), ...methods }));
import { ServiceError, MAX_SERVICE_REQUEST_BYTES } from '../src/lib/hub/services.mjs';
import * as route from '../src/app/api/hub/services/route';
afterEach(() => vi.clearAllMocks());
const request = (body: string, contentType = 'application/json') => new Request('http://127.0.0.1:4176/api/hub/services', { method: 'POST', headers: { 'Content-Type': contentType }, body });

describe('local service HTTP boundary', () => {
  it('returns uncached state and accepts only an ID/action pair for controls', async () => {
    methods.listServices.mockResolvedValue({ schemaVersion: 1, services: [{ id: 'eda', state: 'stopped', canStart: true }] });
    const response = await route.GET();
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ services: [{ id: 'eda', state: 'stopped' }] });
    expect(Object.keys(route).sort()).toEqual(['GET', 'POST', 'dynamic', 'runtime']);
    methods.controlService.mockResolvedValue({ schemaVersion: 1, services: [{ id: 'eda', state: 'running' }] });
    const result = await route.POST(request('{"id":"eda","action":"start"}'));
    expect(result.status).toBe(200);
    expect(methods.controlService).toHaveBeenCalledWith(process.cwd(), 'eda', 'start');
  });
  it('rejects command/env/path injection, malformed JSON, invalid UTF-8 and oversized streams before process control', async () => {
    for (const payload of [
      '{"id":"eda","action":"start","command":"/bin/sh"}', '{"id":"eda","action":"start","env":{}}',
      '{"id":"eda","action":"start","path":"/tmp/config"}', '{"id":"../eda","action":"stop"}',
      '{"id":"eda","action":"restart"}', 'not-json',
    ]) expect((await route.POST(request(payload))).status).toBe(400);
    expect((await route.POST(request('{}', 'text/plain'))).status).toBe(415);
    const huge = request(' '.repeat(MAX_SERVICE_REQUEST_BYTES + 1)); huge.headers.set('Content-Length', '2');
    expect((await route.POST(huge)).status).toBe(413);
    const invalid = new Request('http://127.0.0.1:4176/api/hub/services', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: new Uint8Array([0xff]) });
    expect((await route.POST(invalid)).status).toBe(400);
    expect(methods.controlService).not.toHaveBeenCalled();
  });
  it('returns a safe registered error and suppresses launchctl output or private configuration failures', async () => {
    methods.controlService.mockRejectedValueOnce(new ServiceError(409, 'SERVICE_NOT_CONTROLLABLE', 'The requested service action is unavailable for this process.'));
    const conflict = await route.POST(request('{"id":"eda","action":"stop"}'));
    expect(conflict.status).toBe(409); expect(await conflict.json()).toMatchObject({ code: 'SERVICE_NOT_CONTROLLABLE' });
    methods.controlService.mockRejectedValueOnce(new Error('TOKEN=PRIVATE_SECRET /home/your-user/profile'));
    const failure = await route.POST(request('{"id":"eda","action":"start"}'));
    expect(failure.status).toBe(503); expect(await failure.text()).not.toContain('PRIVATE_SECRET');
    methods.listServices.mockRejectedValueOnce(new Error('PRIVATE_PROCESS_OUTPUT'));
    const readFailure = await route.GET();
    expect(readFailure.status).toBe(503); expect(await readFailure.text()).not.toContain('PRIVATE_PROCESS_OUTPUT');
  });
});
