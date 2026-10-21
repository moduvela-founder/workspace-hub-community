"use client";

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Clipboard, Search } from 'lucide-react';
import { formatMemberReference } from '@/lib/hub/reference.mjs';

type Member = { id: string; title: string; description: string; group: string; kind: string; path: string; sha256: string; matches?: { line: number; excerpt: string }[]; matchedLines?: number; truncated?: boolean };
type Result = { total: number; matched: number; members: Member[]; warnings: string[]; readOnly: true };

export default function CollectionMembers({ assetId, title, hubRoot }: { assetId: string; title: string; hubRoot: string }) {
  const [registered, setRegistered] = useState(false);
  const [infoError, setInfoError] = useState('');
  const [infoRevision, setInfoRevision] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'metadata' | 'content'>('metadata');
  const [result, setResult] = useState<Result | null>(null);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const [preview, setPreview] = useState('');
  const request = useRef<AbortController | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setInfoError('');
    fetch(`/api/hub/members?id=${encodeURIComponent(assetId)}&mode=info`, { signal: controller.signal, cache: 'no-store' })
      .then(response => { if (!response.ok) throw new Error('资料包登记暂不可读，请重试或检查本机配置。'); return response.json(); })
      .then(data => setRegistered(Boolean(data?.collection)))
      .catch(() => { if (!controller.signal.aborted) setInfoError('资料包登记暂不可读，请重试或检查本机配置。'); });
    return () => { controller.abort(); request.current?.abort(); if (copyTimer.current) clearTimeout(copyTimer.current); };
  }, [assetId, infoRevision]);
  async function load(search = query, scope = mode) {
    if (scope === 'content' && !search.trim()) { setError('正文检索需要关键词。'); return; }
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(''); setPage(0);
    const params = new URLSearchParams({ id: assetId, mode: scope });
    if (search.trim()) params.set('query', search.trim());
    try {
      const response = await fetch(`/api/hub/members?${params}`, { signal: controller.signal, cache: 'no-store' });
      if (!response.ok) throw new Error('成员目录暂不可读，请检查资料包登记。');
      const data = await response.json() as Result;
      if (!Array.isArray(data.members) || !Array.isArray(data.warnings)) throw new Error('成员目录格式异常。');
      setResult(data);
    } catch (cause) { if (!controller.signal.aborted) { setResult(null); setError(cause instanceof Error ? cause.message : '读取失败。'); } }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  async function copy(member: Member) {
    const reference = formatMemberReference({ id: assetId, title }, member, hubRoot);
    try {
      await navigator.clipboard.writeText(reference); setCopied(member.id); setPreview('');
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(''), 1800);
    } catch { setPreview(reference); }
  }
  if (!registered && !infoError) return null;
  const pages = Math.max(1, Math.ceil((result?.members.length || 0) / 25));
  const members = result?.members.slice(page * 25, (page + 1) * 25) || [];
  return <section className="hub-collection">
    <h3>资料包成员 <span>{result ? result.matched === result.total ? `${result.total} 项` : `${result.matched} / ${result.total} 项` : '按需读取'}</span></h3>
    {infoError ? <><p className="hub-member-warning" role="status">{infoError}</p><button className="hub-secondary-button" onClick={() => setInfoRevision(value => value + 1)}>重试资料包登记</button></> : !expanded ? <button className="hub-secondary-button" onClick={() => { setExpanded(true); void load('', 'metadata'); }}>展开成员目录</button> : <>
      <form className="hub-member-search" onSubmit={event => { event.preventDefault(); void load(); }}>
        <input aria-label="搜索资料包成员" placeholder="名称或关键词，例如 firmware" maxLength={200} value={query} onChange={event => setQuery(event.target.value)}/>
        <select aria-label="成员搜索范围" value={mode} onChange={event => setMode(event.target.value as 'metadata' | 'content')}><option value="metadata">名称与说明</option><option value="content">正文内容</option></select>
        <button type="submit" className="hub-icon-button" disabled={busy} aria-label="执行成员搜索"><Search size={16}/></button>
      </form>
      <p className="hub-muted">只读取此包已登记的文件；复制成员引用给新的 session。</p>
      <div role="status" className="hub-member-status">{busy ? '正在读取…' : error}</div>
      {result?.warnings.map((warning, index) => <p className="hub-member-warning" key={index}>{warning}</p>)}
      {preview && <textarea className="hub-member-reference" aria-label="成员引用" readOnly value={preview}/>}
      {members.map(member => <article key={member.id} className="hub-member-row">
        <div className="hub-member-heading"><strong>{member.title}</strong><button className="hub-icon-button" aria-label={`复制成员引用 ${member.title}`} onClick={() => void copy(member)}>{copied === member.id ? <Check size={15}/> : <Clipboard size={15}/>}</button></div>
        <small>{member.group} · {member.kind === 'role' ? '角色模板' : member.kind === 'skill' ? '技能源码' : '参考资料'}</small>
        <p>{member.description}</p>
        {member.matches?.map((match, index) => <blockquote key={index}><small>第 {match.line} 行</small>{match.excerpt}</blockquote>)}
        {member.truncated && <small>已显示前 {member.matches?.length || 0} 处，共 {member.matchedLines} 行匹配；完整内容见原文件。</small>}
        <details><summary>文件入口</summary><code>{member.path}</code><small>SHA256 {member.sha256}</small></details>
      </article>)}
      {!busy && result?.members.length === 0 && <p className="hub-muted">没有匹配成员。可尝试来源文件使用的英文关键词。</p>}
      {result && pages > 1 && <div className="hub-member-pages"><button aria-label="上一页成员" className="hub-icon-button" disabled={page === 0} onClick={() => setPage(value => value - 1)}><ChevronLeft size={16}/></button><span>{page + 1} / {pages}</span><button aria-label="下一页成员" className="hub-icon-button" disabled={page + 1 >= pages} onClick={() => setPage(value => value + 1)}><ChevronRight size={16}/></button></div>}
    </>}
  </section>;
}
