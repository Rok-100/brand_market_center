import {useEffect, useRef, useState} from 'react';
import {ArrowClockwiseRegular} from '@fluentui/react-icons';
import {api, ApiError} from './api';
import type {HubSession, WorkspaceHomeSummary} from './types';
import {sourceTime} from './sourceTime';
import {businessDateLabel, combinedBusinessDateLabel} from './businessDate';

let lastSnapshot: {scope: string; value: WorkspaceHomeSummary} | null = null;
const money = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? '待核验' : `¥${(value / 10000).toFixed(2)}万`;
const channels = [{key:'douyin',label:'抖店'}, {key:'wechat',label:'视频号'}];

export function WorkspacePublicSummary({session}: {session: HubSession}) {
  const scope = JSON.stringify([session.user.number, session.workspace.role, session.workspace.dashboard_scope, session.workspace.can_view_public_summary, session.access.allowed_modules, session.access.policy_state]);
  const [snapshot,setSnapshot] = useState<{scope:string;value:WorkspaceHomeSummary}|null>(() => lastSnapshot?.scope === scope ? lastSnapshot : null);
  const [error,setError] = useState(''), [reading,setReading] = useState(false);
  const reload = useRef<(force?:boolean)=>void>(()=>{});
  const summary = snapshot?.scope === scope ? snapshot.value : null;
  useEffect(() => {
    if (!session.workspace.can_view_public_summary) { lastSnapshot = null; setSnapshot(null); return; }
    let alive = true, busy = false, timer = 0, refreshingReads = 0;
    let controller: AbortController | null = null;
    const load = async (force = false) => {
      if (!alive || busy || document.hidden) return;
      window.clearTimeout(timer); busy = true; setReading(true);
      controller = new AbortController();
      let delay = 300_000;
      try {
        const value = await api.workspaceSummary(force, AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]));
        if (!alive) return;
        lastSnapshot = {scope,value}; setSnapshot(lastSnapshot); setError('');
        refreshingReads = value.refreshing ? refreshingReads + 1 : 0;
        if (value.refreshing) delay = refreshingReads < 8 ? 5_000 : 30_000;
        else if (value.lastError) delay = Math.min(300_000, Math.max(30_000, Date.parse(value.nextRetryAt || '') - Date.now() || 30_000));
      } catch (cause) {
        if (!alive || controller.signal.aborted) return;
        if (cause instanceof ApiError && [401,403].includes(cause.status)) {
          lastSnapshot = null; setSnapshot(null); setError('登录或数据权限已变化，请刷新中枢重新校验。');
        } else {
          setError(cause instanceof Error && cause.name === 'TimeoutError' ? '经营数据读取超时，可重试。' : '经营数据暂时未连接，可重试。');
        }
        delay = 30_000;
      } finally {
        busy = false;
        if (alive) { setReading(false); timer = window.setTimeout(() => void load(), delay); }
      }
    };
    reload.current = force => void load(force);
    const onVisibility = () => { if (!document.hidden) void load(); else window.clearTimeout(timer); };
    document.addEventListener('visibilitychange',onVisibility);
    void load();
    return () => { alive = false; window.clearTimeout(timer); controller?.abort(); reload.current = ()=>{}; document.removeEventListener('visibilitychange',onVisibility); };
  }, [scope, session.workspace.can_view_public_summary]);
  if (!session.workspace.can_view_public_summary) return null;
  const issue = error || summary?.lastError?.message;
  const state = issue ? '更新未完成' : summary?.refreshing ? '后台更新中' : summary?.status === 'ready' ? '已连接' : summary?.status === 'stale' ? '最近成功快照' : summary ? '部分来源待核验' : '正在读取';
  return <section className="workspace-summary-card" aria-labelledby="workspace-summary-title" aria-busy={reading}>
    <header className="summary-heading">
      <div><h2 id="workspace-summary-title">部门经营摘要</h2><span className={`summary-state${issue ? ' is-warning' : ''}`} role="status">{state}</span></div>
      <button type="button" className="summary-refresh" disabled={reading} onClick={()=>reload.current(true)}><ArrowClockwiseRegular/>{reading ? '正在读取' : '刷新数据'}</button>
    </header>
    {issue && <p className="workspace-summary-note is-error" role="alert">{issue}{summary ? ' · 下方保留最近成功数值，请留意业务日期。' : ''}</p>}
    <div className="workspace-summary-metrics">
      <article className="summary-total"><small>抖店＋视频号 · 有效 GSV</small><strong>{summary ? money(summary.totalGsvYuan) : '读取中'}</strong><span>{combinedBusinessDateLabel(summary?.channels)}{summary && summary.totalGsvYuan == null ? ' · 待同日数据齐全后汇总' : ''}</span></article>
      {channels.map(fallback => {
        const channel = summary?.channels.find(item=>item.key===fallback.key);
        return <article key={fallback.key}><small>{channel?.label || fallback.label} · 有效 GSV</small><strong>{channel ? money(channel.todayTotalYuan) : reading ? '读取中' : '待核验'}</strong><span>{businessDateLabel(channel?.todayDate)}{channel?.stale ? ' · 旧快照' : ''}</span><small className="summary-source">{channel?.unavailableReason || (channel?.sourceUpdatedAt ? `来源更新 ${sourceTime(channel.sourceUpdatedAt)}` : '等待来源返回')}</small></article>;
      })}
    </div>
    <footer className="summary-footer"><span>最近成功快照 {summary?.generatedAt ? sourceTime(summary.generatedAt) : '待返回'}</span><details><summary>数据口径与更新状态</summary><p>{summary?.note || '读取已授权根数据；缺失值保持待核验，未取得完整结果前不按零展示。'}</p>{summary?.lastAttemptAt && <p>最近请求：{sourceTime(summary.lastAttemptAt)}{summary.nextRetryAt ? `；下次重试：${sourceTime(summary.nextRetryAt)}` : ''}</p>}</details></footer>
  </section>;
}
