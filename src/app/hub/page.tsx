"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Archive, ArrowDownUp, ArrowUpRight, ArrowUpToLine, BookOpen, Box, Check, ChevronRight, CircleHelp, Clipboard, Compass, ExternalLink, FileText, FolderGit2, GripVertical, Layers3, ListChecks, LoaderCircle, Menu, RefreshCw, Search, Server, Settings2, ShieldCheck, Sparkles, WandSparkles, Wrench, X } from "lucide-react";
import type { AssetKind as Kind, HubAsset as Asset, HubCatalog as Catalog } from "@/lib/hub/types";
import { assetView, intention, blocked, archived, unconfirmed, type View, type Focus } from "@/lib/hub/view";
import { canonicalOrder, moveToFront, reorderVisible } from "@/lib/hub/order";
import { formatReference } from "@/lib/hub/reference.mjs";
import CollectionMembers from "./collection-members";
import ServiceControls, { formatServiceReference, useServiceRegistry } from "./service-controls";
import "./hub.css";

type Layout = { schemaVersion: number; order: string[]; revision: number };
function validLayout(value: Layout) { return value?.schemaVersion === 1 && Array.isArray(value.order) && value.order.every(id => typeof id === "string") && Number.isSafeInteger(value.revision) && value.revision >= 0; }

const categories = [
  { id: "product" as Kind, label: "产品", icon: Box, description: "围绕交付目标推进的产品" },
  { id: "tool" as Kind, label: "工具", icon: Wrench, description: "可独立使用的通用能力" },
  { id: "framework" as Kind, label: "框架与组件", icon: Layers3, description: "可集成复用的基础能力" },
  { id: "ai" as Kind, label: "AI 生成", icon: WandSparkles, description: "图像、音视频与内容创作项目" },
  { id: "skill" as Kind, label: "技能", icon: Sparkles, description: "供 agent 按需使用的技能与角色入口" },
  { id: "workflow" as Kind, label: "发布与工程流程", icon: ListChecks, description: "发布、打包、分发与工程工作方法" },
  { id: "reference" as Kind, label: "资料", icon: BookOpen, description: "参考资料与需要关注的信息" },
];
const words: Record<string, string> = {
  intention: "意向", intent: "意向", planned: "意向", idea: "意向", research: "调研", discovery: "调研",
  design: "设计", implementation: "实现", development: "开发", validation: "验证", delivery: "交付", delivered: "交付", released: "已发布",
  maintenance: "维护", maintaining: "维护中", active: "推进中", blocked: "阻塞", paused: "暂缓", deferred: "暂缓", archived: "归档",
  unknown: "待确认", "to-confirm": "待确认", unverified: "待验证", verified: "已验证可用", ready: "可用", available: "可用",
  partial: "部分可用", "partially-available": "部分可用", "not-implemented": "未实现", unimplemented: "未实现", candidate: "候选", low: "低", normal: "普通", medium: "普通", high: "高",
};
function label(value?: string) { return value ? words[value.toLowerCase()] || value : "待确认"; }
function warningLabel(value: string) {
  const translations: Record<string, string> = {
    "Status document not registered; initial catalogue summary only": "尚未映射状态入口，目前显示首次登记摘要",
    "Status document missing, invalid, or outside allowed roots; catalogue values retained": "状态文档缺失、格式异常或不在允许目录内，目前保留登记摘要",
    "Manual steps document missing, invalid, or outside allowed roots": "人工步骤文档缺失、格式异常或不在允许目录内",
    "A registered source is missing, outside allowed roots, or inaccessible": "某个已登记来源缺失、不在允许目录内或无法读取",
    "No confirmation source registered": "尚未登记确认依据",
    "Configured root unavailable:": "配置的工作空间目录无法读取：",
    "Discovery root unavailable:": "待发现的工作空间目录无法读取：",
  };
  let output = value;
  for (const [original, translated] of Object.entries(translations)) output = output.replace(original, translated);
  return output;
}
function date(value?: string | null, time = false) {
  if (!value) return "待确认";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", year: "numeric", ...(time ? { hour: "2-digit", minute: "2-digit" } as const : {}) }).format(parsed);
}

function PathRow({ title, path }: { title: string; path?: string | null }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!path) return null;
  async function copy() {
    try { await navigator.clipboard.writeText(path!); setCopied(true); setFailed(false); window.setTimeout(() => setCopied(false), 1600); }
    catch { setFailed(true); }
  }
  return <div className="hub-path-row"><div><span>{title}</span><code>{path}</code>{failed && <small>无法复制，请选中路径手动复制</small>}</div><button className="hub-icon-button" onClick={copy} aria-label={`复制${title}`} title={copied ? "已复制" : "复制路径"}>{copied ? <Check size={15}/> : <Clipboard size={15}/>}</button></div>;
}

export default function HubPage() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>("all");
  const [focus, setFocus] = useState<Focus>("all");
  const [workspace, setWorkspace] = useState("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("manual");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [showDiscoveries, setShowDiscoveries] = useState(false);
  const [showWarnings, setShowWarnings] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);
  const [layout, setLayout] = useState<Layout>({ schemaVersion: 1, order: [], revision: 0 });
  const [layoutReady, setLayoutReady] = useState(false);
  const [layoutSaving, setLayoutSaving] = useState(false);
  const layoutBusy = useRef(false);
  const [layoutMessage, setLayoutMessage] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [referencePreview, setReferencePreview] = useState("");
  const [locateId, setLocateId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { services, ready: servicesReady, readError: servicesError, pending: servicePending, actionErrors: serviceErrors, refreshServices, operateService } = useServiceRegistry();
  const serviceAssetIds = useMemo(() => services.flatMap(service => service.assetIds), [services]);

  const refresh = useCallback(async (visible = false) => {
    if (visible) setLoading(true);
    try {
      const [response, layoutResponse] = await Promise.all([
        fetch("/api/hub/catalog", { cache: "no-store" }),
        fetch("/api/hub/layout", { cache: "no-store" }).catch(() => null),
        refreshServices(),
      ]);
      if (!response.ok) throw new Error(`索引读取失败（HTTP ${response.status}）`);
      const next = await response.json() as Catalog;
      if (!Array.isArray(next.assets) || !Array.isArray(next.repositories)) throw new Error("索引返回格式异常");
      setCatalog(next); setError("");
      if (layoutResponse?.ok) {
        const preference = await layoutResponse.json() as Layout;
        if (!validLayout(preference)) { setLayoutReady(false); setLayoutMessage("布局记录格式异常，排序未保存；请检查本机布局文件。"); }
        else {
          if (!layoutBusy.current) setLayout(previous => preference.revision >= previous.revision ? preference : previous);
          setLayoutReady(true);
          setLayoutMessage(previous => previous.startsWith("布局未读取") ? "" : previous);
        }
      } else { setLayoutReady(false); setLayoutMessage("布局未读取，当前排序未保存；请刷新重试。"); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "无法读取本地索引"); }
    finally { setLoading(false); }
  }, [refreshServices]);
  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), 30_000); return () => window.clearInterval(timer); }, [refresh]);
  useEffect(() => {
    if (!selectedId && !mobileMenu) return;
    function key(event: KeyboardEvent) { if (event.key === "Escape") { setSelectedId(null); setMobileMenu(false); } }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [selectedId, mobileMenu]);
  useEffect(() => {
    if (!selectedId || !dialogRef.current) return;
    const priorFocus = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog.querySelector<HTMLButtonElement>("button")?.focus();
    function trap(event: KeyboardEvent) {
      if (event.key !== "Tab") return;
      const controls = [...dialog.querySelectorAll<HTMLElement>("button:not([disabled]),a[href],input,select,[tabindex='0']")];
      if (!controls.length) return;
      const first = controls[0]; const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    dialog.addEventListener("keydown", trap);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { dialog.removeEventListener("keydown", trap); document.body.style.overflow = previousOverflow; if (priorFocus?.isConnected) priorFocus.focus(); };
  }, [selectedId]);

  const assets = catalog?.assets || [];
  const order = useMemo(() => canonicalOrder(assets, layout.order), [assets, layout.order]);
  const workspaces = useMemo(() => [...new Set(assets.map(asset => asset.workspace).filter(Boolean))].sort(), [assets]);
  const pending = assets.reduce((sum, asset) => sum + (asset.manualSteps?.pending || 0), 0);
  const selected = assets.find(asset => asset.id === selectedId);
  const selectedServices = selected ? services.filter(service => service.assetIds.includes(selected.id)) : [];
  const consumers = selected ? assets.filter(asset => asset.kind === "product" && asset.uses.includes(selected.id)) : [];
  const activeCategory = categories.find(category => category.id === view);
  const { filtered, categoryCounts: counts, globalCategoryCounts: globalCounts, focusCounts, globalFocusCounts, totalCount, serviceCount, globalServiceCount } = useMemo(
    () => assetView(assets, { view, focus, workspace, query, sort, order, serviceAssetIds }),
    [assets, view, workspace, focus, query, sort, order, serviceAssetIds]);
  function clearLocateLink() {
    setHighlightId(null);
    const url = new URL(window.location.href);
    if (url.searchParams.has("asset")) { url.searchParams.delete("asset"); window.history.replaceState(null, "", url.pathname + url.search); }
  }
  function navigate(next: View) { clearLocateLink(); setView(next); setMobileMenu(false); }
  function selectFocus(next: Focus) { clearLocateLink(); setFocus(next); }
  async function saveOrder(nextOrder: string[]) {
    if (layoutBusy.current || !layoutReady || nextOrder.join("\n") === order.join("\n")) return;
    const previous = layout;
    layoutBusy.current = true; setLayoutSaving(true); setLayoutMessage("正在保存排序…");
    setLayout({ ...layout, order: nextOrder });
    try {
      const response = await fetch("/api/hub/layout", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order: nextOrder, revision: previous.revision }) });
      const result = await response.json();
      if (!response.ok) {
        setLayout(validLayout(result.layout) ? result.layout : previous);
        setLayoutMessage(response.status === 409 ? "其他窗口已更新布局，已载入最新顺序；请重试。" : "排序未保存，已恢复原顺序；请刷新后重试。");
        return;
      }
      if (!validLayout(result)) throw new Error("Invalid layout response");
      setLayout(result); setLayoutMessage("排序已保存");
    } catch { setLayout(previous); setLayoutMessage("排序未保存，已恢复原顺序；请刷新后重试。"); }
    finally { layoutBusy.current = false; setLayoutSaving(false); }
  }
  function reorder(from: string, to: string) {
    if (sort !== "manual" || !layoutReady || layoutSaving) return;
    void saveOrder(reorderVisible(order, filtered.map(asset => asset.id), from, to));
  }
  function locate(id: string) {
    setMobileMenu(false); setLocateId(id);
    window.history.replaceState(null, "", `/hub?asset=${encodeURIComponent(id)}`);
  }
  useEffect(() => {
    function readLink() { const id = new URL(window.location.href).searchParams.get("asset"); if (id && /^[a-z0-9][a-z0-9._-]{0,99}$/.test(id)) setLocateId(id); }
    readLink(); window.addEventListener("popstate", readLink);
    return () => window.removeEventListener("popstate", readLink);
  }, []);
  useEffect(() => {
    if (!locateId || !catalog) return;
    if (!catalog.assets.some(asset => asset.id === locateId)) { setLayoutMessage("引用的资产未在当前目录登记。"); setLocateId(null); return; }
    setView("all"); setFocus("all"); setWorkspace("all"); setQuery(""); setHighlightId(locateId); setLocateId(null);
  }, [locateId, catalog]);
  useEffect(() => {
    if (!highlightId) return;
    const frame = requestAnimationFrame(() => {
      const card = document.getElementById(`hub-asset-${highlightId}`);
      card?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
      card?.querySelector<HTMLButtonElement>(".hub-card-open")?.focus({ preventScroll: true });
    });
    const timer = window.setTimeout(() => setHighlightId(null), 5000);
    return () => { cancelAnimationFrame(frame); window.clearTimeout(timer); };
  }, [highlightId, view, focus, workspace, query]);
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);
  async function copyReference(asset: Asset, service = false) {
    const root = catalog?.hubRoot || assets.find(item => item.id === "workspace-hub")?.ownerPath || "";
    if (!root) { setReferencePreview("索引库位置不可用，请刷新后重试。"); return; }
    const reference = service ? formatServiceReference(asset, root) : formatReference(asset, root);
    try {
      await navigator.clipboard.writeText(reference); setCopiedId(service ? `${asset.id}:service` : asset.id); setReferencePreview("");
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopiedId(null), 1800);
    } catch { setReferencePreview(reference); }
  }

  const serviceDetails = selected && selectedServices.length > 0 ? <section>
    <h3>MCP 服务 <span>本机进程</span></h3>
    <ServiceControls services={selectedServices} assetTitle={selected.title} copied={copiedId === `${selected.id}:service`} pending={servicePending} errors={serviceErrors} stale={Boolean(servicesError)} detailed onAction={(id, action) => void operateService(id, action)} onCopy={() => void copyReference(selected, true)}/>
    {servicesError && <div className="hub-service-detail-retry"><p className="hub-service-error" role="status">{servicesError}</p><button className="hub-secondary-button" onClick={() => void refreshServices()}>重试状态</button></div>}
    {referencePreview && <div className="hub-reference-fallback"><p>无法访问剪贴板，请选中文本复制。</p><textarea readOnly value={referencePreview} aria-label="服务接入引用文本"/><button onClick={() => setReferencePreview("")}>关闭</button></div>}
  </section> : null;

  return <div className="hub-shell">
    {mobileMenu && <button className="hub-nav-backdrop" aria-label="关闭导航" onClick={() => setMobileMenu(false)}/>}
    <aside className={`hub-sidebar ${mobileMenu ? "is-open" : ""}`} inert={!!selected}>
      <button className="hub-brand" onClick={() => locate("workspace-hub")} aria-label="定位 Workspace Hub 项目" title="定位工作台自己的项目卡片"><div className="hub-brand-icon"><Layers3 size={23}/></div><div><strong>Workspace Hub</strong><span>MODUVELA · 工作空间</span></div></button>
      <div className="hub-nav-label">工作空间</div>
      <nav aria-label="资产分类" title="当前工作空间、搜索和关注范围内的数量 / 全局数量">
        <button className={`hub-nav-item ${view === "all" ? "is-active" : ""}`} onClick={() => navigate("all")}><Compass size={18}/><span>总览</span><small>{totalCount}/{assets.length}</small></button>
        {categories.map(category => <button key={category.id} className={`hub-nav-item ${view === category.id ? "is-active" : ""}`} onClick={() => navigate(category.id)}><category.icon size={18}/><span>{category.label}</span><small>{counts[category.id] || 0}/{globalCounts[category.id] || 0}</small></button>)}
        <button className={`hub-nav-item ${view === "services" ? "is-active" : ""}`} onClick={() => navigate("services")} title="已登记服务的工具与技能，当前范围内的数量 / 全局数量"><Server size={18}/><span>MCP 服务</span><small>{servicesReady ? `${serviceCount}/${globalServiceCount}` : "—"}</small></button>
      </nav>
      <div className="hub-sidebar-divider"/>
      <div className="hub-nav-label">关注视图</div>
      <nav aria-label="关注筛选" title="当前分类、工作空间和搜索内的数量 / 全局数量">
        <button className={`hub-nav-item ${focus === "intention" ? "is-focus" : ""}`} onClick={() => { selectFocus(focus === "intention" ? "all" : "intention"); setMobileMenu(false); }}><Sparkles size={17}/><span>意向与探索</span><small>{focusCounts.intention}/{globalFocusCounts.intention}</small></button>
        <button className={`hub-nav-item ${focus === "blocked" ? "is-focus" : ""}`} onClick={() => { selectFocus(focus === "blocked" ? "all" : "blocked"); setMobileMenu(false); }}><CircleHelp size={17}/><span>阻塞事项</span><small>{focusCounts.blocked}/{globalFocusCounts.blocked}</small></button>
        <button className={`hub-nav-item ${focus === "unconfirmed" ? "is-focus" : ""}`} onClick={() => { selectFocus(focus === "unconfirmed" ? "all" : "unconfirmed"); setMobileMenu(false); }}><ShieldCheck size={17}/><span>待确认</span><small>{focusCounts.unconfirmed}/{globalFocusCounts.unconfirmed}</small></button>
        <button className={`hub-nav-item ${focus === "archived" ? "is-focus" : ""}`} onClick={() => { selectFocus(focus === "archived" ? "all" : "archived"); setMobileMenu(false); }}><Archive size={17}/><span>归档</span><small>{focusCounts.archived}/{globalFocusCounts.archived}</small></button>
      </nav>

    </aside>

    <main className="hub-main" inert={!!selected}>
      <header className="hub-topbar">
        <div className="hub-heading"><button className="hub-icon-button hub-mobile-toggle" onClick={() => setMobileMenu(true)} aria-label="打开导航"><Menu size={20}/></button><h1 title={view === "services" ? "已登记的本地服务入口" : activeCategory?.description}>{view === "services" ? "MCP 服务" : activeCategory?.label || "工作空间总览"}</h1></div>
        <div className="hub-topbar-right"><span className="hub-index-time" title="索引刷新时间；项目确认日期见详情">{catalog ? `更新 ${new Date(catalog.generatedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}` : "正在读取"}</span><span className="hub-private"><span className="hub-status-dot"/>仅本机</span><button className="hub-refresh" disabled={loading} onClick={() => void refresh(true)} aria-label="刷新索引"><RefreshCw size={14} className={loading ? "hub-spin" : ""}/><span>刷新</span></button></div>
      </header>
      <div className="hub-content">

        {error && <div className="hub-alert" role="alert"><CircleHelp size={18}/><div><strong>{error}</strong><p>{catalog ? "当前仍显示上次成功读取的索引，请稍后刷新。" : "请确认本地服务已启动，再刷新索引。"}</p></div><button onClick={() => void refresh(true)}>重试</button></div>}
        {servicesError && <div className="hub-alert hub-service-alert" role="alert"><CircleHelp size={16}/><div><strong>{servicesError}</strong><p>{servicesReady ? "保留上次服务登记；刷新状态后可再次操作。" : "项目索引仍可使用。"}</p></div><button onClick={() => void refreshServices()}>重试状态</button></div>}

        <section className="hub-stats" aria-label="全局索引统计" title="整个工作空间的总量，不受下方筛选影响"><div><Compass size={14}/><span>总条目</span><strong>{assets.length}</strong></div><div><FolderGit2 size={14}/><span>总仓库</span><strong>{catalog?.repositories.length || 0}</strong></div><div><ListChecks size={14}/><span>总待办</span><strong>{pending}</strong></div><div><ShieldCheck size={14}/><span>总待确认</span><strong>{assets.filter(unconfirmed).length}</strong></div></section>

        <div className="hub-toolbar"><div className="hub-search"><Search size={17}/><input value={query} onChange={event => { clearLocateLink(); setQuery(event.target.value); }} placeholder="搜索名称、目标或标签…" aria-label="搜索资产"/>{query && <button onClick={() => { clearLocateLink(); setQuery(""); }} aria-label="清空搜索"><X size={14}/></button>}</div><div className="hub-toolbar-select"><Settings2 size={15}/><select aria-label="筛选工作空间" value={workspace} onChange={event => { clearLocateLink(); setWorkspace(event.target.value); }}><option value="all">全部工作空间</option>{workspaces.map(name => <option key={name} value={name}>{name}</option>)}</select></div><div className="hub-toolbar-select"><ArrowDownUp size={15}/><select aria-label="排序" value={sort} onChange={event => setSort(event.target.value)}><option value="manual">我的排序</option><option value="title">按名称</option><option value="date">最近确认</option></select></div></div>
        {referencePreview && !selected && <section className="hub-reference-fallback" aria-label="手动复制资产引用"><p>无法访问剪贴板，请选中文本复制。</p><textarea readOnly value={referencePreview} aria-label="资产引用文本"/><button onClick={() => setReferencePreview("")}>关闭</button></section>}
        <div className="hub-list-heading"><div className="hub-filter-chips">{[{ id: "all", title: "全部" }, { id: "intention", title: "意向" }, { id: "blocked", title: "阻塞" }, { id: "unconfirmed", title: "待确认" }, { id: "archived", title: "归档" }].map(item => <button key={item.id} className={focus === item.id ? "is-selected" : ""} onClick={() => selectFocus(item.id as Focus)}>{item.title}</button>)}</div><span className="hub-result-status"><span role="status" aria-live="polite">{layoutMessage}</span>{filtered.length} 个条目</span></div>

        {loading && !catalog ? <div className="hub-empty"><LoaderCircle className="hub-spin" size={26}/><h2>正在读取本地工作空间</h2><p>从资产登记和项目状态文档生成索引。</p></div> : filtered.length === 0 ? <div className="hub-empty"><Compass size={34}/><h2>{assets.length ? "没有符合条件的条目" : "工作空间尚未登记资产"}</h2><p>{assets.length ? "尝试调整分类、工作空间或搜索内容。" : "首次梳理后，这里将展示产品、工具和流程入口。"}</p>{assets.length > 0 && <button className="hub-secondary-button" onClick={() => { setView("all"); setFocus("all"); setWorkspace("all"); setQuery(""); }}>重置筛选</button>}</div> : <section className="hub-card-grid" aria-label="资产列表">{filtered.map(asset => {
          const category = categories.find(item => item.id === asset.kind);
          const Icon = category?.icon || FileText;
          const assetServices = services.filter(service => service.assetIds.includes(asset.id));
          return <article id={`hub-asset-${asset.id}`} data-asset-id={asset.id} className={`hub-asset-card kind-${asset.kind} ${assetServices.length ? "has-service" : ""} ${highlightId === asset.id ? "is-highlighted" : ""} ${dropId === asset.id ? "is-drop-target" : ""} ${draggingId === asset.id ? "is-dragging" : ""}`} key={asset.id} onClick={() => setSelectedId(asset.id)}
            onDragOver={event => { if (draggingId && sort === "manual") { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropId(asset.id); } }}
            onDrop={event => { event.preventDefault(); if (draggingId) reorder(draggingId, asset.id); setDraggingId(null); setDropId(null); }}>
            <div className="hub-card-top">
              <button className="hub-drag-handle" aria-label={`拖动排序 ${asset.title}`} title="我的排序：拖动调整；方向键移动，Home 移到最前" disabled={sort !== "manual" || !layoutReady || layoutSaving} draggable={sort === "manual" && layoutReady && !layoutSaving}
                onClick={event => event.stopPropagation()} onDragStart={event => { event.stopPropagation(); event.dataTransfer.setData("application/x-workspace-hub-asset", asset.id); event.dataTransfer.effectAllowed = "move"; setDraggingId(asset.id); }}
                onDragEnd={() => { setDraggingId(null); setDropId(null); }}
                onKeyDown={event => {
                  if (event.key === "Home") { event.preventDefault(); void saveOrder(moveToFront(order, asset.id)); }
                  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) { event.preventDefault(); const index = filtered.findIndex(item => item.id === asset.id); const target = filtered[index + (["ArrowUp", "ArrowLeft"].includes(event.key) ? -1 : 1)]; if (target) reorder(asset.id, target.id); }
                }}><GripVertical size={12}/></button>
              <span className="hub-asset-icon"><Icon size={16}/></span>
              <div className="hub-card-title"><h2 title={asset.title}><button className="hub-card-open" onClick={event => { event.stopPropagation(); setSelectedId(asset.id); }}>{asset.title}</button></h2><span title={`${asset.workspace} · ${category?.label}`}>{asset.workspace || "工作空间待确认"} · {category?.label || asset.kind}</span></div>
              <div className="hub-card-actions"><button className="hub-icon-button" aria-label={`移到最前 ${asset.title}`} title="移到最前" disabled={sort !== "manual" || !layoutReady || layoutSaving} onClick={event => { event.stopPropagation(); void saveOrder(moveToFront(order, asset.id)); }}><ArrowUpToLine size={14}/></button><button className="hub-icon-button" aria-label={`复制引用 ${asset.title}`} title={copiedId === asset.id ? "引用已复制" : "复制给新的 session"} onClick={event => { event.stopPropagation(); void copyReference(asset); }}>{copiedId === asset.id ? <Check size={14}/> : <Clipboard size={14}/>}</button><button className="hub-icon-button" aria-label={`查看详情 ${asset.title}`} title="查看详情" onClick={event => { event.stopPropagation(); setSelectedId(asset.id); }}><ArrowUpRight size={14}/></button></div>
            </div>
            <p className="hub-card-goal">{asset.goal || asset.summary || "目标待确认"}</p>
            <div className="hub-card-badges"><span className={`hub-badge ${intention(asset) ? "is-intention" : blocked(asset) ? "is-blocked" : ""}`}>{label(asset.stage)}</span>{asset.readiness && asset.readiness !== "unknown" && <span className="hub-badge is-muted">{label(asset.readiness)}</span>}{asset.activity && asset.activity !== "unknown" && <span className={`hub-badge ${archived(asset) ? "is-archived" : blocked(asset) ? "is-blocked" : "is-muted"}`}>{label(asset.activity)}</span>}</div>
            <ServiceControls services={assetServices} assetTitle={asset.title} copied={copiedId === `${asset.id}:service`} pending={servicePending} errors={serviceErrors} stale={Boolean(servicesError)} onAction={(id, action) => void operateService(id, action)} onCopy={() => void copyReference(asset, true)}/>
            <div className="hub-card-footer"><span className="hub-card-start" title={asset.startedAt ? "项目/资产真实起始日期" : "尚无可靠起始日期依据"}>{asset.startedAt ? <>起始 <time>{date(asset.startedAt)}</time></> : "起始待补"}</span><span className="hub-card-tags" title={(asset.tags || []).join(" · ")}>{(asset.tags || []).slice(0, 2).map(tag => <span key={tag}>{tag}</span>)}</span><span className="hub-card-evidence">{asset.manualSteps?.pending ? <><span className="hub-pending-dot"/>{asset.manualSteps.pending} 项待办</> : unconfirmed(asset) ? <><CircleHelp size={12}/>待确认</> : <><Check size={12}/><time>{date(asset.confirmedAt)}</time></>}</span></div>
          </article>;
        })}</section>}

        {(catalog?.discoveries?.length || 0) > 0 && <section className="hub-notice"><button className="hub-notice-toggle" onClick={() => setShowDiscoveries(!showDiscoveries)}><FolderGit2 size={17}/><span>发现 {catalog!.discoveries!.length} 个未登记目录</span><small>目录存在不代表独立项目或开发完成</small><ChevronRight size={16} className={showDiscoveries ? "is-expanded" : ""}/></button>{showDiscoveries && <div className="hub-notice-body">{catalog!.discoveries!.map(item => <PathRow key={item.path} title={`${item.workspace} · ${item.title}`} path={item.path}/>)}</div>}</section>}
        {(catalog?.warnings?.length || 0) > 0 && <section className="hub-notice"><button className="hub-notice-toggle" onClick={() => setShowWarnings(!showWarnings)}><CircleHelp size={17}/><span>{catalog!.warnings.length} 条索引提示</span><ChevronRight size={16} className={showWarnings ? "is-expanded" : ""}/></button>{showWarnings && <ul className="hub-warning-list">{catalog!.warnings.map((warning, index) => <li key={index}>{warningLabel(warning)}</li>)}</ul>}</section>}
        <footer className="hub-footer"><span>来源：资产登记与项目文档</span><span title={catalog?.rulesFingerprint}>规范指纹 {catalog?.rulesFingerprint ? catalog.rulesFingerprint.slice(0, 10) : "待读取"}</span></footer>
      </div>
    </main>

    {selected && <div className="hub-detail-layer"><button className="hub-detail-backdrop" tabIndex={-1} aria-label="关闭详情" onClick={() => setSelectedId(null)}/><aside ref={dialogRef} className="hub-detail" role="dialog" aria-modal="true" aria-labelledby="hub-detail-title"><header><span>{categories.find(category => category.id === selected.kind)?.label} / {selected.workspace}</span><button className="hub-icon-button" onClick={() => setSelectedId(null)} aria-label="关闭详情"><X size={20}/></button></header><div className="hub-detail-content"><div className={`hub-detail-icon kind-${selected.kind}`}><Layers3 size={25}/></div><h2 id="hub-detail-title">{selected.title}</h2><p className="hub-detail-summary">{selected.summary || "摘要待确认"}</p><div className="hub-detail-properties"><div><span>起始日期</span><strong>{selected.startedAt ? date(selected.startedAt) : "待补"}</strong></div><div><span>阶段</span><strong>{label(selected.stage)}</strong></div><div><span>推进状态</span><strong>{label(selected.activity)}</strong></div><div><span>可用性</span><strong>{label(selected.readiness)}</strong></div><div><span>优先级</span><strong>{label(selected.priority)}</strong></div><div><span>最近确认</span><strong>{date(selected.confirmedAt)}</strong></div><div><span>文档状态</span><strong>{({ confirmed: "状态文档有效", missing: "文件待补充", unregistered: "尚未映射", invalid: "格式待修正" })[selected.documentState]}</strong></div></div>{serviceDetails}<section><h3>{selected.kind === "product" ? "当前目标" : "用途与范围"}</h3><p>{selected.goal || (selected.kind === "product" ? "目标尚未确认，请以所属项目文档为准。" : selected.summary)}</p></section><section><h3>人工步骤 <span>{selected.manualSteps?.pending || 0} 项待办</span></h3>{selected.manualSteps?.available ? selected.manualSteps.items.length ? <ul className="hub-manual-list">{selected.manualSteps.items.map((item, index) => <li key={index}><span className="hub-checkbox"/>{item}</li>)}</ul> : <p className="hub-muted">当前记录没有未完成的人工步骤。</p> : <p className="hub-muted">未读取到人工步骤记录，不能据此判断无需人工操作。</p>}<PathRow title="人工步骤文档" path={selected.manualStepsFile}/></section><section><h3>关联仓库 <span>{(selected.repositoryIds || []).length}</span></h3>{(selected.repositoryIds || []).length ? selected.repositoryIds.map(id => { const repo = catalog?.repositories.find(item => item.id === id); return repo ? <div className="hub-repository" key={id}><strong><FolderGit2 size={16}/>{repo.title}</strong><PathRow title="仓库主目录" path={repo.path}/>{repo.checkouts?.map(checkout => <PathRow key={checkout.path} title={`工作目录 · ${checkout.role}`} path={checkout.path}/>)}{repo.remoteHint && <small className="hub-remote-hint">{repo.remoteHint}</small>}</div> : <p className="hub-muted" key={id}>{id} · 仓库登记待确认</p>; }) : <p className="hub-muted">尚未登记关联仓库；无 Git 目录也可以作为独立资产。</p>}</section><section><h3>引用能力 <span>{(selected.uses || []).length}</span></h3>{(selected.uses || []).length ? <div className="hub-related">{selected.uses.map(id => { const asset = assets.find(item => item.id === id); return <button key={id} disabled={!asset} onClick={() => setSelectedId(id)}><Layers3 size={15}/><span>{asset?.title || id}</span>{asset ? <ArrowUpRight size={15}/> : <small>待登记</small>}</button>; })}</div> : <p className="hub-muted">暂无已登记的工具、框架或流程关联。</p>}</section>{consumers.length > 0 && <section><h3>使用此能力的产品 <span>{consumers.length}</span></h3><div className="hub-related">{consumers.map(asset => <button key={asset.id} onClick={() => setSelectedId(asset.id)}><Box size={15}/><span>{asset.title}</span><ArrowUpRight size={15}/></button>)}</div></section>}<CollectionMembers key={selected.id} assetId={selected.id} title={selected.title} hubRoot={catalog?.hubRoot || assets.find(asset => asset.id === "workspace-hub")?.ownerPath || ""}/><section><h3>文件入口</h3><PathRow title="所属目录" path={selected.ownerPath}/><PathRow title="使用入口" path={selected.entrypoint}/><PathRow title="状态文档" path={selected.statusFile}/>{!selected.ownerPath && !selected.entrypoint && !selected.statusFile && <p className="hub-muted">文件入口待登记。</p>}</section><section><h3>来源与依据</h3>{(selected.sources || []).length ? selected.sources.map((source, index) => <div className="hub-source" key={index}><p>{source.note || "来源说明待确认"}</p>{source.path && /^https?:\/\//.test(source.path) ? <a href={source.path} target="_blank" rel="noreferrer">查看来源 <ExternalLink size={13}/></a> : <PathRow title="来源文件" path={source.path}/>}<small>核对时间：{date(source.checkedAt)}</small></div>) : <p className="hub-muted">暂无来源记录，相关结论待确认。</p>}</section>{(selected.warnings?.length || 0) > 0 && <section><h3>条目提示</h3><ul className="hub-warning-list">{selected.warnings!.map((warning, index) => <li key={index}>{warningLabel(warning)}</li>)}</ul></section>}<p className="hub-detail-note">目标、约束与验收结论以所属项目文档为准。服务按钮管理已登记的本机进程；接入与工具调用按使用说明执行。</p></div></aside></div>}
  </div>;
}
