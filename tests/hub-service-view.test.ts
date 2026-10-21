import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ServiceControls, { formatServiceReference, serviceAction, serviceErrorLabel, serviceOwnerLabel, validServices, type HubService } from '../src/app/hub/service-controls';

function service(overrides: Partial<HubService> = {}): HubService {
  return { id: 'easyeda-bridge', title: '嘉立创EDA 桥接服务', assetIds: ['easyeda-api-skill'], transport: 'http-bridge', guide: '/fixture/README.md', state: 'stopped', managed: true, canStart: true, canStop: false, ...overrides };
}
function render(services: HubService[], overrides = {}) {
  return renderToStaticMarkup(createElement(ServiceControls, { services, assetTitle: '嘉立创EDA API', copied: false, pending: {}, errors: {}, stale: false, onAction: () => {}, onCopy: () => {}, ...overrides }));
}

describe('service card controls and handoff', () => {
  it('copies a stable asset index and short instruction without transient service details', () => {
    const reference = formatServiceReference({ id: 'easyeda-api-skill', title: '嘉立创EDA API' }, '/fixture/hub');
    expect(reference).toBe('workspace-hub:easyeda-api-skill\n名称：嘉立创EDA API\n索引库：/fixture/hub/catalog/assets.json\n\n任务：读取该工具的服务接入说明，查询当前状态并接入已启动的服务。');
    expect(reference).not.toContain('http://');
    expect(reference).not.toContain('运行中');
  });

  it('uses server capabilities and never offers control for client-managed processes', () => {
    expect(serviceAction(service())).toBe('start');
    expect(serviceAction(service({ state: 'running', canStart: false, canStop: true }))).toBe('stop');
    expect(serviceAction(service({ managed: false, canStop: true }))).toBeNull();
    expect(serviceAction(service({ state: 'unavailable', canStart: false }))).toBeNull();
    expect(render([service({ managed: false, transport: 'stdio' })])).toContain('客户端托管');
    expect(render([service({ managed: false })])).not.toContain('aria-label="启动');
    expect(serviceOwnerLabel(service({ state: 'running', managed: false }))).toBe('外部启动');
    expect(serviceOwnerLabel(service({ state: 'unavailable', managed: false }))).toBe('未配置');
  });

  it('disables operations while busy or stale and keeps failures visible beside the service', () => {
    const busy = render([service()], { pending: { 'easyeda-bridge': 'start' } });
    expect(busy).toContain('启动中');
    expect(busy).toContain('disabled=""');
    const stale = render([service({ state: 'running', canStop: true, canStart: false })], { stale: true });
    expect(stale).toContain('待刷新');
    expect(stale).toContain('disabled=""');
    const failed = render([service()], { errors: { 'easyeda-bridge': '启动失败，请检查入口' } });
    expect(failed).toContain('role="status"');
    expect(failed).toContain('启动失败，请检查入口');
    expect(failed).toContain('已停止');
  });

  it('has no controls on an unregistered asset and displays a shared copy action for multiple services', () => {
    expect(render([])).toBe('');
    const output = render([service(), service({ id: 'another-service', title: '另一个服务' })], { detailed: true });
    expect(output.match(/aria-label="复制接入/g)).toHaveLength(1);
    expect(output).toContain('另一个服务');
    expect(output).toContain('/fixture/README.md');
  });

  it('rejects malformed or ambiguous registries without treating them as live state', () => {
    expect(validServices({ schemaVersion: 1, services: [] })).toBe(true);
    expect(validServices({ schemaVersion: 1, services: [service()] })).toBe(true);
    expect(validServices({ schemaVersion: 2, services: [service()] })).toBe(false);
    expect(validServices({ schemaVersion: 1, services: [service(), service()] })).toBe(false);
    expect(validServices({ schemaVersion: 1, services: [{ ...service(), state: 'connected' }] })).toBe(false);
    expect(validServices({ schemaVersion: 1, services: [{ ...service(), canStart: 'yes' }] })).toBe(false);
    expect(validServices({ schemaVersion: 1, services: [{ ...service(), assetIds: [42] }] })).toBe(false);
    expect(validServices({ schemaVersion: 1, services: [null] })).toBe(false);
  });

  it('presents concise Chinese failures while retaining underlying details for inspection', () => {
    const original = 'The local process operation timed out.';
    expect(serviceErrorLabel(original)).toBe('进程操作超时，请检查状态');
    const output = render([service({ error: original })]);
    expect(output).toContain('进程操作超时，请检查状态');
    expect(output).toContain(`title="${original}"`);
  });
});
