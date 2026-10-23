"use client";

import { useEffect, useMemo, useState } from "react";
import { unzipSync } from "fflate";

type View = "overview" | "daily" | "review" | "cases" | "competitors" | "scripts" | "collaborations";
type Toast = { title: string; detail: string } | null;

const SCRIPT_TYPES = ["付费KOC脚本", "唠嗑KOC脚本", "明星脚本", "AI脚本", "自产脚本", "混剪脚本", "剧情脚本"] as const;
const PRODUCTS = ["眼膜", "水润面膜", "水油/蛋白喷雾", "美白针", "黄金面膜", "微针面膜", "燕窝面膜", "次抛精华"] as const;
const COMPETITOR_BRANDS = ["C咖", "谷雨", "韩束", "奕沃/EIIO", "达尔肤", "敷尔佳", "达肤妍", "丸美", "可逐/kazoo", "造物者", "RNW", "ELL", "原生密码", "百雀羚", "自然堂"] as const;

const APP_BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
const appUrl = (path: string) => `${APP_BASE}${path}`;

type CaseVideo = { id: string; title: string; url: string; duration: string; coverTone: string };
type CaseRecord = {
  id: string;
  scriptType: string;
  product: string;
  title: string;
  copy: string;
  status: string;
  source: string;
  authorType?: string;
  authorName?: string;
  authorUserId?: string;
  uploaderId?: string;
  uploaderName?: string;
  finalReviewerName?: string;
  talentName?: string;
  videos: CaseVideo[];
};
type DraftRecord = {
  id: string;
  product: string;
  scriptType: string;
  templateId: string;
  templateTitle: string;
  requirements: string;
  title: string;
  content: string;
  version: number;
  status: string;
  feedback: string;
  creatorId: string;
  creatorName: string;
  uploaderId: string;
  uploaderName: string;
  authorType: string;
  authorName: string;
  authorUserId: string;
  teamLeadReviewerId: string;
  teamLeadReviewerName: string;
  supervisorReviewerId: string;
  supervisorReviewerName: string;
  currentReviewerId: string;
  priority: string;
  dueDate: string;
  resumeStage: string;
  talentName: string;
  videoLinks: string;
};
type WorkspaceUser = { id: string; employeeNo: string; name: string; department: string; center: string; jobTitle: string; feishuUserId: string; role: "contributor" | "team_lead" | "supervisor" | "director" | "admin"; active: boolean; loginRegistered: boolean; preloaded: boolean; lastSeenAt: string };
type WorkbenchPayload = {
  user: WorkspaceUser;
  users: WorkspaceUser[];
  counts: { assigned: number; returned: number; submitted: number; completed: number; dueSoon: number; unread: number; teamPending: number };
  assigned: DraftRecord[];
  returned: DraftRecord[];
  submissions: DraftRecord[];
  teamQueue: DraftRecord[];
};
type CompetitorRecord = {
  id: string;
  title: string;
  brand: string;
  product: string;
  scriptType: string;
  copy: string;
  source: string;
  createdAt?: string;
};
type CompetitorRecognition = Omit<CompetitorRecord, "id" | "source" | "createdAt" | "product">;
type PlatformStats = { cases: number; videos: number; competitors: number; pendingReview: number; approved: number; collaborations: number };
type CollaborationRecord = { id: string; creatorName: string; platform: string; product: string; owner: string; stage: string; dueDate: string; note: string; updatedAt: string };
type ScriptAlternative = { id: string; draftId: string; title: string; content: string; request: string; creatorName: string; adopted: boolean; createdAt: string };

const navItems: { id: View; label: string; icon: string; badge?: string }[] = [
  { id: "overview", label: "创意总览", icon: "⌂" },
  { id: "daily", label: "日常脚本创作", icon: "＋" },
  { id: "review", label: "审核与反馈", icon: "✓" },
  { id: "cases", label: "品牌案例库", icon: "▦" },
  { id: "competitors", label: "竞对案例库", icon: "◫" },
  { id: "scripts", label: "AI 脚本创作", icon: "✦" },
  { id: "collaborations", label: "达人合作进度", icon: "◎" },
];

const seedCases: CaseRecord[] = [
  { id: "CS-0286", scriptType: "剧情脚本", product: "眼膜", title: "凌晨一点的眼周急救", copy: "凌晨一点，她刚结束今天第三场会议。镜头推近眼周，她没有继续遮盖疲态，而是拿出眼膜：真正的急救，不是藏住疲惫，是给自己十分钟恢复状态。", status: "新跑出", source: "案例沉淀", videos: [
    { id: "V-286A", title: "办公室剧情版", url: "", duration: "00:38", coverTone: "violet" },
    { id: "V-286B", title: "夜间居家版", url: "", duration: "00:31", coverTone: "blue" },
  ]},
  { id: "CS-0285", scriptType: "付费KOC脚本", product: "水润面膜", title: "空调房干脸实测", copy: "我在空调房坐满八小时，脸最容易出现的不是出油，而是干到卡粉。今天用这片水润面膜做一次上脸实测，十五分钟后直接看两边肤感差别。", status: "起量中", source: "案例沉淀", videos: [
    { id: "V-285A", title: "上班族实测版", url: "", duration: "00:42", coverTone: "forest" },
  ]},
  { id: "CS-0284", scriptType: "唠嗑KOC脚本", product: "水油/蛋白喷雾", title: "包里一直留着的补水搭子", copy: "姐妹们我最近包里一直放着这个喷雾，不是那种喷完马上就干的水雾。摇匀之后水油一起上脸，妆前、空调房和下午卡粉的时候我都会拿出来用。", status: "已验证", source: "团队创作", videos: [
    { id: "V-284A", title: "通勤唠嗑版", url: "", duration: "00:29", coverTone: "rose" },
    { id: "V-284B", title: "下午补妆版", url: "", duration: "00:24", coverTone: "amber" },
  ]},
  { id: "CS-0283", scriptType: "混剪脚本", product: "美白针", title: "七天状态变化记录", copy: "用七组连续日期画面快速呈现肤色与光泽变化，前后对比不使用夸张滤镜。中段穿插成分与使用步骤，结尾落到坚持护理带来的稳定状态。", status: "待验证", source: "案例沉淀", videos: [
    { id: "V-283A", title: "7日记录混剪", url: "", duration: "00:35", coverTone: "amber" },
  ]},
  { id: "CS-0282", scriptType: "AI脚本", product: "黄金面膜", title: "贵妇面膜的夜间急救", copy: "越忙，越不能把疲惫留在脸上。把夜间护理压缩成十五分钟：清洁之后敷上面膜，让第二天的状态从今晚开始准备。", status: "高ROI", source: "AI生成", videos: [
    { id: "V-282A", title: "夜间急救版", url: "", duration: "00:32", coverTone: "amber" },
  ]},
  { id: "CS-0281", scriptType: "自产脚本", product: "微针面膜", title: "同价位三款横向测评", copy: "把同价位三款面膜放在一起，从膜布贴合度、使用步骤和次日肤感三个维度横向比较。重点保留真实过程，不回避不同肤质的体验差异。", status: "观察中", source: "团队创作", videos: [] },
];

const deliveryRows = [
  { id: "AD-8231", script: "SC-1028", title: "贵妇面膜的夜间急救", spend: "¥18,420", sales: "¥72,326", roi: 3.93, ctr: "8.4%", trend: "+26%", state: "放量中" },
  { id: "AD-8226", script: "SC-1019", title: "28天肤感记录", spend: "¥14,860", sales: "¥51,608", roi: 3.47, ctr: "7.8%", trend: "+12%", state: "稳定" },
  { id: "AD-8219", script: "SC-1007", title: "熬夜脸急救清单", spend: "¥9,720", sales: "¥27,799", roi: 2.86, ctr: "6.9%", trend: "+8%", state: "观察" },
  { id: "AD-8204", script: "SC-0988", title: "次抛成分党测评", spend: "¥6,340", sales: "¥11,032", roi: 1.74, ctr: "4.2%", trend: "-18%", state: "衰退" },
];

function AppIcon({ children }: { children: React.ReactNode }) {
  return <span className="app-icon">{children}</span>;
}

function Tag({ children, tone = "neutral" }: { children: React.ReactNode; tone?: string }) {
  return <span className={`tag tag-${tone}`}>{children}</span>;
}

function caringGreeting(name: string) {
  const hour = new Date().getHours();
  if (hour < 5) return { title: `${name}，夜深了`, note: "辛苦了，先处理最紧要的一件事，也记得早点休息。" };
  if (hour < 11) return { title: `${name}，早上好！`, note: "新的一天慢慢展开，重要任务已经替你整理好了。" };
  if (hour < 14) return { title: `${name}，中午好！`, note: "忙碌之余记得好好吃饭，下午的任务也已为你归拢。" };
  if (hour < 18) return { title: `${name}，下午好！`, note: "保持自己的节奏，接下来先完成最有价值的工作。" };
  return { title: `${name}，晚上好！`, note: "今天辛苦了，收好最后几件事，就给自己留一点放松时间。" };
}

export default function Home() {
  const [view, setView] = useState<View>("overview");
  const [search, setSearch] = useState("");
  const [caseFilter, setCaseFilter] = useState("全部");
  const [scriptTypeFilter, setScriptTypeFilter] = useState("全部脚本");
  const [caseItems, setCaseItems] = useState<CaseRecord[]>([]);
  const [casesLoading, setCasesLoading] = useState(true);
  const [casesError, setCasesError] = useState("");
  const [competitorItems, setCompetitorItems] = useState<CompetitorRecord[]>([]);
  const [competitorHasMore, setCompetitorHasMore] = useState(false);
  const [reviewDrafts, setReviewDrafts] = useState<DraftRecord[]>([]);
  const [workbench, setWorkbench] = useState<WorkbenchPayload | null>(null);
  const [stats, setStats] = useState<PlatformStats>({ cases: 0, videos: 0, competitors: 0, pendingReview: 0, approved: 0, collaborations: 0 });
  const [toast, setToast] = useState<Toast>(null);

  useEffect(() => {
    let active = true;
    fetch(appUrl("/api/cases"))
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("品牌案例库暂不可用")))
      .then((payload: { cases?: CaseRecord[] }) => {
        if (!active) return;
        setCaseItems(payload.cases ?? []);
        setCasesError("");
      })
      .catch(() => active && setCasesError("品牌案例暂时没有加载成功，请刷新页面重试。"))
      .finally(() => active && setCasesLoading(false));
    fetch(appUrl("/api/workbench"))
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("个人工作台暂不可用")))
      .then((payload: WorkbenchPayload) => {
        if (!active || !payload.user) return;
        setWorkbench(payload);
        const all = [...payload.assigned, ...payload.returned, ...payload.submissions, ...payload.teamQueue];
        setReviewDrafts(Array.from(new Map(all.map((item) => [item.id, item])).values()));
      })
      .catch(() => undefined);
    fetch(appUrl("/api/competitor-cases?limit=100&offset=0"))
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("竞对案例库暂不可用")))
      .then((payload: { scripts?: CompetitorRecord[]; hasMore?: boolean }) => {
        if (active && payload.scripts) {
          setCompetitorItems(payload.scripts);
          setCompetitorHasMore(!!payload.hasMore);
        }
      })
      .catch(() => undefined);
    fetch(appUrl("/api/stats")).then((response) => response.ok ? response.json() : Promise.reject()).then((payload: PlatformStats) => active && setStats(payload)).catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const refresh = () => fetch(appUrl("/api/stats")).then((response) => response.ok ? response.json() : Promise.reject()).then((payload: PlatformStats) => setStats(payload)).catch(() => undefined);
    refresh();
    const timer = window.setInterval(refresh, 15000);
    return () => window.clearInterval(timer);
  }, [caseItems.length, competitorItems.length, reviewDrafts.length]);

  const showToast = (title: string, detail: string) => {
    setToast({ title, detail });
    window.setTimeout(() => setToast(null), 3200);
  };

  const visibleCases = useMemo(() => {
    return caseItems.filter((item) => {
      const matchesSearch = `${item.title}${item.copy}${item.product}${item.scriptType}`.toLowerCase().includes(search.toLowerCase());
      const matchesFilter = caseFilter === "全部" || item.product === caseFilter;
      const matchesType = scriptTypeFilter === "全部脚本" || item.scriptType === scriptTypeFilter;
      return matchesSearch && matchesFilter && matchesType;
    });
  }, [caseItems, search, caseFilter, scriptTypeFilter]);

  return (
    <div className="app-shell">
      <aside className="command-sidebar">
        <button className="brand" onClick={() => setView("overview")} aria-label="回到创意工作台">
          <span className="brand-mark">IO</span>
          <span><strong>IDEA OS</strong><small>CREATIVE COMMAND</small></span>
        </button>

        <div className="workspace-identity">
          <span className="workspace-kicker">WORKSPACE / 01</span>
          <strong>创意智能中枢</strong>
          <small>IDEA OPERATING SYSTEM</small>
        </div>

        <span className="nav-label">工作空间</span>
        <nav className="main-nav" aria-label="主要导航">
          {navItems.map((item) => (
            <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}>
              <span className="nav-index">0{navItems.findIndex((nav) => nav.id === item.id) + 1}</span>
              <AppIcon>{item.icon}</AppIcon><span>{item.label}</span>{item.badge && <em>{item.badge}</em>}<b className="nav-arrow">↗</b>
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="learning-card"><span className="pulse-dot"/><div><strong>创意系统运行中</strong><small>数据与模型已同步</small></div></div>
          <button className="profile" aria-label="当前登录员工"><span className="avatar">{workbench?.user.name.slice(0,1) || "创"}</span><span><strong>{workbench?.user.name || "正在读取身份"}</strong><small>{workbench?.user.employeeNo || "OA IDENTITY"}{workbench?.user.jobTitle ? ` · ${workbench.user.jobTitle}` : ""}</small></span><b>•••</b></button>
        </div>
      </aside>

      <div className="workspace-frame">
        <header className="command-topbar">
          <button className="mobile-brand" onClick={() => setView("overview")}><span className="brand-mark">IO</span><strong>IDEA OS</strong></button>
          <label className="global-search">
            <span>⌕</span>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索案例、脚本或素材 ID" />
            <kbd>⌘ K</kbd>
          </label>
          <div className="command-actions"><span className="system-status"><i /> SYSTEM ONLINE</span><span className="command-date">{new Intl.DateTimeFormat("zh-CN", { year:"numeric", month:"2-digit", day:"2-digit" }).format(new Date())} / CST</span><button className="utility-btn" aria-label="消息通知">●</button></div>
        </header>

      <main className="workspace">
        {view === "overview" && <Overview stats={stats} workbench={workbench} onCreate={() => setView("daily")} onNavigate={setView} />}
        {view === "daily" && <DailyScriptsView users={workbench?.users ?? []} currentUser={workbench?.user ?? null} onSubmitted={(draft) => { setReviewDrafts((current) => [draft, ...current.filter((item) => item.id !== draft.id)]); setView("review"); showToast("脚本已提交", `${draft.title} 已推送给 ${draft.teamLeadReviewerName}`); }} />}
        {view === "cases" && <CasesView items={visibleCases} allItems={caseItems} currentUser={workbench?.user ?? null} loading={casesLoading} loadError={casesError} filter={caseFilter} setFilter={setCaseFilter} scriptTypeFilter={scriptTypeFilter} setScriptTypeFilter={setScriptTypeFilter} onImported={(item) => { setCaseItems((current) => [item, ...current]); showToast("素材已入库", "已按脚本类型、单品和文案归档"); }} onChanged={(item) => setCaseItems((current) => current.map((entry) => entry.id === item.id ? item : entry))} onDeleted={(id) => setCaseItems((current) => current.filter((entry) => entry.id !== id))} />}
        {view === "competitors" && <CompetitorCasesView items={competitorItems} hasMore={competitorHasMore} onLoadMore={(items, hasMore) => { setCompetitorItems((current) => [...current, ...items.filter((item) => !current.some((existing) => existing.id === item.id))]); setCompetitorHasMore(hasMore); }} onImported={(items) => { setCompetitorItems((current) => [...items, ...current]); showToast("竞对脚本已入库", `本次成功存入 ${items.length} 条脚本`); }} />}
        {view === "scripts" && <ScriptsView cases={caseItems} users={workbench?.users ?? []} currentUser={workbench?.user ?? null} onSubmitted={(draft) => { setReviewDrafts((current) => [draft, ...current.filter((item) => item.id !== draft.id)]); setView("review"); showToast("已提交组长审核", `${draft.title} 已推送给 ${draft.teamLeadReviewerName}`); }} showToast={showToast} />}
        {view === "review" && <ReviewView items={reviewDrafts} currentUser={workbench?.user ?? null} onUpdate={(draft) => setReviewDrafts((current) => current.map((item) => item.id === draft.id ? draft : item))} onDeleted={(id) => setReviewDrafts((current) => current.filter((item) => item.id !== id))} onApproved={(draft, caseItem) => { setReviewDrafts((current) => current.map((item) => item.id === draft.id ? draft : item)); setCaseItems((current) => current.some((item) => item.id === caseItem.id) ? current : [caseItem, ...current]); showToast("主管终审通过", `${caseItem.title} 已保存到品牌案例库`); }} showToast={showToast} />}
        {view === "collaborations" && <CollaborationsView />}
      </main>
      </div>

      {toast && <div className="toast" role="status"><span>✓</span><div><strong>{toast.title}</strong><small>{toast.detail}</small></div></div>}
    </div>
  );
}

function PageHeading({ eyebrow, title, copy, action }: { eyebrow: string; title: string; copy: string; action?: React.ReactNode }) {
  return <div className="page-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{copy}</p></div><div className="heading-action">{action}<span className="heading-index">IDEA / OS — 2026</span></div></div>;
}

function Overview({ stats, workbench, onCreate, onNavigate }: { stats: PlatformStats; workbench: WorkbenchPayload | null; onCreate: () => void; onNavigate: (view: View) => void }) {
  const greeting = caringGreeting(workbench?.user.name || "你好");
  const totalAssets = stats.cases + stats.competitors;
  const metrics = [
    { label: "品牌案例", value: String(stats.cases), delta: String(stats.videos), note: "关联视频", icon: "▦", tone: "mint" },
    { label: "竞对案例", value: String(stats.competitors), delta: String(stats.pendingReview), note: "待审核脚本", icon: "◫", tone: "violet" },
    { label: "审核通过", value: String(stats.approved), delta: String(stats.collaborations), note: "达人合作", icon: "✓", tone: "amber" },
    { label: "平台总资产", value: String(stats.cases + stats.competitors), delta: "实时", note: "数据库统计", icon: "⌁", tone: "blue" },
  ];
  return <div className="page overview-page">
    <PageHeading eyebrow="CREATIVE COMMAND CENTER" title="创意总览" copy="把今天要做的事、正在推进的创意和团队沉淀，都放在触手可及的位置。" action={<button className="primary-btn" onClick={onCreate}><span>＋</span> 提交日常脚本</button>} />

    <section className="personal-workbench">
      <div className="workbench-lead"><span className="eyebrow">MY WORKBENCH</span><h2>{workbench?.user.name ? greeting.title : "正在为你准备工作台"}</h2><p>{workbench?.user.name ? greeting.note : "登录后，你的任务与审核进度会在这里自动出现。"}</p><small>{workbench?.user.department || "创意团队"}{workbench?.user.jobTitle ? ` · ${workbench.user.jobTitle}` : ""}</small></div>
      <button onClick={() => onNavigate("review")}><small>分配给我</small><strong>{workbench?.counts.assigned ?? 0}</strong><span>进入审核 →</span></button>
      <button onClick={() => onNavigate("review")}><small>退回待修改</small><strong>{workbench?.counts.returned ?? 0}</strong><span>继续改稿 →</span></button>
      <button onClick={() => onNavigate("review")}><small>我提交的</small><strong>{workbench?.counts.submitted ?? 0}</strong><span>查看进度 →</span></button>
      <button onClick={() => onNavigate("review")}><small>临期任务</small><strong>{workbench?.counts.dueSoon ?? 0}</strong><span>优先处理 →</span></button>
    </section>

    <section className="ai-briefing">
      <span className="hero-number">01</span><span className="hero-status"><i/> LIVE CREATIVE SIGNAL</span>
      <div className="briefing-copy"><Tag tone="glow">LIVE DATA BRIEF</Tag><h2>平台已沉淀<br />{totalAssets} 条脚本资产。</h2><p>当前品牌案例 {stats.cases} 条、竞对案例 {stats.competitors} 条，关联视频 {stats.videos} 个；另有 {stats.pendingReview} 条脚本等待审核。所有数字均直接来自平台数据库。</p><div className="briefing-actions"><button onClick={() => onNavigate("review")}>处理待审核脚本 <span>↗</span></button><button className="ghost-light" onClick={() => onNavigate("scripts")}>创建新脚本</button></div></div>
      <div className="signal-orbit"><span className="orbit-index">01 / DATABASE</span><div className="signal-rings"><i/><i/><i/><i/></div><div className="signal-core"><strong>{stats.pendingReview}</strong><small>待审核</small></div><span className="signal-note note-a">品牌案例 {stats.cases}</span><span className="signal-note note-b">竞对案例 {stats.competitors}</span></div>
    </section>

    <section className="metric-grid">
      {metrics.map((metric) => <article className="metric-card" key={metric.label}><div className={`metric-icon ${metric.tone}`}>{metric.icon}</div><div><span>{metric.label}</span><strong>{metric.value}</strong><p><b>{metric.delta}</b> {metric.note}</p></div></article>)}
    </section>

    <section className="overview-grid">
      <article className="panel workflow-panel">
        <div className="panel-head"><div><span className="eyebrow">CREATIVE LOOP</span><h3>今日创意闭环</h3></div><button onClick={() => onNavigate("review")}>查看任务 →</button></div>
        <div className="pipeline">
          {[{n:"01",t:"品牌案例",v:stats.cases,s:"已入库"},{n:"02",t:"关联视频",v:stats.videos,s:"已存储"},{n:"03",t:"人工审核",v:stats.pendingReview,s:"待处理"},{n:"04",t:"竞对案例",v:stats.competitors,s:"已沉淀"},{n:"05",t:"达人合作",v:stats.collaborations,s:"进行中"}].map((step,i)=><div className="pipeline-step" key={step.t}><span>{step.n}</span><div className={`pipeline-node ${step.v>0?"done":""}`}>{step.v>0?"✓":"⌁"}</div><strong>{step.t}</strong><p><b>{step.v}</b> {step.s}</p></div>)}
        </div>
      </article>
      <article className="panel alert-panel">
        <div className="panel-head"><div><span className="eyebrow">LIVE STATUS</span><h3>当前工作状态</h3></div><Tag tone={stats.pendingReview ? "warning" : "success"}>{stats.pendingReview} 项待审</Tag></div>
        <button className="attention-item" onClick={() => onNavigate("review")}><span className="attention-icon risk">!</span><div><strong>{stats.pendingReview} 条脚本等待审核</strong><small>审核通过后自动进入品牌案例库</small></div><b>→</b></button>
        <button className="attention-item" onClick={() => onNavigate("collaborations")}><span className="attention-icon down">◎</span><div><strong>{stats.collaborations} 项达人合作任务</strong><small>在合作进度板中查看与推进</small></div><b>→</b></button>
        <button className="attention-item" onClick={() => onNavigate("cases")}><span className="attention-icon data">＋</span><div><strong>{stats.videos} 个关联视频</strong><small>已与品牌案例建立关联</small></div><b>→</b></button>
      </article>
      <article className="panel performance-panel">
        <div className="panel-head"><div><span className="eyebrow">ASSET COMPOSITION</span><h3>平台资产构成</h3></div><button onClick={() => onNavigate("cases")}>查看案例 →</button></div>
        <div className="top-creative"><div className="creative-rank">{String(totalAssets).padStart(2,"0")}</div><div className="creative-thumb amber"><span>实时数据</span><b>资产总览</b></div><div className="creative-info"><Tag tone="success">数据库同步</Tag><h4>{totalAssets} 条可检索脚本</h4><p>品牌案例与竞对案例统一纳入创作参考体系</p></div><div className="creative-stats"><span><small>品牌</small><strong>{stats.cases}</strong></span><span><small>竞对</small><strong>{stats.competitors}</strong></span><span><small>视频</small><strong>{stats.videos}</strong></span></div></div>
      </article>
    </section>
  </div>;
}

function recognizeMaterial(raw: string) {
  const typeRules: [string, RegExp][] = [
    ["自产脚本", /自产|自制|团队创作/i], ["明星脚本", /明星|艺人|代言/i], ["付费KOC脚本", /付费|投流|达人合作|商单/i],
    ["唠嗑KOC脚本", /唠嗑|聊天|姐妹们|家人们|碎碎念/i], ["剧情脚本", /剧情|场景|对白|转场|人物/i],
    ["混剪脚本", /混剪|素材拼接|快剪|蒙太奇/i], ["AI脚本", /\bAI\b|人工智能|数字人|对口型/i],
  ];
  const productRules: [string, RegExp][] = [
    ["水油/蛋白喷雾", /水油|蛋白喷雾|喷雾/i], ["水润面膜", /水润面膜|补水面膜|保湿面膜/i],
    ["眼膜", /眼膜|眼周|黑眼圈|眼袋/i], ["美白针", /美白针|焕白|提亮/i],
    ["黄金面膜", /黄金面膜|黄金膜/i], ["微针面膜", /微针面膜|微针/i],
    ["燕窝面膜", /燕窝面膜|燕窝/i], ["次抛精华", /次抛|安瓶/i],
  ];
  const matchedType = typeRules.find(([, pattern]) => pattern.test(raw));
  const matchedProduct = productRules.find(([, pattern]) => pattern.test(raw));
  const urls = [...(raw.match(/https?:\/\/[^\s，。]+/gi) ?? [])];
  const markedCopy = raw.match(/(?:脚本文案|文案)\s*[:：]\s*([\s\S]+)/i)?.[1];
  const authorName = raw.match(/(?:作者|达人名|达人)\s*[:：]\s*([^\n]+)/i)?.[1]?.trim() || "待确认";
  const authorType = /达人名|达人\s*[:：]|KOC/i.test(raw) ? "外部达人" : "内部同事";
  const fallbackCopy = raw
    .split(/\n+/)
    .filter((line) => !/^\s*(?:标题|脚本名称|脚本类型|类型|单品|产品|作者|达人名|达人|视频|链接)\s*[:：]/.test(line) && !/^\s*https?:\/\//i.test(line))
    .join("\n")
    .trim();
  const copy = (markedCopy ?? fallbackCopy).replace(/https?:\/\/[^\s，。]+/gi, "").trim();
  return {
    scriptType: matchedType?.[0] ?? "AI脚本",
    product: matchedProduct?.[0] ?? "水润面膜",
    copy,
    authorType,
    authorName,
    videoUrls: urls,
    confidence: Math.min(96, 64 + (matchedType ? 14 : 0) + (matchedProduct ? 14 : 0) + (copy.length > 30 ? 4 : 0)),
  };
}

async function extractDocument(file: File) {
  if (/\.(txt|md)$/i.test(file.name) || file.type.startsWith("text/")) return file.text();
  if (!/\.docx$/i.test(file.name)) throw new Error(`${file.name} 暂不支持，请上传 DOCX、TXT 或 MD`);
  const archive = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const xml = archive["word/document.xml"];
  if (!xml) throw new Error(`${file.name} 不是有效的 DOCX 文档`);
  const doc = new DOMParser().parseFromString(new TextDecoder().decode(xml), "application/xml");
  return Array.from(doc.getElementsByTagName("w:p")).map((paragraph) => paragraph.textContent?.trim()).filter(Boolean).join("\n");
}

function CasesView({ items, allItems, currentUser, loading, loadError, filter, setFilter, scriptTypeFilter, setScriptTypeFilter, onImported, onChanged, onDeleted }: {
  items: CaseRecord[];
  allItems: CaseRecord[];
  currentUser: WorkspaceUser | null;
  loading: boolean;
  loadError: string;
  filter: string;
  setFilter: (v: string) => void;
  scriptTypeFilter: string;
  setScriptTypeFilter: (v: string) => void;
  onImported: (item: CaseRecord) => void;
  onChanged: (item: CaseRecord) => void;
  onDeleted: (id: string) => void;
}) {
  const [importOpen, setImportOpen] = useState(false);
  const [rawText, setRawText] = useState("");
  const [step, setStep] = useState<"input" | "confirm">("input");
  const [recognitions, setRecognitions] = useState<ReturnType<typeof recognizeMaterial>[]>([]);
  const [selectedCase, setSelectedCase] = useState<CaseRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const closeImport = () => { setImportOpen(false); setStep("input"); setRawText(""); setRecognitions([]); setError(""); };
  const analyze = () => {
    if (rawText.trim().length < 8) { setError("请至少输入 8 个字的素材内容"); return; }
    const blocks = rawText.split(/\n\s*(?:-{3,}|={3,})\s*\n/g).filter((block) => block.trim().length >= 8).slice(0, 100);
    setRecognitions(blocks.map(recognizeMaterial));
    setError("");
    setStep("confirm");
  };
  const save = async () => {
    if (!recognitions.length || recognitions.some((item) => item.copy.trim().length < 8)) { setError("请确认每条素材都有完整脚本文案"); return; }
    setSaving(true); setError("");
    try {
      for (const recognition of recognitions) {
        const response = await fetch(appUrl("/api/cases"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(recognition) });
        const payload = await response.json() as { case?: CaseRecord; error?: string };
        if (!response.ok || !payload.case) throw new Error(payload.error || "导入失败");
        onImported(payload.case);
      }
      closeImport();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "导入失败，请稍后重试");
    } finally { setSaving(false); }
  };

  const visibleTypes = SCRIPT_TYPES.filter((type) => scriptTypeFilter === "全部脚本" || type === scriptTypeFilter);
  const importDocuments = async (files: FileList | null) => {
    if (!files?.length) return;
    setError("");
    try {
      const documents = await Promise.all(Array.from(files).map(async (file) => `标题：${file.name.replace(/\.[^.]+$/, "")}\n${await extractDocument(file)}`));
      setRawText(documents.join("\n---\n"));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "文档读取失败"); }
  };

  return <div className="page case-page">
    <PageHeading eyebrow="SCRIPT-FIRST LIBRARY" title="品牌案例库" copy="按脚本类型、单品和文案组织案例；每条文案可编辑，并关联视频文件或链接。" action={<button className="primary-btn" onClick={() => setImportOpen(true)}>＋ 批量导入素材</button>} />
    <div className="case-toolbar"><div><span className="toolbar-label">脚本类型</span><div className="segmented product-segments"><button className={scriptTypeFilter === "全部脚本" ? "active" : ""} onClick={() => setScriptTypeFilter("全部脚本")}>全部</button>{SCRIPT_TYPES.map((value) => <button className={scriptTypeFilter === value ? "active" : ""} onClick={() => setScriptTypeFilter(value)} key={value}>{value}</button>)}</div></div><div><span className="toolbar-label">单品</span><div className="segmented product-segments">{["全部", ...PRODUCTS].map((value) => <button className={filter === value ? "active" : ""} onClick={() => setFilter(value)} key={value}>{value}</button>)}</div></div><span className="case-total">显示 {items.length} / {allItems.length} 条</span></div>

      <div className="case-library-layout">
      <section className="case-library-main">
        {visibleTypes.map((type) => {
          const typeItems = items.filter((item) => item.scriptType === type);
          if (!typeItems.length) return null;
          return <div className="script-type-group" key={type}>
            <div className="type-group-head"><div><span className="type-index">{String(SCRIPT_TYPES.indexOf(type) + 1).padStart(2, "0")}</span><h2>{type}</h2></div><span>{typeItems.length} 条文案</span></div>
            {PRODUCTS.map((product) => {
              const productItems = typeItems.filter((item) => item.product === product);
              if (!productItems.length) return null;
              return <div className="product-group" key={product}>
                <div className="product-group-head"><span className="product-dot"/><h3>{product}</h3><small>{productItems.length} 条</small></div>
                <div className="copy-list">{productItems.map((item) => <article className="copy-card" key={item.id}>
                  <div className="copy-card-main"><div className="copy-meta"><span>{item.id}</span><Tag>{item.source}</Tag><Tag tone={item.status === "新跑出" || item.status === "高ROI" ? "success" : item.status === "待验证" ? "warning" : "neutral"}>{item.status}</Tag></div><h3>{item.title}</h3><div className="case-attribution">{item.talentName && <span>达人 <b>{item.talentName}</b></span>}<span>作者 <b>{item.authorName || "待补充"}</b></span></div><p className="copy-preview">{item.copy.slice(0, 180)}{item.copy.length > 180 ? "…" : ""}</p><button className="case-edit-btn" onClick={() => setSelectedCase(item)}>查看全文 / 编辑 →</button></div>
                  <div className="copy-videos"><div className="video-section-head"><span>关联视频</span><b>{item.videos.length}</b></div>{item.videos.length ? <div className="video-strip">{item.videos.map((video) => video.url ? <a href={video.url} target="_blank" rel="noreferrer" className={`script-video ${video.coverTone}`} key={video.id}><span className="video-play">▶</span><strong>{video.title}</strong><small>{video.duration}</small></a> : <div className={`script-video ${video.coverTone}`} key={video.id}><span className="video-play">▶</span><strong>{video.title}</strong><small>{video.duration}</small></div>)}</div> : <div className="no-video"><span>＋</span><small>尚无关联视频</small></div>}</div>
                </article>)}</div>
              </div>;
            })}
          </div>;
        })}
        {loading && <div className="empty-state"><strong>正在读取品牌案例</strong><p>案例较多，请稍候片刻。</p></div>}
        {!loading && loadError && <div className="empty-state"><strong>案例加载失败</strong><p>{loadError}</p></div>}
        {!loading && !loadError && items.length === 0 && <div className="empty-state"><strong>没有匹配的文案</strong><p>换一个关键词，或清除脚本类型与单品筛选。</p></div>}
      </section>
    </div>

    {importOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeImport(); }}><section className="import-modal" role="dialog" aria-modal="true" aria-labelledby="import-title">
      <div className="import-modal-head"><div><span className="eyebrow">SMART IMPORT</span><h2 id="import-title">导入素材</h2></div><button onClick={closeImport} aria-label="关闭">×</button></div>
      <div className="import-steps"><span className={step === "input" ? "active" : "done"}><b>1</b>上传或粘贴</span><i/><span className={step === "confirm" ? "active" : ""}><b>2</b>逐条确认</span></div>
      {step === "input" ? <div className="import-body"><label className="document-drop">批量导入文档<input type="file" multiple accept=".docx,.txt,.md,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(event) => importDocuments(event.target.files)} /><span>选择 DOCX / TXT / MD 文档</span><small>可多选，每份文档自动作为一条素材识别</small></label><label>或粘贴素材文字<textarea value={rawText} onChange={(event) => setRawText(event.target.value)} placeholder={'多条素材请使用 --- 分隔\n作者：达人名或同事名\n脚本类型：剧情脚本\n单品：眼膜\n文案：凌晨一点，她刚结束今天第三场会议……'} /></label><div className="recognize-hint"><span>✦</span><p><strong>系统会自动识别</strong><small>作者、脚本类型、单品、脚本文案和视频链接；识别后逐条确认</small></p></div>{error && <p className="form-error">{error}</p>}<div className="modal-actions"><button className="secondary-btn" onClick={closeImport}>取消</button><button className="primary-btn" onClick={analyze}>识别全部素材 →</button></div></div> : <div className="import-body confirm-body"><div className="recognition-score"><span>✦</span><div><strong>识别到 {recognitions.length} 条素材</strong><small>请逐条检查作者、分类与文案</small></div><Tag tone="success">待确认</Tag></div><div className="recognized-competitor-list">{recognitions.map((recognition,index)=><article key={index}><div className="recognized-item-head"><strong>素材 {String(index+1).padStart(2,"0")}</strong><button onClick={()=>setRecognitions((current)=>current.filter((_,i)=>i!==index))}>移除</button></div><div className="confirm-grid"><label>脚本类型<select value={recognition.scriptType} onChange={(event)=>setRecognitions((current)=>current.map((item,i)=>i===index?{...item,scriptType:event.target.value}:item))}>{SCRIPT_TYPES.map((type)=><option key={type}>{type}</option>)}</select></label><label>单品<select value={recognition.product} onChange={(event)=>setRecognitions((current)=>current.map((item,i)=>i===index?{...item,product:event.target.value}:item))}>{PRODUCTS.map((product)=><option key={product}>{product}</option>)}</select></label><label>作者类型<select value={recognition.authorType} onChange={(event)=>setRecognitions((current)=>current.map((item,i)=>i===index?{...item,authorType:event.target.value}:item))}><option>内部同事</option><option>外部达人</option><option>品牌历史素材</option></select></label><label>作者 / 达人名<input value={recognition.authorName} onChange={(event)=>setRecognitions((current)=>current.map((item,i)=>i===index?{...item,authorName:event.target.value}:item))}/></label></div><label>脚本文案<textarea value={recognition.copy} onChange={(event)=>setRecognitions((current)=>current.map((item,i)=>i===index?{...item,copy:event.target.value}:item))}/></label><label>视频链接<textarea className="video-links-input" value={recognition.videoUrls.join("\n")} onChange={(event)=>setRecognitions((current)=>current.map((item,i)=>i===index?{...item,videoUrls:event.target.value.split(/\n+/).map(v=>v.trim()).filter(Boolean)}:item))}/></label></article>)}</div>{error && <p className="form-error">{error}</p>}<div className="modal-actions"><button className="secondary-btn" onClick={() => { setStep("input"); setError(""); }}>← 返回修改</button><button className="primary-btn" disabled={saving || !recognitions.length} onClick={save}>{saving ? "正在批量入库…" : `确认并存入 ${recognitions.length} 条`}</button></div></div>}
    </section></div>}
    {selectedCase && <CaseDetailModal item={selectedCase} currentUser={currentUser} onClose={()=>setSelectedCase(null)} onChanged={(item)=>{onChanged(item);setSelectedCase(item);}} onDeleted={(id)=>{onDeleted(id);setSelectedCase(null);}} />}
  </div>;
}

function CaseDetailModal({ item, currentUser, onClose, onChanged, onDeleted }: { item: CaseRecord; currentUser: WorkspaceUser | null; onClose: () => void; onChanged: (item: CaseRecord) => void; onDeleted: (id: string) => void }) {
  const [draft, setDraft] = useState(item);
  const [videoUrls, setVideoUrls] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const canDelete = !!currentUser && (currentUser.role === "admin" || [item.uploaderId, item.authorUserId].includes(currentUser.id));
  const save = async () => {
    setBusy("save"); setError("");
    try {
      const response = await fetch(appUrl("/api/cases"), { method:"PATCH", headers:{"content-type":"application/json"}, body:JSON.stringify({...draft, videoUrls:videoUrls.split(/\n+/).map(v=>v.trim()).filter(Boolean)}) });
      const payload = await response.json() as { case?: CaseRecord; error?: string };
      if (!response.ok || !payload.case) throw new Error(payload.error || "保存失败");
      setDraft(payload.case); setVideoUrls(""); onChanged(payload.case);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "保存失败"); }
    finally { setBusy(""); }
  };
  const upload = async (file?: File) => {
    if (!file) return;
    setBusy("upload"); setError("");
    try {
      const form = new FormData(); form.append("file", file); form.append("scriptId", draft.id);
      const response = await fetch(appUrl("/api/media-upload"), { method:"POST", body:form });
      const payload = await response.json() as { video?: CaseVideo; error?: string };
      if (!response.ok || !payload.video) throw new Error(payload.error || "上传失败");
      const changed = {...draft, videos:[...draft.videos, payload.video]}; setDraft(changed); onChanged(changed);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "上传失败"); }
    finally { setBusy(""); }
  };
  const remove = async () => {
    if (!window.confirm(`确定删除“${draft.title}”吗？此操作无法撤销。`)) return;
    setBusy("delete");
    const response = await fetch(appUrl(`/api/cases?id=${encodeURIComponent(draft.id)}`), {method:"DELETE"});
    if (response.ok) onDeleted(draft.id); else setError("删除失败，请稍后重试");
    setBusy("");
  };
  return <div className="modal-backdrop" onMouseDown={(event)=>{if(event.target===event.currentTarget)onClose();}}><section className="import-modal case-detail-modal" role="dialog" aria-modal="true"><div className="import-modal-head"><div><span className="eyebrow">CASE DETAIL</span><h2>查看与编辑案例</h2></div><button onClick={onClose}>×</button></div><div className="import-body"><div className="confirm-grid"><label>脚本类型<select value={draft.scriptType} onChange={(e)=>setDraft({...draft,scriptType:e.target.value})}>{SCRIPT_TYPES.map(type=><option key={type}>{type}</option>)}</select></label><label>单品<select value={draft.product} onChange={(e)=>setDraft({...draft,product:e.target.value})}>{PRODUCTS.map(product=><option key={product}>{product}</option>)}</select></label><label>作者类型<select value={draft.authorType || "历史素材"} onChange={(e)=>setDraft({...draft,authorType:e.target.value})}><option>内部同事</option><option>外部达人</option><option>历史素材</option></select></label><label>作者 / 达人名<input value={draft.authorName || ""} onChange={(e)=>setDraft({...draft,authorName:e.target.value})}/></label></div><div className="case-owner-line">{draft.talentName && <span>合作达人：<b>{draft.talentName}</b></span>}<span>终审人：<b>{draft.finalReviewerName || "—"}</b></span></div><label>标题<input value={draft.title} onChange={(e)=>setDraft({...draft,title:e.target.value})}/></label><label>脚本文案<textarea value={draft.copy} onChange={(e)=>setDraft({...draft,copy:e.target.value})}/></label><label>新增视频链接<textarea value={videoUrls} onChange={(e)=>setVideoUrls(e.target.value)} placeholder="每行一个视频链接"/></label><label className="document-drop">上传关联视频<input type="file" accept="video/mp4,video/quicktime,.mp4,.mov" onChange={(e)=>upload(e.target.files?.[0])}/><span>{busy==="upload"?"正在上传…":"选择 MP4 / MOV 文件"}</span><small>单个视频不超过 200MB</small></label><div className="case-detail-videos">{draft.videos.map(video=><a key={video.id} href={video.url.startsWith("/api/")?appUrl(video.url):video.url} target="_blank" rel="noreferrer"><span>▶</span><strong>{video.title}</strong><small>{video.duration}</small></a>)}</div>{error&&<p className="form-error">{error}</p>}<div className="modal-actions split-actions">{canDelete && <button className="danger-btn" disabled={!!busy} onClick={remove}>删除案例</button>}<a className="secondary-btn export-link" href={appUrl(`/api/cases/${draft.id}/export`)}>导出 Word</a><span/><button className="secondary-btn" onClick={onClose}>关闭</button><button className="primary-btn" disabled={!!busy} onClick={save}>{busy==="save"?"正在保存…":"保存修改"}</button></div></div></section></div>;
}

function recognizeCompetitorBatch(raw: string): CompetitorRecognition[] {
  const normalized = raw.replace(/\r/g, "").trim();
  const explicitBlocks = normalized.split(/\n\s*(?:-{3,}|={3,})\s*\n/g);
  const blocks = explicitBlocks.length > 1
    ? explicitBlocks
    : normalized.split(/\n\s*\n(?=\s*(?:脚本\s*\d+|第[一二三四五六七八九十百]+条|标题|品牌|产品|单品)\s*[:：]?)/g);

  return blocks.map((block, index) => {
    const title = block.match(/(?:标题|脚本名称)\s*[:：]\s*(.+)/)?.[1]?.trim();
    const explicitBrand = block.match(/品牌\s*[:：]\s*(.+)/)?.[1]?.trim();
    const explicitType = block.match(/(?:素材类型|脚本类型|类型)\s*[:：]\s*(.+)/)?.[1]?.trim();
    const markedCopy = block.match(/(?:脚本文案|文案|正文)\s*[:：]\s*([\s\S]+)/)?.[1]?.trim();
    const cleanCopy = (markedCopy ?? block)
      .replace(/^\s*(?:脚本\s*\d+|第[一二三四五六七八九十百]+条)\s*[:：]?\s*/i, "")
      .split("\n")
      .filter((line) => !/^\s*(?:标题|脚本名称|品牌|素材类型|脚本类型|类型|产品|单品)\s*[:：]/.test(line))
      .join("\n")
      .trim();
    const inferredTitle = cleanCopy.split(/[。！？\n]/).find((line) => line.trim())?.trim().slice(0, 28);
    return {
      title: title || inferredTitle || `竞对脚本 ${index + 1}`,
      brand: COMPETITOR_BRANDS.find((brand)=>explicitBrand?.includes(brand) || block.includes(brand)) || COMPETITOR_BRANDS[0],
      scriptType: SCRIPT_TYPES.find((type)=>explicitType?.includes(type) || block.includes(type)) || "自产脚本",
      copy: cleanCopy,
    };
  }).filter((item) => item.copy.length >= 8).slice(0, 100);
}

function CompetitorCasesView({ items, hasMore, onLoadMore, onImported }: {
  items: CompetitorRecord[];
  hasMore: boolean;
  onLoadMore: (items: CompetitorRecord[], hasMore: boolean) => void;
  onImported: (items: CompetitorRecord[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [brandFilter, setBrandFilter] = useState("全部品牌");
  const [typeFilter, setTypeFilter] = useState("全部类型");
  const [importOpen, setImportOpen] = useState(false);
  const [rawText, setRawText] = useState("");
  const [step, setStep] = useState<"input" | "confirm">("input");
  const [recognized, setRecognized] = useState<CompetitorRecognition[]>([]);
  const [saving, setSaving] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const visibleItems = items.filter((item) => `${item.title}${item.brand}${item.scriptType}${item.copy}`.toLowerCase().includes(query.toLowerCase()) && (brandFilter === "全部品牌" || item.brand === brandFilter) && (typeFilter === "全部类型" || item.scriptType === typeFilter));

  const closeImport = () => {
    setImportOpen(false);
    setRawText("");
    setRecognized([]);
    setStep("input");
    setError("");
  };
  const analyze = () => {
    const result = recognizeCompetitorBatch(rawText);
    if (!result.length) { setError("未识别到完整脚本，请检查内容或使用 --- 分隔多条脚本"); return; }
    setRecognized(result);
    setStep("confirm");
    setError("");
  };
  const updateItem = (index: number, patch: Partial<CompetitorRecognition>) => {
    setRecognized((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  };
  const removeItem = (index: number) => setRecognized((current) => current.filter((_, itemIndex) => itemIndex !== index));
  const save = async () => {
    if (!recognized.length || recognized.some((item) => item.copy.trim().length < 8)) { setError("请确认每条脚本都包含完整文案"); return; }
    setSaving(true); setError("");
    try {
      const response = await fetch(appUrl("/api/competitor-cases"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items: recognized }) });
      const payload = await response.json() as { scripts?: CompetitorRecord[]; error?: string };
      if (!response.ok || !payload.scripts) throw new Error(payload.error || "批量导入失败");
      onImported(payload.scripts);
      closeImport();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "批量导入失败，请稍后重试");
    } finally { setSaving(false); }
  };
  const loadMore = async () => {
    setLoadingMore(true); setError("");
    try {
      const response = await fetch(appUrl(`/api/competitor-cases?limit=100&offset=${items.length}`));
      const payload = await response.json() as { scripts?: CompetitorRecord[]; hasMore?: boolean; error?: string };
      if (!response.ok || !payload.scripts) throw new Error(payload.error || "加载失败");
      onLoadMore(payload.scripts, !!payload.hasMore);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "加载失败，请稍后重试");
    } finally { setLoadingMore(false); }
  };

  return <div className="page competitor-page">
    <PageHeading eyebrow="COMPETITOR SCRIPT ARCHIVE" title="竞对案例库" copy="按品牌与素材类型沉淀竞对脚本，支持批量识别、逐条确认和持久化入库。" action={<button className="primary-btn" onClick={() => setImportOpen(true)}>＋ 批量导入竞对脚本</button>} />
    <div className="competitor-toolbar">
      <label><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、品牌、素材类型或脚本文案" /></label>
      <span>共 {visibleItems.length} 条竞对脚本</span>
    </div>
    <div className="competitor-filters"><div><span>品牌</span><select value={brandFilter} onChange={(e)=>setBrandFilter(e.target.value)}><option>全部品牌</option>{COMPETITOR_BRANDS.map(brand=><option key={brand}>{brand}</option>)}</select></div><div><span>素材类型</span><select value={typeFilter} onChange={(e)=>setTypeFilter(e.target.value)}><option>全部类型</option>{SCRIPT_TYPES.map(type=><option key={type}>{type}</option>)}</select></div></div>
    <section className="competitor-list">
      {visibleItems.map((item, index) => <article className="competitor-card" key={item.id}>
        <div className="competitor-index">{String(index + 1).padStart(3, "0")}</div>
        <div className="competitor-copy"><div className="copy-meta"><span>{item.id}</span><Tag>{item.brand}</Tag><Tag>{item.scriptType}</Tag><Tag tone="warning">{item.source}</Tag></div><h3>{item.title}</h3><details><summary>{item.copy}</summary><p>{item.copy}</p></details></div>
      </article>)}
      {!visibleItems.length && <div className="empty-state"><strong>{items.length ? "没有匹配的竞对脚本" : "竞对案例库还是空的"}</strong><p>{items.length ? "换一个关键词继续搜索。" : "点击右上角按钮，可一次粘贴并导入多条竞对脚本。"}</p></div>}
      {hasMore && !query && <button className="secondary-btn competitor-load-more" disabled={loadingMore} onClick={loadMore}>{loadingMore ? "正在加载…" : "加载更多竞对脚本"}</button>}
    </section>

    {importOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeImport(); }}><section className="import-modal competitor-import-modal" role="dialog" aria-modal="true" aria-labelledby="competitor-import-title">
      <div className="import-modal-head"><div><span className="eyebrow">BATCH RECOGNITION</span><h2 id="competitor-import-title">批量导入竞对脚本</h2></div><button onClick={closeImport} aria-label="关闭">×</button></div>
      <div className="import-steps"><span className={step === "input" ? "active" : "done"}><b>1</b>批量粘贴</span><i/><span className={step === "confirm" ? "active" : ""}><b>2</b>逐条确认</span></div>
      {step === "input" ? <div className="import-body"><label>竞对脚本文字<textarea value={rawText} onChange={(event) => setRawText(event.target.value)} placeholder={'一次粘贴多条脚本，建议使用 --- 分隔，例如：\n标题：通勤补妆实测\n品牌：谷雨\n素材类型：唠嗑KOC脚本\n文案：姐妹们，我最近一直在用……'} autoFocus /></label><div className="recognize-hint"><span>✦</span><p><strong>自动拆分并识别</strong><small>系统会提取标题、品牌、素材类型和完整文案；单次最多确认 100 条</small></p></div>{error && <p className="form-error">{error}</p>}<div className="modal-actions"><button className="secondary-btn" onClick={closeImport}>取消</button><button className="primary-btn" onClick={analyze}>识别全部脚本 →</button></div></div> : <div className="import-body competitor-confirm-body"><div className="recognition-score"><span>✦</span><div><strong>识别到 {recognized.length} 条竞对脚本</strong><small>请逐条检查；不需要的条目可以移除</small></div><Tag tone="success">待确认</Tag></div><div className="recognized-competitor-list">{recognized.map((item, index) => <article key={`${index}-${item.title}`}><div className="recognized-item-head"><strong>脚本 {String(index + 1).padStart(2, "0")}</strong><button onClick={() => removeItem(index)}>移除</button></div><div className="confirm-grid"><label>标题<input value={item.title} onChange={(event) => updateItem(index, { title: event.target.value })} /></label><label>品牌<select value={item.brand} onChange={(event) => updateItem(index, { brand: event.target.value })}>{COMPETITOR_BRANDS.map(brand=><option key={brand}>{brand}</option>)}</select></label></div><label>素材类型<select value={item.scriptType} onChange={(event) => updateItem(index, { scriptType: event.target.value })}>{SCRIPT_TYPES.map(type=><option key={type}>{type}</option>)}</select></label><label>脚本文案<textarea value={item.copy} onChange={(event) => updateItem(index, { copy: event.target.value })} /></label></article>)}</div>{error && <p className="form-error">{error}</p>}<div className="modal-actions"><button className="secondary-btn" onClick={() => { setStep("input"); setError(""); }}>← 返回原文</button><button className="primary-btn" disabled={saving || !recognized.length} onClick={save}>{saving ? "正在批量入库…" : `确认并存入 ${recognized.length} 条`}</button></div></div>}
    </section></div>}
  </div>;
}

function PersonCombobox({ label, users, value, onChange, placeholder }: { label: string; users: WorkspaceUser[]; value: string; onChange: (id: string) => void; placeholder: string }) {
  const selected = users.find((user) => user.id === value);
  const [query, setQuery] = useState(selected?.name ?? "");
  const [open, setOpen] = useState(false);
  const matches = query.trim() ? users.filter((user) => user.name.includes(query.trim())).slice(0, 8) : [];
  const displayValue = selected ? selected.name : query;
  return <label className="person-combobox">{label}<div><input value={displayValue} placeholder={placeholder} autoComplete="off" onFocus={() => setOpen(true)} onBlur={() => window.setTimeout(() => setOpen(false), 120)} onChange={(event) => { setQuery(event.target.value); onChange(""); setOpen(true); }} />{selected && <button type="button" aria-label={`清除${label}`} onClick={() => { onChange(""); setQuery(""); }}>×</button>}{open && query.trim() && <span className="person-options">{matches.map((user) => <button type="button" key={user.id} onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(user.id); setQuery(""); setOpen(false); }}><b>{user.name}</b><small>{user.department || "品牌营销部"}</small></button>)}{matches.length === 0 && <em>未找到匹配同事</em>}</span>}</div></label>;
}

function DailyScriptsView({ users, currentUser, onSubmitted }: { users: WorkspaceUser[]; currentUser: WorkspaceUser | null; onSubmitted: (draft: DraftRecord) => void }) {
  const [form, setForm] = useState({ title: "", talentName: "", scriptType: SCRIPT_TYPES[0] as string, product: PRODUCTS[0] as string, content: "", authorUserId: currentUser?.id ?? "", teamLeadReviewerId: "", supervisorReviewerId: "", priority: "普通", dueDate: "", videoUrls: "" });
  const [videoFiles, setVideoFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const effectiveAuthorUserId = form.authorUserId || currentUser?.id || "";
  const loadDocument = async (file?: File) => {
    if (!file) return;
    try { const content = await extractDocument(file); setForm((current) => ({ ...current, title: current.title || file.name.replace(/\.[^.]+$/, ""), content })); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "文档读取失败"); }
  };
  const submit = async () => {
    setBusy(true); setError("");
    try {
      const response = await fetch(appUrl("/api/daily-scripts"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...form, authorUserId: effectiveAuthorUserId, videoUrls: form.videoUrls.split(/\n+/).map((url) => url.trim()).filter(Boolean) }) });
      const payload = await response.json() as { draft?: DraftRecord; error?: string };
      if (!response.ok || !payload.draft) throw new Error(payload.error || "提交失败");
      for (const file of videoFiles) {
        const body = new FormData(); body.append("file", file); body.append("draftId", payload.draft.id);
        const upload = await fetch(appUrl("/api/draft-media"), { method: "POST", body });
        if (!upload.ok) { const result = await upload.json() as { error?: string }; throw new Error(result.error || `${file.name} 上传失败`); }
      }
      onSubmitted(payload.draft);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "提交失败"); }
    finally { setBusy(false); }
  };
  return <div className="page daily-page"><PageHeading eyebrow="DAILY SCRIPT DESK" title="日常脚本创作" copy="写稿、上传、指定审核路径，在同一个工作区完成日常脚本提交。" />
    <section className="daily-editor panel"><header><div><span className="eyebrow">NEW SUBMISSION</span><h2>提交一条新脚本</h2><p>脚本会先推送给组长审核，再进入主管终审；通过后自动归档到品牌案例库。</p></div><Tag tone="glow-dark">三级流转</Tag></header>
      <div className="daily-form-grid"><label>脚本名称<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="清晰描述脚本主题" /></label><label>合作达人<input value={form.talentName} onChange={(e) => setForm({ ...form, talentName: e.target.value })} placeholder="填写达人昵称，暂无可留空" /></label><label>脚本类型<select value={form.scriptType} onChange={(e) => setForm({ ...form, scriptType: e.target.value })}>{SCRIPT_TYPES.map((value) => <option key={value}>{value}</option>)}</select></label><label>单品<select value={form.product} onChange={(e) => setForm({ ...form, product: e.target.value })}>{PRODUCTS.map((value) => <option key={value}>{value}</option>)}</select></label><PersonCombobox label="作者" users={users} value={effectiveAuthorUserId} onChange={(value) => setForm({ ...form, authorUserId: value })} placeholder="输入姓名搜索" /><PersonCombobox label="组长审核人" users={users} value={form.teamLeadReviewerId} onChange={(value) => setForm({ ...form, teamLeadReviewerId: value })} placeholder="输入姓名搜索" /><PersonCombobox label="主管审核人" users={users} value={form.supervisorReviewerId} onChange={(value) => setForm({ ...form, supervisorReviewerId: value })} placeholder="输入姓名搜索" /><label>优先级<select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}><option>紧急</option><option>普通</option><option>低</option></select></label><label>期望完成<input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></label></div>
      <label className="daily-content">脚本文案<textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder="在这里撰写脚本，或从下方上传 DOCX / TXT / MD 文档…" /><small>{form.content.replace(/\s/g, "").length} 字</small></label>
      <div className="daily-attachments"><label className="document-drop">上传脚本文档<input type="file" accept=".docx,.txt,.md,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(e) => loadDocument(e.target.files?.[0])} /><span>选择 DOCX / TXT / MD</span><small>文档内容会自动填入编辑区</small></label><label className="document-drop">上传关联视频<input type="file" multiple accept="video/mp4,video/quicktime,.mp4,.mov" onChange={(e) => setVideoFiles(Array.from(e.target.files ?? []))} /><span>{videoFiles.length ? `已选择 ${videoFiles.length} 个视频` : "选择 MP4 / MOV"}</span><small>单个文件不超过 200MB</small></label><label>视频链接<textarea value={form.videoUrls} onChange={(e) => setForm({ ...form, videoUrls: e.target.value })} placeholder="每行一个视频链接" /></label></div>
      {error && <p className="form-error">{error}</p>}<footer><span>提交后可在“审核与反馈”中查看版本和处理进度。</span><button className="primary-btn" disabled={busy} onClick={submit}>{busy ? "正在提交…" : "提交组长审核 →"}</button></footer>
    </section>
  </div>;
}

function ScriptsView({ cases, users, currentUser, onSubmitted, showToast }: { cases: CaseRecord[]; users: WorkspaceUser[]; currentUser: WorkspaceUser | null; onSubmitted: (draft: DraftRecord) => void; showToast: (title: string, detail: string) => void }) {
  const styles = [...SCRIPT_TYPES];
  const [product, setProduct] = useState("眼膜");
  const [scriptType, setScriptType] = useState("付费KOC脚本");
  const [audience, setAudience] = useState("30+熟龄女性，重点覆盖40+资深中产、都市银发和小镇中老年女性");
  const [requirements, setRequirements] = useState("多打抗老、容貌焦虑和显年轻；口播自然，突出肤感、状态变化、价格机制与促单，不写研发说明书。");
  const [templateSearch, setTemplateSearch] = useState("");
  const [templateId, setTemplateId] = useState(cases[0]?.id ?? "");
  const [drafts, setDrafts] = useState<DraftRecord[]>([]);
  const [analysis, setAnalysis] = useState("");
  const [phase, setPhase] = useState<"idle" | "analyzing" | "creating">("idle");
  const [regeneratingId, setRegeneratingId] = useState("");
  const [error, setError] = useState("");
  const [authorType, setAuthorType] = useState("内部同事");
  const [authorName, setAuthorName] = useState("");
  const [authorUserId, setAuthorUserId] = useState(currentUser?.id ?? "");
  const [teamLeadReviewerId, setTeamLeadReviewerId] = useState("");
  const [supervisorReviewerId, setSupervisorReviewerId] = useState("");
  const [priority, setPriority] = useState("普通");
  const [dueDate, setDueDate] = useState("");
  const effectiveAuthorName = authorType === "内部同事" ? (users.find((user) => user.id === authorUserId)?.name || currentUser?.name || "") : authorName;
  const effectiveTeamLeadId = teamLeadReviewerId;
  const effectiveSupervisorId = supervisorReviewerId;
  const teamLeadReviewers = users;
  const supervisorReviewers = users;
  const selected = cases.find((item) => item.id === templateId) ?? cases[0];
  const matchedCases = cases.filter((item) => `${item.title}${item.copy}${item.product}${item.scriptType}`.toLowerCase().includes(templateSearch.toLowerCase())).slice(0, 20);

  const generate = async (count = 1, replaceId = "") => {
    if (!selected) { setError("品牌案例库中暂无可选脚本，请先导入案例"); return; }
    setError(""); setRegeneratingId(replaceId); setPhase("analyzing"); setAnalysis("正在读取参考脚本全文，并逐条核对补充需求…");
    window.setTimeout(() => setPhase((current) => current === "analyzing" ? "creating" : current), 450);
    try {
      const response = await fetch(appUrl("/api/scripts"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ product, scriptType, templateId: selected.id, templateTitle: selected.title, templateCopy: selected.copy, requirements, audience, count, generationKey: crypto.randomUUID() }) });
      const payload = await response.json() as { analysis?: string; drafts?: DraftRecord[]; error?: string };
      if (!response.ok || !payload.drafts) throw new Error(payload.error || "生成失败");
      setDrafts((current) => replaceId ? current.map((item) => item.id === replaceId ? payload.drafts![0] : item) : payload.drafts!); setAnalysis(payload.analysis ?? "创作完成");
      showToast(replaceId ? "已换成全新脚本" : `已生成 ${payload.drafts.length} 个新版本`, "参考脚本与补充需求均已写入本轮创作依据");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "生成失败"); }
    finally { setPhase("idle"); setRegeneratingId(""); }
  };

  const patchDraft = async (draft: DraftRecord, action: "save" | "submit") => {
    setError("");
    if (action === "submit" && (!effectiveTeamLeadId || !effectiveSupervisorId)) {
      setError("送审前，请明确选择具体的组长审核人和主管审核人");
      return;
    }
    try {
      const response = await fetch(appUrl(`/api/scripts/${draft.id}`), { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, title: draft.title, content: draft.content, authorType, authorName: effectiveAuthorName, authorUserId: authorType === "内部同事" ? authorUserId : "", teamLeadReviewerId: effectiveTeamLeadId, supervisorReviewerId: effectiveSupervisorId, priority, dueDate }) });
      const payload = await response.json() as { draft?: DraftRecord; error?: string };
      if (!response.ok || !payload.draft) throw new Error(payload.error || "保存失败");
      setDrafts((current) => current.map((item) => item.id === draft.id ? payload.draft! : item));
      if (action === "submit") onSubmitted(payload.draft); else showToast("修改已保存", draft.title);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "保存失败"); }
  };

  return <div className="page"><PageHeading eyebrow="AI SCRIPT CREATION" title="AI 脚本创作" copy="读取所选案例的完整内容，再把补充需求作为硬约束，生成可编辑、可单独重做的候选脚本。" />
    <div className="studio-grid"><section className="generator-panel panel"><div className="panel-head"><div><span className="eyebrow">CREATIVE BRIEF</span><h3>创作任务</h3></div><Tag tone="glow-dark">案例库已连接</Tag></div>
      <label>产品<select value={product} onChange={(event) => setProduct(event.target.value)}>{PRODUCTS.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label>目标风格<select value={scriptType} onChange={(event) => setScriptType(event.target.value)}>{styles.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label>核心人群<input value={audience} onChange={(event) => setAudience(event.target.value)} placeholder="例如：40+熟龄女性、都市银发、小镇中老年" /></label>
      <label>搜索案例库脚本<input className="template-search" value={templateSearch} onChange={(event) => setTemplateSearch(event.target.value)} placeholder="按标题、文案、产品或类型搜索" /></label>
      <div className="template-picker">{matchedCases.map((item) => <button type="button" className={selected?.id === item.id ? "active" : ""} onClick={() => setTemplateId(item.id)} key={item.id}><span><b>{item.title}</b><small>{item.scriptType} · {item.product}</small></span><i>{selected?.id === item.id ? "✓" : ""}</i></button>)}{matchedCases.length === 0 && <p>没有匹配脚本</p>}</div>
      <label>补充需求<textarea value={requirements} onChange={(event) => setRequirements(event.target.value)} placeholder="自由输入创作要求，例如容貌痛点、达人语气、价格机制、肤感或指定钩子" /><small>普通脚本默认纯口播约300字，合适区间260—340字；镜头说明不计入。</small></label>
      {selected && <div className="reference-box"><span>▦</span><div><strong>已选：{selected.title}</strong><small>{selected.scriptType} · {selected.product} · {selected.copy.slice(0, 34)}…</small></div></div>}
      <div className="workflow-config"><span className="eyebrow">REVIEW ROUTING</span><h4>作者与审核路径</h4><div className="confirm-grid"><label>作者类型<select value={authorType} onChange={(event)=>setAuthorType(event.target.value)}><option>内部同事</option><option>外部达人</option></select></label>{authorType === "内部同事" ? <PersonCombobox label="作者" users={users} value={authorUserId} onChange={setAuthorUserId} placeholder="输入姓名搜索" /> : <label>作者 / 达人名<input value={authorName} onChange={(event)=>setAuthorName(event.target.value)} placeholder="填写实际作者" /></label>}<PersonCombobox label="组长审核人" users={teamLeadReviewers} value={effectiveTeamLeadId} onChange={setTeamLeadReviewerId} placeholder="输入姓名搜索" /><PersonCombobox label="主管审核人" users={supervisorReviewers} value={effectiveSupervisorId} onChange={setSupervisorReviewerId} placeholder="输入姓名搜索" /><label>优先级<select value={priority} onChange={(event)=>setPriority(event.target.value)}><option>普通</option><option>紧急</option><option>低</option></select></label><label>期望完成<input type="date" value={dueDate} onChange={(event)=>setDueDate(event.target.value)} /></label></div><small>必须明确选择组长与主管；送审后按“组长审核 → 主管终审 → 品牌案例库”推进。</small></div>
      {error && <p className="form-error">{error}</p>}<div className="generation-buttons"><button className="primary-btn full" type="button" disabled={phase !== "idle"} onClick={() => generate(1)}>✦ {phase === "analyzing" ? "正在分析参考脚本…" : phase === "creating" ? "正在创作新脚本…" : "生成 1 个脚本"}</button><button className="secondary-btn full" type="button" disabled={phase !== "idle"} onClick={() => generate(3)}>一次生成 3 个</button></div>
    </section>
    <section className="script-results"><div className="result-head"><div><span className="eyebrow">OUTPUT</span><h3>{drafts.length ? `${drafts.length} 个候选版本` : "等待生成"}</h3></div>{drafts.length > 0 && <button className="secondary-btn" disabled={phase !== "idle"} onClick={() => generate(drafts.length)}>↻ 全部重新生成</button>}</div>{analysis && <div className="creation-analysis"><span>✦</span><p><strong>创作要求分析</strong>{analysis}</p></div>}{drafts.length === 0 ? <div className="generation-empty"><div>✦</div><strong>让案例成为下一条好脚本</strong><p>系统会读取参考脚本全文，并把补充需求逐条落实到新稿中。默认先生成一条，需要比较时也可以一次生成三条。</p></div> : <div className="draft-stack">{drafts.map((draft, index) => <article className="draft-card" key={draft.id}><div className="draft-card-head"><span className="script-version">{String.fromCharCode(65 + index)}</span><div><small>{draft.id} · v{draft.version}</small><Tag>{draft.scriptType}</Tag></div></div><input className="draft-title-input" value={draft.title} onChange={(event) => setDrafts((current) => current.map((item) => item.id === draft.id ? { ...item, title: event.target.value } : item))} /><textarea className="draft-content-input" value={draft.content} onChange={(event) => setDrafts((current) => current.map((item) => item.id === draft.id ? { ...item, content: event.target.value } : item))} /><div className="draft-actions"><button className="regenerate-btn" disabled={phase !== "idle"} onClick={() => generate(1, draft.id)}>↻ {regeneratingId === draft.id ? "正在重写…" : "重新生成此版本"}</button><button className="secondary-btn" onClick={() => patchDraft(draft, "save")}>保存修改</button><button className="primary-btn" onClick={() => patchDraft(draft, "submit")}>确定并送审 →</button></div></article>)}</div>}</section></div>
  </div>;
}

function ReviewView({ items, currentUser, onUpdate, onDeleted, onApproved, showToast }: { items: DraftRecord[]; currentUser: WorkspaceUser | null; onUpdate: (draft: DraftRecord) => void; onDeleted: (id: string) => void; onApproved: (draft: DraftRecord, caseItem: CaseRecord) => void; showToast: (title: string, detail: string) => void }) {
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "approved">("all");
  const [visibleCount, setVisibleCount] = useState(8);
  const activeItems = items.filter((item) => item.status !== "approved");
  const assigned = activeItems.filter((item) => item.currentReviewerId === currentUser?.id);
  const filteredItems = statusFilter === "active" ? activeItems : statusFilter === "approved" ? items.filter((item) => item.status === "approved") : items;
  const visibleItems = filteredItems.slice(0, visibleCount);
  return <div className="page"><PageHeading eyebrow="HUMAN IN THE LOOP" title="审核与反馈" copy="脚本按作者、组长审核与主管终审流转；每次修改留有版本，终审通过后自动归档。" />
    <div className="review-summary"><span><b>{assigned.length}</b><small>分配给我</small></span><span><b>{activeItems.filter((item) => item.status === "pending_team_lead").length}</b><small>组长审核</small></span><span><b>{activeItems.filter((item) => item.status === "pending_supervisor").length}</b><small>主管终审</small></span><span><b>{activeItems.filter((item) => item.status === "returned_to_creator").length}</b><small>退回修改</small></span></div>
    <section className="review-workspace"><div className="review-queue-head"><div><span className="eyebrow">REVIEW QUEUE</span><h3>脚本与审核任务</h3></div><Tag>{items.length} 条脚本</Tag></div><div className="review-filters"><button className={statusFilter === "all" ? "active" : ""} onClick={() => { setStatusFilter("all"); setVisibleCount(8); }}>全部 {items.length}</button><button className={statusFilter === "active" ? "active" : ""} onClick={() => { setStatusFilter("active"); setVisibleCount(8); }}>进行中 {activeItems.length}</button><button className={statusFilter === "approved" ? "active" : ""} onClick={() => { setStatusFilter("approved"); setVisibleCount(8); }}>已归档 {items.length - activeItems.length}</button></div>{filteredItems.length === 0 ? <div className="generation-empty review-empty"><div>✓</div><strong>当前没有匹配脚本</strong><p>新的脚本与审核任务会自动出现在这里。</p></div> : <><div className="review-card-list">{visibleItems.map((item) => <ReviewCard key={`${item.id}-${item.version}-${item.status}`} item={item} currentUser={currentUser} onUpdate={onUpdate} onDeleted={onDeleted} onApproved={onApproved} showToast={showToast} />)}</div>{visibleItems.length < filteredItems.length && <button className="load-more-btn" onClick={() => setVisibleCount((count) => count + 8)}>继续加载（还有 {filteredItems.length - visibleItems.length} 条）</button>}</>}</section>
  </div>;
}

function ReviewCard({ item, currentUser, onUpdate, onDeleted, onApproved, showToast }: { item: DraftRecord; currentUser: WorkspaceUser | null; onUpdate: (draft: DraftRecord) => void; onDeleted: (id: string) => void; onApproved: (draft: DraftRecord, caseItem: CaseRecord) => void; showToast: (title: string, detail: string) => void }) {
  const [draft, setDraft] = useState(item);
  const [notificationChatId, setNotificationChatId] = useState("");
  const [notificationChats, setNotificationChats] = useState<string[]>([]);
  const [chatOptionsError, setChatOptionsError] = useState("");
  useEffect(() => {
    if (item.status !== "pending_supervisor") return;
    const controller = new AbortController();
    fetch(appUrl("/api/scripts/notification-chats"), {signal: controller.signal})
      .then(async response => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "群聊选项读取失败"); return payload; })
      .then(payload => {setNotificationChats(payload.chatIds ?? []); setChatOptionsError("");})
      .catch(error => {if (error.name !== "AbortError") setChatOptionsError("历史群聊暂未加载，可直接填写群聊 ID");});
    return () => controller.abort();
  }, [item.status]);
  const [feedback, setFeedback] = useState(item.feedback ?? "");
  const [alternatives, setAlternatives] = useState<ScriptAlternative[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [history, setHistory] = useState<{ versions: Array<{id:string;version:number;title:string;content:string;editorName:string;reason:string;createdAt:string}>; actions: Array<{id:string;actorName:string;action:string;stage:string;comment:string;createdAt:string}>; alternatives: ScriptAlternative[] } | null>(null);
  const act = async (action: "save" | "regenerate" | "resubmit" | "team_lead_approve" | "supervisor_approve" | "reject" | "adopt_alternative", alternativeId = "") => {
    setBusy(action); setError("");
    try {
      const response = await fetch(appUrl(`/api/scripts/${draft.id}`), { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, title: draft.title, content: draft.content, feedback, alternativeId, notificationChatId: action === "supervisor_approve" ? notificationChatId.trim() : undefined }) });
      const payload = await response.json() as { draft?: DraftRecord; case?: CaseRecord; alternative?: ScriptAlternative; error?: string };
      if (!response.ok || !payload.draft) throw new Error(payload.error || "操作失败");
      if (action === "supervisor_approve" && payload.case) { onApproved(payload.draft, payload.case); setDraft(payload.draft); if (notificationChatId.trim()) showToast("主管终审通过", "完整脚本已加入飞书群通知队列"); return; }
      if (action === "regenerate" && payload.alternative) {
        setAlternatives((current) => [payload.alternative!, ...current]);
        showToast("AI 新稿已单独生成", "原稿没有被覆盖，可对照后再决定是否采用");
        return;
      }
      setDraft(payload.draft); onUpdate(payload.draft);
      if (action === "adopt_alternative") setAlternatives((current) => current.map((item) => item.id === alternativeId ? { ...item, adopted: true } : item));
      const actionNames: Record<string,string> = { adopt_alternative:`已采用为 v${payload.draft.version}`, team_lead_approve:"组长审核已通过", reject:"已退回修改", resubmit:"已重新送审", save:"修改已保存" };
      showToast(actionNames[action] || "操作已完成", payload.draft.title);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "操作失败"); }
    finally { setBusy(""); }
  };
  const statusMap: Record<string,string> = { generated:"创作草稿", pending_review:"历史待审核", pending_team_lead:"组长审核", pending_supervisor:"主管终审", returned_to_creator:"退回修改", approved:"已归档" };
  const admin = currentUser?.role === "admin";
  const reviewer = !!currentUser && (draft.currentReviewerId === currentUser.id || admin);
  const editor = !!currentUser && ([draft.creatorId,draft.uploaderId,draft.authorUserId].includes(currentUser.id) || admin);
  const canDelete = editor;
  const removeDraft = async () => {
    if (!window.confirm(`确定删除“${draft.title}”吗？相关审核记录也会一并删除。`)) return;
    setBusy("delete"); setError("");
    try {
      const response = await fetch(appUrl(`/api/scripts/${draft.id}`), { method: "DELETE" });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "删除失败");
      onDeleted(draft.id); showToast("脚本已删除", draft.title);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "删除失败"); }
    finally { setBusy(""); }
  };
  const loadHistory = async()=>{ if(history){setHistory(null);return;} const response=await fetch(appUrl(`/api/scripts/${draft.id}/history`)); const payload=await response.json(); if(response.ok){setHistory(payload);setAlternatives(payload.alternatives??[]);} else setError(payload.error||"历史记录读取失败"); };
  let videos: string[] = []; try { videos = JSON.parse(draft.videoLinks || "[]"); } catch { videos = []; }
  return <article className="review-card"><div className="review-card-head"><div><div className="review-id"><span>{draft.id}</span><Tag tone={draft.status === "returned_to_creator" ? "danger" : "warning"}>{statusMap[draft.status] || draft.status}</Tag><Tag>v{draft.version}</Tag><Tag>{draft.priority || "普通"}</Tag></div><input value={draft.title} disabled={!editor && !reviewer} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></div><div className="review-product"><strong>{draft.product}</strong><small>{draft.scriptType}</small></div></div><div className="workflow-route"><span><small>作者</small><b>{draft.authorName || "待补充"}</b></span><i>→</i><span><small>组长审核</small><b>{draft.teamLeadReviewerName || "待分配"}</b></span><i>→</i><span><small>主管终审</small><b>{draft.supervisorReviewerName || "待分配"}</b></span><i>→</i><span><small>归档</small><b>品牌案例库</b></span></div><div className="review-context">{draft.talentName && <span>合作达人：<b>{draft.talentName}</b></span>}<span>当前处理人：<b>{draft.currentReviewerId === currentUser?.id ? "我" : draft.status === "pending_team_lead" ? draft.teamLeadReviewerName : draft.status === "pending_supervisor" ? draft.supervisorReviewerName : draft.creatorName}</b></span><span>截止：<b>{draft.dueDate || "未设置"}</b></span></div><div className="revision-compare"><section><span className="eyebrow">CURRENT VERSION · V{draft.version}</span><h4>当前审核稿</h4><textarea className="review-content" value={draft.content} disabled={!editor && !reviewer} onChange={(event) => setDraft({ ...draft, content: event.target.value })} />{videos.length > 0 && <div className="draft-media-links">{videos.map((url,index)=><a href={url.startsWith("/api/")?appUrl(url):url} key={url} target="_blank" rel="noreferrer">▶ 关联视频 {index+1}</a>)}</div>}</section>{alternatives.filter((entry)=>!entry.adopted).map((entry)=><section className="alternative-draft" key={entry.id}><span className="eyebrow">AI REVISION · NEW</span><h4>AI 新稿（未覆盖原稿）</h4><p className="alternative-request">修改要求：{entry.request}</p><pre>{entry.content}</pre><div><button className="primary-btn" disabled={!!busy} onClick={()=>act("adopt_alternative",entry.id)}>采用这版作为新版本</button></div></section>)}</div><div className="feedback-box"><label>审核意见 / AI 修改要求<textarea value={feedback} onChange={(event) => setFeedback(event.target.value)} placeholder="写清需要调整的开头、口语感、卖点、价格机制或促单方向。" /></label>{(editor || reviewer) && <button className="ai-revise-btn" disabled={!!busy} onClick={() => act("regenerate")}>✦ {busy === "regenerate" ? "正在按意见生成另一版…" : "AI 按意见生成新稿"}</button>}</div>{draft.status === "pending_supervisor" && reviewer && <div className="workflow-config"><label htmlFor={`notify-chat-${draft.id}`}>终审通过后通知飞书群（可选）</label><input id={`notify-chat-${draft.id}`} list={`notify-chat-options-${draft.id}`} value={notificationChatId} onChange={event => setNotificationChatId(event.target.value)} disabled={!!busy} placeholder="输入或选择群聊 ID，例如 oc_…" autoComplete="off" /><datalist id={`notify-chat-options-${draft.id}`}>{notificationChats.map(chatId => <option key={chatId} value={chatId} />)}</datalist><small>留空则不发送到群。填写后将在终审通过时发送完整脚本卡片，并保存为下次可选项。请确认通知机器人已加入该群。</small>{chatOptionsError && <p role="status">{chatOptionsError}</p>}</div>}{error && <p className="form-error">{error}</p>}<div className="review-actions">{canDelete && <button className="danger-btn" disabled={!!busy} onClick={removeDraft}>{busy === "delete" ? "正在删除…" : "删除脚本"}</button>}<button className="history-btn" onClick={loadHistory}>{history ? "收起记录" : "查看版本与审核记录"}</button><span/><>{editor && <button className="secondary-btn" disabled={!!busy} onClick={() => act("save")}>保存当前稿</button>}{draft.status === "returned_to_creator" && editor && <button className="primary-btn" disabled={!!busy} onClick={() => act("resubmit")}>修改完成，重新送审 →</button>}{["pending_team_lead","pending_supervisor"].includes(draft.status) && reviewer && <button className="secondary-btn" disabled={!!busy} onClick={() => act("reject")}>退回修改</button>}{draft.status === "pending_team_lead" && reviewer && <button className="approve-btn large" disabled={!!busy} onClick={() => act("team_lead_approve")}>组长审核通过 →</button>}{draft.status === "pending_supervisor" && reviewer && <button className="approve-btn large" disabled={!!busy} onClick={() => act("supervisor_approve")}>主管终审并归档 ✓</button>}</></div>{history && <div className="history-panel"><div><h4>历史版本（全文）</h4>{history.versions.map((entry)=><article className="history-entry" key={entry.id}><header><b>v{entry.version} · {entry.title}</b><time>{entry.editorName} · {entry.createdAt}</time></header><p>{entry.reason}</p><pre>{entry.content}</pre></article>)}</div><div><h4>审核意见与修改要求</h4>{history.actions.map((entry)=><article className="history-entry action-entry" key={entry.id}><header><b>{entry.actorName} · {entry.action}</b><time>{entry.createdAt}</time></header><p>{entry.comment || "无补充意见"}</p></article>)}</div></div>}</article>;
}

function CollaborationsView() {
  const stages = ["待建联","已寄样","脚本确认","拍摄中","待发布","已完成"];
  const [items,setItems]=useState<CollaborationRecord[]>([]);
  const [form,setForm]=useState({creatorName:"",platform:"抖音",product:"眼膜",owner:"",stage:"待建联",dueDate:"",note:""});
  const [batchOpen,setBatchOpen]=useState(false);
  const [batchText,setBatchText]=useState("");
  const [batchPreview,setBatchPreview]=useState<Array<Omit<CollaborationRecord,"id"|"updatedAt">>>([]);
  const [error,setError]=useState(""); const [saving,setSaving]=useState(false);
  useEffect(()=>{fetch(appUrl("/api/collaborations")).then(r=>r.ok?r.json():Promise.reject()).then((p:{items?:CollaborationRecord[]})=>setItems(p.items??[])).catch(()=>setError("合作进度暂时无法读取"));},[]);
  const create=async()=>{if(!form.creatorName.trim()){setError("请填写达人名称");return;}setSaving(true);setError("");try{const r=await fetch(appUrl("/api/collaborations"),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(form)});const p=await r.json() as {item?:CollaborationRecord;error?:string};if(!r.ok||!p.item)throw new Error(p.error||"创建失败");setItems(c=>[p.item!,...c]);setForm({...form,creatorName:"",owner:"",dueDate:"",note:""});}catch(reason){setError(reason instanceof Error?reason.message:"创建失败");}finally{setSaving(false);}};
  const recognizeBatch=()=>{const rows=batchText.split(/\n+/).map(line=>line.trim()).filter(Boolean).map(line=>{const [creatorName,platform="抖音",product="眼膜",owner="待分配",stage="待建联",dueDate="",...notes]=line.split(/\t|\||，|,/).map(value=>value.trim());return {creatorName,platform,product,owner,stage:stages.includes(stage)?stage:"待建联",dueDate,note:notes.join("，")};}).filter(row=>row.creatorName);if(!rows.length){setError("请至少粘贴一条达人合作任务");return;}setError("");setBatchPreview(rows.slice(0,100));};
  const saveBatch=async()=>{if(!batchPreview.length)return;setSaving(true);setError("");try{const r=await fetch(appUrl("/api/collaborations"),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({items:batchPreview})});const p=await r.json() as {items?:CollaborationRecord[];error?:string};if(!r.ok||!p.items)throw new Error(p.error||"批量导入失败");setItems(current=>[...p.items!,...current]);setBatchOpen(false);setBatchText("");setBatchPreview([]);}catch(reason){setError(reason instanceof Error?reason.message:"批量导入失败");}finally{setSaving(false);}};
  const move=async(item:CollaborationRecord,stage:string)=>{setError("");try{const r=await fetch(appUrl("/api/collaborations"),{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({id:item.id,stage})});const p=await r.json() as {item?:CollaborationRecord;error?:string};if(!r.ok||!p.item)throw new Error(p.error||"更新失败");setItems(current=>current.map(entry=>entry.id===item.id?p.item!:entry));}catch(reason){setError(reason instanceof Error?reason.message:"更新失败");}};
  return <div className="page collaborations-page"><PageHeading eyebrow="CREATOR COLLABORATION" title="达人合作进度" copy="从建联、寄样、脚本确认到发布，集中管理每一项达人合作。" action={<button className="secondary-btn" onClick={()=>setBatchOpen(true)}>⇧ 批量导入</button>}/><section className="panel collaboration-create"><div className="panel-head"><div><span className="eyebrow">SINGLE IMPORT</span><h3>单条导入合作任务</h3></div><Tag tone="glow-dark">实时入板</Tag></div><div className="collaboration-form"><label>达人名称<input value={form.creatorName} onChange={e=>setForm({...form,creatorName:e.target.value})} placeholder="达人昵称"/></label><label>平台<select value={form.platform} onChange={e=>setForm({...form,platform:e.target.value})}><option>抖音</option><option>小红书</option><option>视频号</option><option>B站</option></select></label><label>合作产品<select value={form.product} onChange={e=>setForm({...form,product:e.target.value})}>{PRODUCTS.map(p=><option key={p}>{p}</option>)}</select></label><label>负责人<input value={form.owner} onChange={e=>setForm({...form,owner:e.target.value})} placeholder="负责人"/></label><label>截止日期<input type="date" value={form.dueDate} onChange={e=>setForm({...form,dueDate:e.target.value})}/></label><label>合作备注<input value={form.note} onChange={e=>setForm({...form,note:e.target.value})} placeholder="选填"/></label><button className="primary-btn" disabled={saving} onClick={create}>{saving?"正在导入…":"＋ 单条导入"}</button></div>{error&&!batchOpen&&<p className="form-error">{error}</p>}</section><section className="collaboration-board">{stages.map((stage,index)=><div className="collaboration-column" key={stage}><header><span>{String(index+1).padStart(2,"0")}</span><strong>{stage}</strong><b>{items.filter(item=>item.stage===stage).length}</b></header><div>{items.filter(item=>item.stage===stage).map(item=><article key={item.id}><small>{item.id} · {item.platform}</small><h4>{item.creatorName}</h4><p>{item.product}</p><div><span>{item.owner||"待分配"}</span><time>{item.dueDate||"未设日期"}</time></div>{item.note&&<em>{item.note}</em>}<select className="stage-control" value={item.stage} onChange={e=>move(item,e.target.value)} aria-label="更新合作阶段">{stages.map(value=><option key={value}>{value}</option>)}</select></article>)}{!items.some(item=>item.stage===stage)&&<p className="collaboration-empty">暂无任务</p>}</div></div>)}</section>{batchOpen&&<div className="modal-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)setBatchOpen(false)}}><section className="import-modal collaboration-import-modal"><div className="import-modal-head"><div><span className="eyebrow">BATCH IMPORT</span><h2>批量导入达人合作</h2></div><button onClick={()=>setBatchOpen(false)}>×</button></div><div className="import-body">{!batchPreview.length?<><label>粘贴合作清单<textarea value={batchText} onChange={event=>setBatchText(event.target.value)} placeholder={'每行一条，按以下顺序填写：\n达人名，平台，产品，负责人，阶段，截止日期，备注\n\n示例：\n小鹿，抖音，眼膜，李雨橦，待建联，2026-08-30，首轮合作'} /></label><div className="recognize-hint"><span>✦</span><p><strong>支持逗号、制表符或竖线分隔</strong><small>一次最多识别 100 条，识别后可逐条确认</small></p></div><div className="modal-actions"><button className="secondary-btn" onClick={()=>setBatchOpen(false)}>取消</button><button className="primary-btn" onClick={recognizeBatch}>识别并预览 →</button></div></>:<><div className="recognition-score"><span>✓</span><div><strong>已识别 {batchPreview.length} 条合作任务</strong><small>确认达人、平台、产品与负责人后再写入进度板</small></div></div><div className="collaboration-preview">{batchPreview.map((row,index)=><article key={`${row.creatorName}-${index}`}><b>{row.creatorName}</b><span>{row.platform} · {row.product}</span><small>{row.owner} · {row.stage} · {row.dueDate||"未设日期"}</small></article>)}</div><div className="modal-actions"><button className="secondary-btn" onClick={()=>setBatchPreview([])}>← 返回修改</button><button className="primary-btn" disabled={saving} onClick={saveBatch}>{saving?"正在批量写入…":`确认导入 ${batchPreview.length} 条`}</button></div></>}{error&&<p className="form-error">{error}</p>}</div></section></div>}</div>;
}

function DeliveryView({ onSync }: { onSync: ()=>void }) {
  return <div className="page"><PageHeading eyebrow="DELIVERY TRACKING" title="投放追踪" copy="打通脚本、成片与广告数据，定位真正驱动增长的创意变量。" action={<button className="primary-btn" onClick={onSync}>↻ 同步海豚智投</button>} />
    <div className="delivery-metrics"><div><span>今日消耗</span><strong>¥4.93w</strong><small className="up">↑ 18.2%</small></div><div><span>今日成交</span><strong>¥16.27w</strong><small className="up">↑ 23.0%</small></div><div><span>综合 ROI</span><strong>3.30</strong><small className="up">↑ 0.34</small></div><div><span>活跃素材</span><strong>36</strong><small>8 条新投</small></div></div>
    <section className="panel table-panel"><div className="panel-head"><div><span className="eyebrow">LIVE PERFORMANCE</span><h3>素材实时表现</h3></div><div className="legend"><i className="green"/>健康 <i className="orange"/>观察 <i className="red"/>衰退</div></div><div className="data-table delivery-table"><div className="table-row table-head"><span>素材 / 脚本</span><span>消耗</span><span>成交</span><span>ROI</span><span>商品点击率</span><span>趋势</span><span>状态</span></div>{deliveryRows.map(row=><div className="table-row" key={row.id}><span><small>{row.id} · {row.script}</small><strong>{row.title}</strong></span><span>{row.spend}</span><span><strong>{row.sales}</strong></span><span className={row.roi<2?"low":"high"}><b>{row.roi}</b></span><span>{row.ctr}</span><span className={row.trend.startsWith("+")?"up":"down"}>{row.trend}</span><span><Tag tone={row.state==="衰退"?"danger":row.state==="观察"?"warning":"success"}>{row.state}</Tag></span></div>)}</div></section>
  </div>;
}

function InsightsView({ onApply }: { onApply: ()=>void }) {
  const bars=[54,68,61,76,72,84,92];
  return <div className="page"><PageHeading eyebrow="AUTOMATED REVIEW" title="自动复盘" copy="把投放结果翻译成明确的创意规律，并持续更新有效标准。" action={<button className="secondary-btn">导出本周复盘</button>} />
    <div className="insight-grid"><section className="panel chart-panel"><div className="panel-head"><div><span className="eyebrow">7-DAY TREND</span><h3>创意有效率</h3></div><Tag tone="success">本周 +9.4%</Tag></div><div className="chart-summary"><strong>68.4%</strong><span>目标 72%</span></div><div className="bar-chart">{bars.map((b,i)=><div key={i}><span style={{height:`${b}%`}} className={i===6?"active":""}/><small>{["四","五","六","日","一","二","三"][i]}</small></div>)}</div></section>
      <section className="panel insight-lead"><Tag tone="glow-dark">NEW LEARNING</Tag><h2>利益点前置不只是“更快”，<br/>而是降低用户的理解成本。</h2><p>在 61 条同产品素材中，前 5 秒明确利益点的脚本，商品点击率平均提升 21%，且衰退速度更慢。</p><div className="evidence"><span><small>样本数</small><strong>61</strong></span><span><small>置信度</small><strong>92%</strong></span><span><small>CTR 提升</small><strong>+21%</strong></span></div><button className="primary-btn" onClick={onApply}>回写有效标准 →</button></section>
    </div>
    <section className="panel learnings-panel"><div className="panel-head"><div><span className="eyebrow">STRUCTURED FINDINGS</span><h3>本周新价值判断</h3></div><button>查看标准库 →</button></div><div className="learning-list">{[
      {n:"01",type:"结构规律",title:"“三重身份”在明星口播中仍然有效",text:"但身份铺陈建议压缩至 8 秒内，第三身份直接连接产品使用场景。",impact:"ROI +0.62",tone:"violet"},
      {n:"02",type:"衰退信号",title:"纯成分讲解类素材进入疲劳期",text:"连续两周点击率下降，建议加入人物处境或结果对比，不再单独扩量。",impact:"CTR -18%",tone:"rose"},
      {n:"03",type:"审核经验",title:"“针”字风险可用概念澄清化解",text:"开头主动说明“微针不是针”，兼顾审核安全与用户认知教育。",impact:"通过率 94%",tone:"amber"}
    ].map(x=><article key={x.n}><span className={`learning-num ${x.tone}`}>{x.n}</span><div><Tag>{x.type}</Tag><h4>{x.title}</h4><p>{x.text}</p></div><strong>{x.impact}</strong></article>)}</div></section>
  </div>;
}
