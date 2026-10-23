import { Button, Spinner } from "@fluentui/react-components";
import { ArrowClockwiseRegular, WarningRegular } from "@fluentui/react-icons";
import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { HubSession, LibTvCreditTrend, PermissionPreview } from "./types";
import "./organization-libtv-credits.css";

const number = (n: number) => n.toLocaleString("zh-CN", { maximumFractionDigits: 4 });
function today() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
function shift(date: string, days: number) { return new Date(Date.parse(date) + days * 86400000).toISOString().slice(0, 10); }
function timestamp(value: string) { return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "short", timeStyle: "short", hour12: false }).format(new Date(value)); }

function BarChart({ series, metric }: { series: LibTvCreditTrend["series"]; metric: "points" | "amount" }) {
  const isAmount = metric === "amount";
  const values = series.map(row => isAmount ? (row.estimatedAmount === null ? null : Number(row.estimatedAmount)) : row.consumed);
  const labels = series.map(row => isAmount ? (row.estimatedAmount === null ? "待核验" : `¥${row.estimatedAmount}`) : number(row.consumed));
  const columnWidth = Math.max(76, ...labels.map(label => label.length * 7 + 24));
  const width = Math.max(900, 96 + series.length * columnWidth), height = 270;
  const left = 78, right = 18, top = 30, bottom = 48;
  const innerHeight = height - top - bottom, innerWidth = width - left - right;
  const max = Math.max(1, ...values.map(v => Math.abs(v ?? 0)));
  const negative = values.some(v => (v ?? 0) < 0);
  const scale = innerHeight / (negative ? max * 2 : max);
  const baseline = top + (negative ? innerHeight / 2 : innerHeight);
  const step = innerWidth / Math.max(series.length, 1), barWidth = Math.min(48, step * .62);
  const labelEvery = 1;
  return <div className="libtv-bar-scroll" role="img" aria-label={isAmount ? "每日积分消耗估算金额柱状图" : "每日积分消耗柱状图"}>
    <svg className="libtv-bar-svg" viewBox={`0 0 ${width} ${height}`} style={{ minWidth: width }}>
      {[0, .5, 1].map(ratio => {
        const value = negative ? max * (1 - ratio * 2) : max * (1 - ratio);
        const y = top + innerHeight * ratio;
        return <g key={ratio}><line x1={left} x2={width - right} y1={y} y2={y} stroke="#dfebe6" /><text x={left - 12} y={y + 4} textAnchor="end">{number(value)}</text></g>;
      })}
      <line x1={left} x2={width - right} y1={baseline} y2={baseline} stroke="#b8cdc7" />
      {series.map((row, i) => {
        const value = values[i];
        const barHeight = Math.abs(value ?? 0) * scale;
        const x = left + step * (i + .5);
        return <g key={row.date}>
          <rect className="libtv-consumption-bar" tabIndex={0} role="graphics-symbol" aria-label={`${row.date}，${number(row.consumed)} 点，积分消耗估算金额 ${row.estimatedAmount ?? "待核验"} 元，${row.transactionCount} 笔`} x={x - barWidth / 2} y={(value ?? 0) < 0 ? baseline : baseline - barHeight} width={barWidth} height={barHeight} opacity={value === null ? 0 : 1} rx={3} fill={(value ?? 0) < 0 ? "#d08b40" : "#109b80"}>
            <title>{row.date}：{number(row.consumed)} 点 · 积分消耗估算金额 {row.estimatedAmount === null ? "待核验" : `¥${row.estimatedAmount}`} · {row.transactionCount} 笔记录</title>
          </rect>
          {<text className="libtv-bar-value" textAnchor="middle" x={x} y={(value ?? 0) < 0 ? baseline + barHeight + 15 : baseline - barHeight - 8}>{labels[i]}</text>}
          {(i % labelEvery === 0 || i === series.length - 1) && <text textAnchor="middle" x={x} y={height - 15}>{row.date.slice(5).replace("-", "/")}</text>}
        </g>;
      })}
    </svg>
  </div>;
}

export function LibTvCreditTrendPanel({ preview }: { session: HubSession; preview?: PermissionPreview | null }) {
  const [startDate, setStartDate] = useState(() => shift(today(), -6));
  const [endDate, setEndDate] = useState(today);
  const [teamMember, setTeamMember] = useState("");
  const [modelName, setModelName] = useState("");
  const [data, setData] = useState<LibTvCreditTrend | null>(null);
  const [options, setOptions] = useState<{ teamMembers: string[]; modelNames: string[] }>({ teamMembers: [], modelNames: [] });
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [metric, setMetric] = useState<"points" | "amount">("points");
  const [refresh, setRefresh] = useState(0);
  const requestId = useRef(0);
  const invalid = !startDate || !endDate || startDate > endDate || (Date.parse(endDate) - Date.parse(startDate)) / 86400000 >= 366;

  useEffect(() => {
    const id = ++requestId.current;
    let active = true;
    if (invalid) { setData(null); setLoading(false); setError("请选择有效日期范围，开始日期不能晚于结束日期，范围最多 366 天。"); return; }
    async function load(force: boolean) {
      setLoading(true); setError(""); setData(null);
      try {
        const result = await api.libtvCredits({ startDate, endDate, team_member: teamMember, model_name: modelName }, preview, force);
        if (active && requestId.current === id) { setData(result); setOptions(result.options); }
      } catch (cause) {
        if (active && requestId.current === id) setError(cause instanceof Error ? cause.message : "积分消耗读取失败，请重试");
      } finally { if (active && requestId.current === id) setLoading(false); }
    }
    void load(refresh > 0);
    const timer = window.setInterval(() => void load(false), 300000);
    return () => { active = false; window.clearInterval(timer); };
  }, [startDate, endDate, teamMember, modelName, preview?.updatedAt, refresh, invalid]);

  function period(days: number) { const end = today(); setEndDate(end); setStartDate(shift(end, 1 - days)); }
  return <section className="libtv-credit-panel" aria-label="LibTV 积分消耗趋势" aria-busy={loading}>
    <header className="libtv-credit-header">
      <div><span>AI PRODUCTION COST</span><h2>LibTV 积分消耗趋势</h2><p>按日期、团队成员或模型查看每日积分消耗。</p></div>
      <Button appearance="secondary" icon={loading ? <Spinner size="tiny" /> : <ArrowClockwiseRegular />} disabled={loading || invalid} onClick={() => setRefresh(n => n + 1)}>刷新</Button>
    </header>
    <div className="libtv-points-filters">
      <label><span>开始日期</span><input aria-label="LibTV 开始日期" type="date" value={startDate} max={endDate} onChange={e => setStartDate(e.target.value)} /></label>
      <label><span>结束日期</span><input aria-label="LibTV 结束日期" type="date" value={endDate} min={startDate} onChange={e => setEndDate(e.target.value)} /></label>
      <label><span>团队</span><select aria-label="LibTV 团队" value={teamMember} onChange={e => setTeamMember(e.target.value)}><option value="">全部团队成员</option>{teamMember && !options.teamMembers.includes(teamMember) && <option value={teamMember}>{teamMember}</option>}{options.teamMembers.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
      <label><span>模型</span><select aria-label="LibTV 模型" value={modelName} onChange={e => setModelName(e.target.value)}><option value="">全部模型</option>{modelName && !options.modelNames.includes(modelName) && <option value={modelName}>{modelName}</option>}{options.modelNames.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
      <div className="libtv-period-shortcuts">{[7,15,30].map(days => <button type="button" key={days} onClick={() => period(days)}>近 {days} 天</button>)}<button type="button" onClick={() => { period(7); setTeamMember(""); setModelName(""); }}>重置</button></div>
    </div>
    {loading && <div className="libtv-points-loading"><Spinner size="small" />正在读取积分消耗…</div>}
    {error && <div className="libtv-credit-alert" role="alert"><WarningRegular />{error}</div>}
    {data && <>
      {data.source.mode === "snapshot" && <div className="libtv-credit-alert is-stale">本地真实数据快照 · 采集于 {timestamp(data.source.updatedAt)}，非实时更新</div>}
      {!data.pricing.complete && <div className="libtv-credit-alert" role="status">{data.pricing.note} 涉及周期：{data.pricing.incompleteCycles.join("、")}</div>}
      <div className="libtv-credit-summary libtv-cost-summary">
        <article><span>累计消耗</span><strong>{number(data.summary.consumed)} <small>点</small></strong><small>{data.range.startDate} 至 {data.range.endDate}</small></article>
        <article><span>积分消耗估算金额</span><strong>{data.summary.estimatedAmount === null ? "待核验" : `¥${data.summary.estimatedAmount}`}</strong><small>所选范围 · 内部估算，非实际账单</small></article>
        <article><span>日均积分消耗估算金额</span><strong>{data.summary.dailyAverageAmount === null ? "待核验" : `¥${data.summary.dailyAverageAmount}`}</strong><small>按所选 {data.filters.days} 个自然日计算</small></article>
        <article><span>消耗记录</span><strong>{number(data.summary.transactionCount)} <small>笔</small></strong><small>{teamMember || "全部团队成员"} · {modelName || "全部模型"}</small></article>
      </div>
      <div className="libtv-credit-chart-card">
        <header><div><strong>{metric === "points" ? "每日积分消耗" : "每日积分消耗估算金额"}</strong><small>北京时间 · 单位：{metric === "points" ? "点" : "元"}</small></div><div className="libtv-metric-switch" role="group" aria-label="图表展示指标"><button type="button" aria-pressed={metric === "points"} onClick={() => setMetric("points")}>积分</button><button type="button" aria-pressed={metric === "amount"} onClick={() => setMetric("amount")}>估算金额</button></div></header>
        {data.summary.transactionCount > 0 ? <BarChart series={data.series} metric={metric} /> : <div className="libtv-credit-empty"><strong>当前筛选条件下暂无消耗记录</strong><span>请调整日期、团队或模型。</span></div>}
      </div>
      <details className="libtv-points-daily"><summary>查看每日数据（{data.series.length} 天）</summary><div><table><thead><tr><th>日期</th><th>消耗积分</th><th>积分消耗估算金额（元）</th><th>记录数</th></tr></thead><tbody>{data.series.map(row => <tr key={row.date}><td>{row.date}</td><td>{number(row.consumed)}</td><td>{row.estimatedAmount ?? "待核验"}</td><td>{number(row.transactionCount)}</td></tr>)}</tbody></table></div></details>
    </>}
    <div className="libtv-cost-rule">全账号共享额度 · 每月 16 日重置 · 周期前 132,000 分 ¥0.019/分，超出部分 ¥0.035/分。先按全账号计价，再按日期、团队成员和模型筛选。金额为内部估算，不代表实际充值、账单或付款金额。</div>
    {data?.source.latestConsumedAt && <p className="libtv-cost-rule">源流水最新消耗时间（北京时间）：{data.source.latestConsumedAt}。无流水日期按 0 展示。</p>}
    <footer><span>按北京时间统计；周期总金额使用未舍入结果汇总，与每日显示金额之和可能存在分位舍入差异。</span>{data && <small>更新 {timestamp(data.source.updatedAt)}</small>}</footer>
  </section>;
}
