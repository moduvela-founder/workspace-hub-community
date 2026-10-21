"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Clipboard, LoaderCircle, Play, Square } from "lucide-react";
import { formatReference } from "../../lib/hub/reference.mjs";

export type HubService = {
  id: string;
  title: string;
  assetIds: string[];
  transport: "http-bridge" | "stdio" | "streamable-http";
  guide: string;
  state: "running" | "stopped" | "unknown" | "unavailable";
  managed: boolean;
  canStart: boolean;
  canStop: boolean;
  endpoint?: string;
  health?: "ready" | "not-ready" | "unknown";
  error?: string;
};
type ServicesResult = { schemaVersion: 1; services: HubService[] };
export type ServiceAction = "start" | "stop";

export function validServices(value: unknown): value is ServicesResult {
  if (!value || typeof value !== "object") return false;
  const result = value as ServicesResult;
  if (result.schemaVersion !== 1 || !Array.isArray(result.services)) return false;
  const ids = new Set<string>();
  return result.services.every(service => {
    if (!service || typeof service !== "object" || typeof service.id !== "string" || !service.id || ids.has(service.id)) return false;
    ids.add(service.id);
    return typeof service.title === "string" && Array.isArray(service.assetIds) && service.assetIds.every(id => typeof id === "string")
      && ["http-bridge", "stdio", "streamable-http"].includes(service.transport)
      && typeof service.guide === "string" && ["running", "stopped", "unknown", "unavailable"].includes(service.state)
      && typeof service.managed === "boolean" && typeof service.canStart === "boolean" && typeof service.canStop === "boolean"
      && (service.endpoint === undefined || typeof service.endpoint === "string")
      && (service.error === undefined || typeof service.error === "string");
  });
}

export function formatServiceReference(asset: { id: string; title: string }, hubRoot: string) {
  return `${formatReference(asset, hubRoot)}\n\n任务：读取该工具的服务接入说明，查询当前状态并接入已启动的服务。`;
}

export function serviceAction(service: HubService): ServiceAction | null {
  if (!service.managed) return null;
  if (service.canStop) return "stop";
  if (service.canStart) return "start";
  return null;
}

export function serviceOwnerLabel(service: HubService) {
  if (service.transport === "stdio") return "客户端托管";
  if (service.state === "running" && !service.managed) return "外部启动";
  if (!service.managed && service.state === "unavailable") return "未配置";
  return service.managed ? "暂不可操作" : "状态待确认";
}

export function serviceErrorLabel(value: string) {
  const messages: Record<string, string> = {
    "This stdio server is managed by its MCP client.": "由 MCP 客户端启动",
    "The existing service job belongs to another configuration.": "服务由其他配置管理",
    "The local launch profile is invalid or unavailable.": "启动配置需检查",
    "No local launch profile is configured.": "尚未配置启动方式",
    "Local process controls require macOS.": "进程控制需要 macOS",
    "This running service was started outside Workspace Hub.": "外部启动，仅展示状态",
    "The process state could not be verified.": "无法确认进程状态",
    "A registered port did not return the expected service identity.": "端口服务身份不匹配",
    "The registered service endpoint could not be verified.": "无法确认服务地址",
    "Local service configuration is unavailable.": "本机服务配置暂不可读",
    "Local services are unavailable.": "本机服务暂不可读",
    "The existing launch file belongs to another configuration.": "启动文件由其他配置管理",
    "Stored launch file does not match the current profile.": "启动配置已变更，请按说明更新",
    "The requested service is not registered.": "服务尚未登记",
    "The requested service action is unavailable for this process.": "当前进程不支持此操作",
    "Another local service operation is in progress.": "其他服务操作正在进行",
    "Another local service operation is active, or its lock could not be safely recovered.": "服务操作正在进行，请稍后重试",
    "The service state changed before this operation.": "状态已变化，请刷新后重试",
    "The local process operation timed out.": "进程操作超时，请检查状态",
    "The local process operation failed.": "进程操作失败，请检查入口",
    "Request must contain only a registered service ID and start or stop action.": "服务操作请求无效",
    "JSON content type is required.": "服务操作请求格式无效",
    "A JSON body is required.": "服务操作请求内容缺失",
    "A valid UTF-8 JSON body is required.": "服务操作请求内容无效",
    "Service request exceeds the size limit.": "服务操作请求过长",
  };
  return messages[value] || (/[\u3400-\u9fff]/.test(value) ? value : "服务异常，请检查接入说明");
}

// One registry request for the page, shared by cards and the detail panel.
export function useServiceRegistry() {
  const [services, setServices] = useState<HubService[]>([]);
  const [ready, setReady] = useState(false);
  const [readError, setReadError] = useState("");
  const [pending, setPending] = useState<Record<string, ServiceAction>>({});
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const reads = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const operations = useRef(new Set<string>());
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; reads.current?.abort(); }; }, []);

  const refreshServices = useCallback(async () => {
    reads.current?.abort();
    const controller = new AbortController(); reads.current = controller;
    const current = ++sequence.current;
    try {
      const response = await fetch("/api/hub/services", { signal: controller.signal, cache: "no-store" });
      if (!response.ok) throw new Error(`服务状态读取失败（HTTP ${response.status}）`);
      const result: unknown = await response.json();
      if (!validServices(result)) throw new Error("服务登记返回格式异常");
      if (mounted.current && current === sequence.current) { setServices(result.services); setReady(true); setReadError(""); }
    } catch (cause) {
      if (!controller.signal.aborted && mounted.current && current === sequence.current) setReadError(cause instanceof Error ? cause.message : "无法读取本机服务状态");
    }
  }, []);

  const operateService = useCallback(async (id: string, action: ServiceAction) => {
    if (operations.current.has(id)) return;
    operations.current.add(id);
    setPending(previous => ({ ...previous, [id]: action }));
    setActionErrors(previous => { const next = { ...previous }; delete next[id]; return next; });
    try {
      const response = await fetch("/api/hub/services", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action }) });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(typeof result?.error === "string" ? serviceErrorLabel(result.error) : `服务操作失败（HTTP ${response.status}）`);
      // Status is measured again instead of optimistically claiming a process is running.
      await refreshServices();
    } catch (cause) {
      if (mounted.current) setActionErrors(previous => ({ ...previous, [id]: cause instanceof Error ? cause.message : "服务操作失败，请刷新状态后重试" }));
      await refreshServices();
    } finally {
      operations.current.delete(id);
      if (mounted.current) setPending(previous => { const next = { ...previous }; delete next[id]; return next; });
    }
  }, [refreshServices]);

  return { services, ready, readError, pending, actionErrors, refreshServices, operateService };
}

const stateLabels: Record<HubService["state"], string> = { running: "运行中", stopped: "已停止", unknown: "待确认", unavailable: "不可用" };
const transportLabels: Record<HubService["transport"], string> = { "http-bridge": "HTTP 桥接", stdio: "stdio", "streamable-http": "Streamable HTTP" };

export default function ServiceControls({ services, assetTitle, copied, pending, errors, stale, detailed = false, onAction, onCopy }: {
  services: HubService[];
  assetTitle: string;
  copied: boolean;
  pending: Record<string, ServiceAction>;
  errors: Record<string, string>;
  stale: boolean;
  detailed?: boolean;
  onAction: (id: string, action: ServiceAction) => void;
  onCopy: () => void;
}) {
  if (!services.length) return null;
  return <div className={`hub-service-controls ${detailed ? "is-detailed" : ""}`} onClick={event => event.stopPropagation()}>
    {services.map((service, index) => {
      const action = serviceAction(service);
      const busy = pending[service.id];
      const error = errors[service.id] || service.error;
      return <div className="hub-service-item" key={service.id}>
        <div className="hub-service-row">
          <span className={`hub-service-state state-${stale ? "unknown" : service.state}`} title={stale ? "状态暂不可读，显示上次读取的登记" : service.title}><i/>{busy ? busy === "start" ? "启动中" : "停止中" : stale ? "待刷新" : stateLabels[service.state]}</span>
          <span className="hub-service-title" title={service.title}>{detailed || services.length > 1 ? service.title : "MCP 服务"}</span>
          {action ? <button className={`hub-service-action ${action === "stop" ? "is-stop" : ""}`} disabled={Boolean(busy) || stale} onClick={() => onAction(service.id, action)} aria-label={`${action === "start" ? "启动" : "停止"} ${service.title}`}>
            {busy ? <LoaderCircle size={11} className="hub-spin"/> : action === "start" ? <Play size={11}/> : <Square size={10}/>}{action === "start" ? "启动" : "停止"}
          </button> : <small className="hub-service-owner">{serviceOwnerLabel(service)}</small>}
          {index === 0 && <button className="hub-service-copy" onClick={onCopy} aria-label={`复制接入 ${assetTitle}`} title="复制接入索引给新的 session">{copied ? <Check size={11}/> : <Clipboard size={11}/>}<span>{copied ? "已复制" : "复制接入"}</span></button>}
        </div>
        {error && <p className="hub-service-error" role="status" title={error}>{serviceErrorLabel(error)}</p>}
        {detailed && <div className="hub-service-guide"><small>{transportLabels[service.transport]} · 服务进程状态{service.health === "ready" ? " · 接口可响应" : service.health === "not-ready" ? " · 接口未就绪" : ""}</small><span>使用入口</span><code>{service.guide || "接入说明待登记"}</code>{service.endpoint && <><span>当前地址</span><code>{service.endpoint}</code></>}</div>}
      </div>;
    })}
  </div>;
}
