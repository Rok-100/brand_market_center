import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { OmnichannelRealtimeOverview } from "./types";
import { combineSales, type CombinedSalesPoint } from "./combinedSales";
import "./combined-sales.css";

// Local extension: inherit the WIS light dashboard, navy type and blue accent.
// Show aligned dual-channel GSV first, then the daily curves and channel detail.
// Preserve the existing single-channel panels, refresh and permission boundaries.
const clock = (hour: number) => `${String(hour).padStart(2, "0")}:00`;
const yuan = (value: number | null) => value === null ? "待更新" : new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
const amount = (value: number | null) => value === null ? "待更新" : Math.abs(value) >= 10000 ? `${(value / 10000).toFixed(2)}万` : yuan(value);
const trend = (value: number | null) => value === null || value === 0 ? "omni-change-neutral" : value > 0 ? "omni-change-up" : "omni-change-down";

export function CombinedSalesChart({ data }: { data: OmnichannelRealtimeOverview }) {
  const summary = useMemo(() => combineSales(data), [data]);
  const [selected, setSelected] = useState<number | null>(null);
  const [width, setWidth] = useState(900);
  const wrapper = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => { setSelected(null); }, [data]);
  useEffect(() => {
    if (!wrapper.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(260, entry.contentRect.width)));
    observer.observe(wrapper.current);
    return () => observer.disconnect();
  }, []);
  const focusHour = selected ?? summary.throughHour ?? 0;
  const focused = summary.points[focusHour];
  const isReady = summary.throughHour !== null;
  const values = summary.points.flatMap(point => [point.today, point.yesterday]).filter((value): value is number => value !== null);
  const bottom = 228, top = 22, left = 56, right = width - 18;
  const min = Math.min(0, ...values), max = Math.max(1, ...values) * 1.08;
  // An hour bucket contains [hour, hour + 1); cumulative values belong at its end.
  const x = (hour: number) => left + (hour + 1) / 24 * (right - left);
  const y = (value: number) => bottom - (value - min) / (max - min) * (bottom - top);
  function path(key: "today" | "yesterday") {
    let drawing = false;
    return summary.points.map(point => {
      if (point[key] === null) { drawing = false; return ""; }
      const command = drawing ? "L" : "M"; drawing = true;
      return `${command}${x(point.hour).toFixed(2)},${y(point[key]!).toFixed(2)}`;
    }).join(" ");
  }
  function detail(point: CombinedSalesPoint | undefined, day: "today" | "yesterday") {
    return <div><span>{day === "today" ? summary.todayDate : summary.yesterdayDate}<b>{point ? yuan(point[day]) : "待更新"} 元</b></span>
      <small>抖音 {point ? yuan(point[day === "today" ? "todayDouyin" : "yesterdayDouyin"]) : "待更新"} · 视频号 {point ? yuan(point[day === "today" ? "todayWechat" : "yesterdayWechat"]) : "待更新"}</small></div>;
  }
  return <article className="omni-combined" aria-labelledby={`${id}-title`}>
    <header><div><h3 id={`${id}-title`}>双渠道销售汇总</h3><p>抖音＋视频号 · 有效成交额 GSV</p></div>
      <span className="combined-window">{isReady ? `${summary.todayDate} vs ${summary.yesterdayDate} · 对比时段 00:00–${clock(summary.throughHour! + 1)}` : "等待共同完整时段"}</span></header>
    <dl className="combined-metrics">
      <div><dt>{summary.todayDate || "今日"} 同进度合计</dt><dd title={yuan(summary.today)}>{amount(summary.today)}</dd></div>
      <div><dt>{summary.yesterdayDate || "昨日"} 同进度合计</dt><dd title={yuan(summary.yesterday)}>{amount(summary.yesterday)}</dd></div>
      <div><dt>较昨日增减金额</dt><dd className={trend(summary.delta)} title={yuan(summary.delta)}>{summary.delta !== null && summary.delta > 0 ? "+" : ""}{amount(summary.delta)}</dd></div>
      <div><dt>较昨日增减幅度</dt><dd className={trend(summary.percent)}>{summary.percent === null ? isReady ? "暂无可比基数" : "待更新" : `${summary.percent > 0 ? "+" : ""}${summary.percent.toFixed(1)}%`}</dd></div>
    </dl>
    <div className="combined-legend"><span><i />{summary.todayDate || "今日"} 累计</span><span><i className="previous" />{summary.yesterdayDate || "昨日"} 累计</span><small>单位：元</small></div>
    <div className="combined-plot" ref={wrapper}>
      {isReady ? <svg viewBox={`0 0 ${width} 258`} role="img" aria-label={`双渠道累计有效成交额，${summary.todayDate}同进度${yuan(summary.today)}元，${summary.yesterdayDate}同进度${yuan(summary.yesterday)}元。下方可选择时段查看渠道明细。`}
        onPointerMove={event => { const rect = event.currentTarget.getBoundingClientRect(); setSelected(Math.max(0, Math.min(23, Math.round(((event.clientX - rect.left) / rect.width * width - left) / (right - left) * 24 - 1)))); }}>
        {[0, 1, 2, 3].map(index => { const value = min + (max - min) * index / 3; return <g key={index}><line x1={left} x2={right} y1={y(value)} y2={y(value)} className="combined-grid" /><text x={left - 8} y={y(value) + 4} textAnchor="end">{Math.abs(value) >= 10000 ? `${(value / 10000).toFixed(0)}万` : value.toFixed(0)}</text></g>; })}
        {(width < 520 ? [0, 6, 12, 18, 24] : [0, 3, 6, 9, 12, 15, 18, 21, 24]).map(hour => <text key={hour} x={x(hour - 1)} y="249" textAnchor="middle">{clock(hour)}</text>)}
        <path d={path("yesterday")} className="combined-yesterday" /><path d={path("today")} className="combined-today" />
        <line x1={x(focusHour)} x2={x(focusHour)} y1={top} y2={bottom} className="combined-focus" />
        {focused && (["today", "yesterday"] as const).map(day => focused[day] !== null && <circle key={day} cx={x(focusHour)} cy={y(focused[day]!)} r="4" className={`combined-dot ${day}`} />)}
      </svg> : <div className="combined-pending" role="status"><strong>汇总数据待更新</strong><p>{summary.reason}</p></div>}
    </div>
    {isReady && <div className="combined-inspector">
      <label htmlFor={`${id}-hour`}>累计至 {clock(focusHour + 1)}<input id={`${id}-hour`} type="range" min="0" max="23" step="1" value={focusHour} onChange={event => setSelected(Number(event.target.value))} aria-valuetext={`累计至${clock(focusHour + 1)}，${summary.todayDate}合计${focused?.today === null ? "待更新" : yuan(focused?.today ?? null)}元，${summary.yesterdayDate}合计${yuan(focused?.yesterday ?? null)}元`} /></label>
      {detail(focused, "today")}{detail(focused, "yesterday")}
    </div>}
    <footer>两个渠道取共同完整时段；当前小时不参与涨跌计算。{data.status === "stale" ? " 当前为最近成功快照。" : ""}{isReady && " 悬停曲线或拖动时段条可查看渠道明细。"}</footer>
  </article>;
}
