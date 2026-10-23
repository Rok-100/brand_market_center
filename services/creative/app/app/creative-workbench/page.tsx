"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import "./workbench.css";
import "./workbench-additions.css";
import "./workbench-typography.css";
import { CALENDAR_STAGES, chinaToday, overdueReasons, safeCalendarUrl } from "../../lib/calendar";
import "./calendar-details.css";

const SCRIPT_TYPES = ["付费KOC脚本", "唠嗑KOC脚本", "明星脚本", "AI脚本", "自产脚本", "混剪脚本", "剧情脚本"];
const WRITING_SCRIPT_TYPES = ["付费KOC脚本", "唠嗑KOC脚本", "明星原片脚本", "明星营销号脚本", "视频号脚本"];
const PRODUCTS = ["眼膜", "水润面膜", "水油/蛋白喷雾", "美白针", "黄金面膜", "黑晶面膜", "燕窝面膜", "次抛精华"];
const STAR_TYPES = ["长期品牌向明星", "信息流明星", "AI授权明星"];
const STAR_PHASES = ["明星评估", "市场部议价", "营销端确认", "内容生产", "内部样片审核", "艺人方审核", "收片待上线", "已上线", "一创再利用", "已完成"];
const MATERIAL_TYPES = ["唠嗑KOC原片", "唠嗑KOC AI", "付费KOC原片", "明星原片"];
const NAV = [
  { id: "mine", index: "01", cn: "我的工作台", en: "MY DESK" },
  { id: "writing", index: "02", cn: "脚本写作", en: "SCRIPT WRITING" },
  { id: "calendar", index: "03", cn: "营销日历", en: "MARKETING CALENDAR" },
  { id: "scriptReview", index: "04", cn: "脚本审核中心", en: "SCRIPT REVIEW" },
  { id: "scriptLibrary", index: "05", cn: "脚本内容库", en: "SCRIPT LIBRARY" },
  { id: "videoReview", index: "06", cn: "视频审核中心", en: "VIDEO REVIEW" },
  { id: "videoLibrary", index: "07", cn: "视频内容库", en: "VIDEO LIBRARY" },
  { id: "projects", index: "08", cn: "明星合作中心", en: "STAR COLLABORATION" },
] as const;

type NavId = typeof NAV[number]["id"];
type User = { id: string; name: string; role: string; department: string };
type Reviewer = { id: string; reviewerId: string; reviewerName: string; reviewerRole: string; roleLabel: string; stepOrder: number; status: string; comment: string; decidedAt: string };
type Event = { id: string; actorName: string; action: string; comment: string; createdAt: string };
type Media = { id: string; itemId: string; version: number; originalName: string; mimeType: string; sizeBytes: number; uploaderName: string; createdAt: string; url: string };
type VideoComment = { id: string; itemId: string; mediaId: string; version: number; timeSeconds: number; comment: string; authorId: string; authorName: string; status: string; createdAt: string; resolvedAt: string; screenshotUrl: string };
type Item = {
  id: string; contentType: string; reviewSection: string; scriptType: string; cooperationType: string; materialName: string; authorId: string; authorName: string;
  product: string; feishuUrl: string; artistName: string; projectName: string; priority: string; dueDate: string; note: string;
  submitterId: string; submitterName: string; status: string; currentStep: number; archivedAt: string; createdAt: string; updatedAt: string;
  reviewers: Reviewer[]; events: Event[]; media: Media[]; legacy?: boolean; copy?: string;
};
type Project = {
  id: string; artistName: string; product: string; projectType: string; projectPeriod: string; phase: string; ownerId: string; owner: string;
  creatorId: string; creatorName: string; actualFee: string; rightsScope: string; rightsStartDate: string; rightsEndDate: string; rightsFileUrl: string;
  valueJudgement: string; decision: string; decisionBy: string; decisionAt: string; shootDate: string; finalDate: string; launchDate: string;
  firstCreationPlan: string; nextMilestone: string; eta: string; risk: string; scriptSummary: string; productionSummary: string;
  launchSummary: string; prepSummary: string; linkedItems: Item[];
};
type Collaboration = { id: string; sequence: number; creatorName: string; platform: string; materialType: string; product: string; ownerId: string; owner: string; stage: string; dueDate: string; finishedDate: string; actualShootingDate: string; actualFinishedDate: string; actualLaunchDate: string; linkedItemIds: string; scriptLink: string; source: string; shootingDate: string; launchDate: string; abnormalStage: string; abnormalNote: string; assetLink: string; note: string; createdAt: string; updatedAt: string };
type WritingDraft = { id: string; title: string; content: string; product: string; scriptType: string; feedback?: string };
type WritingVersion = { version: number; title: string; content: string; source: string };
type CreativeMode = "steady" | "expand" | "bold";
type Payload = { user: User; users: User[]; items: Item[]; library: Item[]; projects: Project[]; mine: Record<string, Item[]>; counts: Record<string, number> };

const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
const api = `${base}/api/creative-workbench`;
const videoApi = `${base}/api/creative-workbench-videos`;
const videoCommentsApi = `${base}/api/video-comments`;
const artistProjectsApi = `${base}/api/artist-projects`;
const collaborationsApi = `${base}/api/collaborations`;
const scriptsApi = `${base}/api/scripts`;
const oldPlatformUrl = base.includes("/fd-023794/creative-workbench") ? "/fd-023794/idea-os-creative/" : (base || "/");

function videoTypeText(value: string) {
  return value.replace(/脚本$/, "视频");
}

function starType(value: string) {
  if (value === "AI艺人") return "AI授权明星";
  if (value === "实拍艺人") return "信息流明星";
  return STAR_TYPES.includes(value) ? value : "信息流明星";
}

function projectPeriod(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})/);
  return match ? `${match[1]}年${Number(match[2])}月` : value || "时间待定";
}

function phaseProgress(value: string) {
  const normalized = value.includes("议价") ? "市场部议价" : value.includes("营销") ? "营销端确认" : value.includes("上线追投") ? "一创再利用" : value.includes("上线") ? "已上线" : value.includes("成片") || value.includes("初审") ? "内部样片审核" : value.includes("拍摄") || value.includes("筹备") ? "内容生产" : value;
  const index = STAR_PHASES.indexOf(normalized);
  return index < 0 ? 18 : Math.max(8, Math.round((index + 1) / STAR_PHASES.length * 100));
}

function rightsStatus(project: Project) {
  if (!project.rightsEndDate) return { label: "授权日期待补充", tone: "plain", days: null as number | null };
  const end = new Date(`${project.rightsEndDate}T23:59:59+08:00`).getTime();
  const days = Math.ceil((end - Date.now()) / 86400000);
  if (days < 0) return { label: `授权已到期 ${Math.abs(days)} 天`, tone: "danger", days };
  if (days <= 30) return { label: `授权剩余 ${days} 天`, tone: "danger", days };
  if (days <= 90) return { label: `授权剩余 ${days} 天`, tone: "active", days };
  return { label: `授权至 ${project.rightsEndDate}`, tone: "success", days };
}

function deadlineStatus(project: Project) {
  const value = project.eta || project.launchDate || project.finalDate || project.shootDate;
  if (!value) return { label: "截止时间待定", tone: "plain", days: null as number | null };
  const target = new Date(`${value}T23:59:59+08:00`).getTime();
  const days = Math.ceil((target - Date.now()) / 86400000);
  if (days < 0) return { label: `已超期 ${Math.abs(days)} 天`, tone: "danger", days };
  if (days === 0) return { label: "今天截止", tone: "danger", days };
  if (days <= 3) return { label: `还有 ${days} 天`, tone: "danger", days };
  return { label: `还有 ${days} 天`, tone: "active", days };
}

function daysUntil(date: string) {
  if (!date) return null;
  const target = new Date(`${date}T00:00:00+08:00`).getTime();
  const today = new Date();
  const start = new Date(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}T00:00:00+08:00`).getTime();
  return Math.round((target - start) / 86400000);
}

function formatVideoTime(value: number) {
  const minutes = Math.floor(value / 60);
  const seconds = value - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${seconds.toFixed(1).padStart(4, "0")}`;
}

async function readApiPayload(response: Response): Promise<{ error?: string; [key: string]: unknown }> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) return await response.json() as { error?: string; [key: string]: unknown };
  const message = (await response.text()).trim();
  if (response.status === 413) return { error: "视频超过当前上传通道限制，请压缩文件或分开上传后重试" };
  return { error: message || `请求失败（${response.status}）` };
}

const VIDEO_CHUNK_SIZE = 8 * 1024 * 1024;
const VIDEO_UPLOAD_CONCURRENCY = 4;

type UploadSession = {
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  key: string;
  uploadId: string;
};

async function uploadVideoFiles({ mode, itemId, metadata, comment, files, onProgress }: {
  mode: "create" | "revision";
  itemId?: string;
  metadata?: Record<string, unknown>;
  comment?: string;
  files: File[];
  onProgress?: (message: string) => void;
}) {
  const fileDescriptors = files.map((file) => ({ originalName: file.name, mimeType: file.type || (/\.mov$/i.test(file.name) ? "video/quicktime" : "video/mp4"), sizeBytes: file.size }));
  const initResponse = await fetch(videoApi, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "init", mode, itemId, metadata, files: fileDescriptors }),
  });
  const initPayload = await readApiPayload(initResponse) as { error?: string; itemId?: string; version?: number; uploads?: UploadSession[] };
  if (!initResponse.ok || !initPayload.itemId || !initPayload.version || !initPayload.uploads || initPayload.uploads.length !== files.length) {
    throw new Error(initPayload.error || "无法建立视频上传任务");
  }

  try {
    let uploadedBytes = 0;
    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    const completedUploads = [];
    for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
    const file = files[fileIndex];
    const session = initPayload.uploads[fileIndex];
    const partCount = Math.ceil(file.size / VIDEO_CHUNK_SIZE);
    const parts = new Array<{ partNumber: number; etag: string }>(partCount);
    let nextPartIndex = 0;
    const uploadWorker = async () => {
      while (nextPartIndex < partCount) {
        const partIndex = nextPartIndex;
        nextPartIndex += 1;
        const partNumber = partIndex + 1;
        const offset = partIndex * VIDEO_CHUNK_SIZE;
        const chunk = file.slice(offset, Math.min(offset + VIDEO_CHUNK_SIZE, file.size));
        const query = new URLSearchParams({ key: session.key, uploadId: session.uploadId, partNumber: String(partNumber) });
        let partResponse: Response | null = null;
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          partResponse = await fetch(`${videoApi}?${query}`, { method: "PUT", body: chunk });
          if (partResponse.ok || attempt === 3) break;
          await new Promise((resolve) => window.setTimeout(resolve, attempt * 500));
        }
        const partPayload = await readApiPayload(partResponse!) as { error?: string; partNumber?: number; etag?: string };
        if (!partResponse!.ok || !partPayload.partNumber || !partPayload.etag) throw new Error(partPayload.error || `${file.name} 上传中断，请重试`);
        parts[partIndex] = { partNumber: partPayload.partNumber, etag: partPayload.etag };
        uploadedBytes += chunk.size;
        onProgress?.(`正在上传 ${file.name} · ${Math.min(100, Math.round(uploadedBytes / totalBytes * 100))}%`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(VIDEO_UPLOAD_CONCURRENCY, partCount) }, () => uploadWorker()));
    completedUploads.push({ ...session, parts });
    }

    onProgress?.("正在合并视频并创建审核任务…");
    const completeResponse = await fetch(videoApi, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "complete", mode, itemId: initPayload.itemId, version: initPayload.version, metadata, comment, uploads: completedUploads }),
    });
    const completePayload = await readApiPayload(completeResponse);
    if (!completeResponse.ok) throw new Error(completePayload.error || "视频合并或提交失败");
    return completePayload;
  } catch (error) {
    await fetch(videoApi, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "abort", uploads: initPayload.uploads }) }).catch(() => undefined);
    throw error;
  }
}

function greeting(name: string) {
  const hour = new Date().getHours();
  if (hour < 6) return `${name}，夜深了，辛苦啦。`;
  if (hour < 11) return `${name}，早上好！`;
  if (hour < 14) return `${name}，中午好！`;
  if (hour < 18) return `${name}，下午好！`;
  return `${name}，晚上好！`;
}

function statusText(item: Item) {
  if (item.status === "returned") return "已退回，等待修改";
  if (item.status === "archived") return "全部通过，已自动存档";
  const active = item.reviewers.find((step) => step.status === "active");
  const passed = item.reviewers.filter((step) => step.status === "passed").length;
  return active ? `${passed}/${item.reviewers.length} 已通过 · 待${active.reviewerName}审核` : "等待审核";
}

function Badge({ children, tone = "plain" }: { children: React.ReactNode; tone?: string }) {
  return <span className={`cw-badge ${tone}`}>{children}</span>;
}

function PeoplePicker({ label, users, value, onChange }: { label: string; users: User[]; value: string; onChange: (id: string) => void }) {
  const selected = users.find((user) => user.id === value);
  const [query, setQuery] = useState(selected?.name ?? "");
  const suggestions = query.trim() ? users.filter((user) => user.name.includes(query.trim()) && user.id !== value).slice(0, 6) : [];
  useEffect(() => { setQuery(selected?.name ?? ""); }, [selected?.name]);
  return <label className="cw-field cw-people"><span>{label}</span><input value={query} placeholder="输入姓名查找" onChange={(event) => { setQuery(event.target.value); if (selected && event.target.value !== selected.name) onChange(""); }} />
    {suggestions.length > 0 && <div className="cw-suggestions">{suggestions.map((user) => <button type="button" key={user.id} onClick={() => { onChange(user.id); setQuery(user.name); }}>{user.name}<small>{user.department || "品牌营销部"}</small></button>)}</div>}
  </label>;
}

function TaskCard({ item, onOpen }: { item: Item; onOpen: (item: Item) => void }) {
  const tone = item.status === "returned" ? "danger" : item.status === "archived" ? "success" : "active";
  return <button className="cw-task" onClick={() => onOpen(item)}>
    <span className="cw-task-code">{item.id.slice(-4)}<i /></span>
    <span className="cw-task-main"><small>{item.contentType === "video" ? `视频审核 / ${videoTypeText(item.scriptType)}` : `${item.reviewSection} / ${item.scriptType || item.cooperationType || "方案"}`}</small><strong>{item.materialName}</strong><em>{item.artistName ? `${item.artistName} · ` : ""}{item.product || "未设置单品"}{item.contentType === "video" ? ` · ${item.media.length} 个视频` : ""}</em></span>
    <span className="cw-task-meta"><small>作者</small><strong>{item.authorName}</strong></span>
    <span className="cw-task-meta"><small>审核进度</small><strong>{item.reviewers.filter((step) => step.status === "passed").length}/{item.reviewers.length}</strong></span>
    <span className="cw-task-state"><Badge tone={tone}>{statusText(item)}</Badge><small>{item.dueDate ? `${item.dueDate} 截止` : "未设置截止时间"}</small></span>
    <span className="cw-arrow">↗</span>
  </button>;
}

function Empty({ title, detail }: { title: string; detail: string }) {
  return <div className="cw-empty"><span>◇</span><strong>{title}</strong><p>{detail}</p></div>;
}

export default function CreativeWorkbench() {
  const [data, setData] = useState<Payload | null>(null);
  const [nav, setNav] = useState<NavId>("mine");
  const [mineTab, setMineTab] = useState("submitted");
  const [section, setSection] = useState("文案审核");
  const [type, setType] = useState("全部类型");
  const [keyword, setKeyword] = useState("");
  const [selected, setSelected] = useState<Item | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [projectView, setProjectView] = useState<"overview" | "profiles" | "execution">("overview");
  const [projectTypeFilter, setProjectTypeFilter] = useState("全部类型");
  const [projectCreateOpen, setProjectCreateOpen] = useState(false);
  const [collaborations, setCollaborations] = useState<Collaboration[]>([]);
  const [calendarCreateOpen, setCalendarCreateOpen] = useState(false);
  const [calendarBatchOpen, setCalendarBatchOpen] = useState(false);
  const [calendarEditing, setCalendarEditing] = useState<Collaboration | null>(null);
  const [calendarDetail, setCalendarDetail] = useState<Collaboration | null>(null);
  const [reminderDismissedUntil, setReminderDismissedUntil] = useState(0);
  const [reminderClock, setReminderClock] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => { setReminderClock(Date.now()); void loadCollaborations().catch(() => {}); }, 60000); return () => clearInterval(timer); }, []);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [videoSubmitOpen, setVideoSubmitOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Item | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const response = await fetch(api, { cache: "no-store" });
    const payload = await response.json() as Payload & { error?: string };
    if (!response.ok) throw new Error(payload.error || "读取失败");
    setData(payload);
    if (selected) setSelected(payload.items.find((item) => item.id === selected.id) ?? null);
  };
  const loadCollaborations = async () => {
    const response = await fetch(collaborationsApi, { cache: "no-store" });
    const payload = await response.json() as { items?: Collaboration[]; error?: string };
    if (!response.ok) throw new Error(payload.error || "达人进度读取失败");
    setCollaborations(payload.items ?? []);
  };
  useEffect(() => { Promise.all([load(), loadCollaborations()]).catch((error) => setMessage(error.message)); }, []);

  const filtered = useMemo(() => (data?.items ?? []).filter((item) => {
    if (item.contentType === "video") return false;
    const matchesSection = item.reviewSection === section;
    const matchesType = section !== "文案审核" || type === "全部类型" || item.scriptType === type;
    const matchesKeyword = `${item.materialName}${item.authorName}${item.product}${item.artistName}`.includes(keyword);
    return matchesSection && matchesType && matchesKeyword;
  }), [data, section, type, keyword]);
  const library = useMemo(() => (data?.library ?? []).filter((item) => {
    if (item.contentType === "video") return false;
    const matchesType = type === "全部类型" || (type.endsWith("审核") ? item.reviewSection === type : item.scriptType === type);
    return matchesType && `${item.materialName}${item.authorName}${item.product}${item.artistName}`.includes(keyword);
  }), [data, type, keyword]);
  const videoTasks = useMemo(() => (data?.items ?? []).filter((item) => item.contentType === "video" && `${item.materialName}${item.authorName}${item.product}${item.artistName}`.includes(keyword)), [data, keyword]);
  const videoLibrary = useMemo(() => (data?.library ?? []).filter((item) => item.contentType === "video" && `${item.materialName}${item.authorName}${item.product}${item.artistName}`.includes(keyword)), [data, keyword]);
  const myLaunchReminders = useMemo(() => collaborations.filter((entry) => (entry.ownerId ? entry.ownerId === data?.user.id : entry.owner === data?.user.name) && overdueReasons(entry).length), [collaborations, data?.user.id, data?.user.name, reminderClock]);

  const action = async (actionName: string, comment: string) => {
    if (!selected) return;
    setBusy(true);
    try {
      const response = await fetch(api, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: selected.id, action: actionName, comment }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "操作失败");
      await load(); setMessage(actionName === "return" ? "素材已退回" : actionName === "resubmit" ? "已重新提交审核" : "审核已通过");
    } catch (error) { setMessage(error instanceof Error ? error.message : "操作失败"); } finally { setBusy(false); }
  };

  const videoResubmit = async (files: File[], comment: string) => {
    if (!selected) return;
    setBusy(true);
    try {
      await uploadVideoFiles({ mode: "revision", itemId: selected.id, comment, files, onProgress: setMessage });
      await load(); setMessage("新版本视频已上传并重新提交审核");
    } catch (error) { setMessage(error instanceof Error ? error.message : "新版本上传失败"); } finally { setBusy(false); }
  };

  const deleteItem = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    try {
      const response = await fetch(api, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: deleteTarget.id }) });
      const payload = await readApiPayload(response);
      if (!response.ok) throw new Error(payload.error || "删除失败");
      setSelected(null);
      setDeleteTarget(null);
      await load();
      setMessage(`${deleteTarget.contentType === "video" ? "视频" : "文案"}已删除`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "删除失败"); } finally { setBusy(false); }
  };

  if (!data) return <div className="cw-loading"><span>IO</span><strong>正在进入创意创作台</strong><small>{message || "连接工作空间与身份信息…"}</small></div>;
  const mineTabs = [
    ["submitted", "我提交的", data.counts.submitted], ["assigned", "待我审核", data.counts.assigned], ["returned", "退回待修改", data.counts.returned],
    ["dueSoon", "即将超期", data.counts.dueSoon], ["participating", "我参与的项目", data.counts.participating],
  ] as const;

  return <div className="cw-shell">
    <aside className="cw-sidebar">
      <button className="cw-brand" onClick={() => setNav("writing")}><span>IO</span><div><strong>创意创作台</strong><small>CREATIVE WORKBENCH</small></div></button>
      <div className="cw-space"><small>WORKSPACE / 02</small><strong>内容审核与协作</strong><span>CONTENT OPERATIONS</span></div>
      <p className="cw-nav-label">工作空间</p>
      <nav>{NAV.map((item) => <button key={item.id} className={nav === item.id ? "active" : ""} onClick={() => setNav(item.id)}><i>{item.index}</i><span><strong>{item.cn}</strong><small>{item.en}</small></span><b>↗</b></button>)}</nav>
      <div className="cw-side-foot"><span className="cw-online"><i /> WORKSPACE ONLINE</span><div className="cw-person"><em>{data.user.name.slice(0, 1)}</em><span><strong>{data.user.name}</strong><small>品牌营销部</small></span></div><a href={oldPlatformUrl}><span>返回创意中枢系统</span> ↗</a></div>
    </aside>

    <main className="cw-main">
      <header className="cw-top"><div><small>FANDOW · CREATIVE OPERATIONS</small><strong>{NAV.find((item) => item.id === nav)?.cn}</strong></div><label><span>⌕</span><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="搜索素材、作者、艺人或单品" /></label><time>{new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", weekday: "short" }).format(new Date())}</time></header>

      {nav === "mine" && <section className="cw-page">
        <div className="cw-hero"><div><small>GOOD DAY / PERSONAL DESK</small><h1>{greeting(data.user.name)}</h1><p>今天的脚本、视频、审核和协作进度已经为你归拢。</p></div><div className="cw-hero-actions"><button onClick={() => setSubmitOpen(true)}>＋ 脚本审核</button><button onClick={() => setVideoSubmitOpen(true)}>＋ 视频审核</button></div><span className="cw-orbit" /></div>

        <div className="cw-mine-tabs">{mineTabs.map(([id, label, count]) => <button key={id} className={mineTab === id ? "active" : ""} onClick={() => setMineTab(id)}><span>{String(count).padStart(2, "0")}</span><strong>{label}</strong></button>)}</div>
        <div className="cw-section-head"><div><small>FOCUS QUEUE</small><h2>{mineTabs.find(([id]) => id === mineTab)?.[1]}</h2></div><span>{data.mine[mineTab]?.length ?? 0} 条任务</span></div>
        <div className="cw-list">{(data.mine[mineTab] ?? []).length ? data.mine[mineTab].map((item) => <TaskCard key={item.id} item={item} onOpen={setSelected} />) : <Empty title="这里暂时没有任务" detail="新的工作会在进入你的流程后自动出现。" />}</div>
      </section>}

      {nav === "scriptReview" && <section className="cw-page">
        <div className="cw-page-title"><div><small>SCRIPT REVIEW / LIVE WORKFLOW</small><h1>脚本审核中心</h1><p>用飞书承载脚本与方案，在这里完成路径、意见和决策。</p></div><button onClick={() => setSubmitOpen(true)}>＋ 发起脚本审核</button></div>
        <div className="cw-section-switch"><button className={section === "文案审核" ? "active" : ""} onClick={() => setSection("文案审核")}><b>01</b><span>文案审核<small>脚本与内容</small></span></button><button className={section === "拍摄场地审核" ? "active" : ""} onClick={() => setSection("拍摄场地审核")}><b>02</b><span>拍摄场地审核<small>酒店与场地方案</small></span></button><button className={section === "妆造方案审核" ? "active" : ""} onClick={() => setSection("妆造方案审核")}><b>03</b><span>妆造方案审核<small>妆发与服装方案</small></span></button></div>
        {section === "文案审核" && <div className="cw-filter"><button className={type === "全部类型" ? "active" : ""} onClick={() => setType("全部类型")}>全部</button>{SCRIPT_TYPES.map((entry) => <button key={entry} className={type === entry ? "active" : ""} onClick={() => setType(entry)}>{entry}</button>)}</div>}
        <div className="cw-section-head"><div><small>REVIEW QUEUE</small><h2>{section}</h2></div><span>{filtered.length} 条任务</span></div>
        <div className="cw-list">{filtered.length ? filtered.map((item) => <TaskCard key={item.id} item={item} onOpen={setSelected} />) : <Empty title="当前筛选下暂无任务" detail="可以调整筛选，或发起一条新的审核任务。" />}</div>
      </section>}

      {nav === "scriptLibrary" && <section className="cw-page">
        <div className="cw-page-title"><div><small>SCRIPT CONTENT / APPROVED ONLY</small><h1>脚本内容库</h1><p>只收录经过全部审核人确认的最终脚本与方案。</p></div><Badge tone="success">{library.length} 条已存档</Badge></div>
        <div className="cw-filter"><button className={type === "全部类型" ? "active" : ""} onClick={() => setType("全部类型")}>全部内容</button>{SCRIPT_TYPES.map((entry) => <button key={entry} className={type === entry ? "active" : ""} onClick={() => setType(entry)}>{entry}</button>)}<button onClick={() => setType("拍摄场地审核")}>拍摄场地</button><button onClick={() => setType("妆造方案审核")}>妆造方案</button></div>
        <div className="cw-library-head"><span>合作类型</span><span>素材名称</span><span>作者</span><span>单品</span><span>存档时间</span><span /></div>
        <div className="cw-library">{library.length ? library.map((item) => item.feishuUrl ? <a key={item.id} href={item.feishuUrl} target="_blank" rel="noreferrer"><Badge>{item.cooperationType || item.reviewSection}</Badge><strong>{item.materialName}<small>{item.scriptType || item.reviewSection}</small></strong><span>{item.authorName}</span><span>{item.product || "—"}</span><time>{item.archivedAt ? item.archivedAt.slice(0, 10) : "—"}</time><b>打开文档 ↗</b></a> : <button className="cw-library-legacy" key={item.id} onClick={() => setSelected(item)}><Badge>{item.cooperationType || "历史案例"}</Badge><strong>{item.materialName}<small>{item.scriptType}</small></strong><span>{item.authorName}</span><span>{item.product || "—"}</span><time>{item.archivedAt ? item.archivedAt.slice(0, 10) : "—"}</time><b>查看文案 ↗</b></button>) : <Empty title="内容库等待第一份合格素材" detail="全部审核人通过后，素材会自动出现在这里。" />}</div>
      </section>}

      {nav === "videoReview" && <section className="cw-page">
        <div className="cw-page-title"><div><small>VIDEO REVIEW / LIVE WORKFLOW</small><h1>视频审核中心</h1><p>一条任务可包含多个成片，沿用与脚本一致的逐级审核路径。</p></div><button onClick={() => setVideoSubmitOpen(true)}>＋ 发起视频审核</button></div>
        <div className="cw-filter"><button className={type === "全部类型" ? "active" : ""} onClick={() => setType("全部类型")}>全部视频</button>{SCRIPT_TYPES.map((entry) => <button key={entry} className={type === entry ? "active" : ""} onClick={() => setType(entry)}>{videoTypeText(entry)}</button>)}</div>
        <div className="cw-section-head"><div><small>VIDEO REVIEW QUEUE</small><h2>成片审核任务</h2></div><span>{videoTasks.length} 条任务</span></div>
        <div className="cw-list">{videoTasks.length ? videoTasks.filter((item) => type === "全部类型" || item.scriptType === type).map((item) => <TaskCard key={item.id} item={item} onOpen={setSelected} />) : <Empty title="暂时没有视频审核任务" detail="上传 MP4 或 MOV 成片后，任务会在这里按审核路径流转。" />}</div>
      </section>}

      {nav === "videoLibrary" && <section className="cw-page">
        <div className="cw-page-title"><div><small>VIDEO CONTENT / APPROVED ONLY</small><h1>视频内容库</h1><p>所有审核人通过后，成片及其历史版本自动沉淀在这里。</p></div><Badge tone="success">{videoLibrary.length} 条已存档</Badge></div>
        <div className="cw-video-library">{videoLibrary.length ? videoLibrary.map((item) => <button key={item.id} onClick={() => setSelected(item)}><span className="cw-video-cover">▶<small>{item.media.length} 个视频</small></span><span><small>{videoTypeText(item.scriptType)} · {item.product || "未设置单品"}</small><strong>{item.materialName}</strong><em>{item.artistName ? `${item.artistName} · ` : ""}{item.authorName}</em></span><time>{item.archivedAt.slice(0, 10)}</time><b>查看成片 ↗</b></button>) : <Empty title="视频内容库等待第一组成片" detail="全部审核人通过后，视频会连同历史版本自动存档。" />}</div>
      </section>}

      {nav === "projects" && <StarCollaborationCenter projects={data.projects} keyword={keyword} view={projectView} onView={setProjectView} typeFilter={projectTypeFilter} onTypeFilter={setProjectTypeFilter} onCreate={() => setProjectCreateOpen(true)} onOpen={setProject} />}
      {nav === "calendar" && <MarketingCalendar entries={collaborations} keyword={keyword} currentUser={data.user} onCreate={() => setCalendarCreateOpen(true)} onBatch={() => setCalendarBatchOpen(true)} onOpen={setCalendarDetail} onEdit={setCalendarEditing} onDelete={async (entry) => { if (!window.confirm(`确定删除“${entry.creatorName}”这条素材档期吗？删除后无法恢复。`)) return; const response = await fetch(`${collaborationsApi}?id=${encodeURIComponent(entry.id)}`, { method: "DELETE" }); const payload = await response.json() as { error?: string }; if (!response.ok) return setMessage(payload.error || "删除失败"); await loadCollaborations(); setMessage("素材档期已删除"); }} />}
      {nav === "writing" && <ScriptWritingCenter library={data.library} onMessage={setMessage} />}
    </main>

    {submitOpen && <SubmitModal users={data.users} currentUser={data.user} onClose={() => setSubmitOpen(false)} onCreated={async () => { setSubmitOpen(false); await load(); setNav("scriptReview"); setMessage("脚本审核任务已发起"); }} />}
    {videoSubmitOpen && <VideoSubmitModal users={data.users} currentUser={data.user} onClose={() => setVideoSubmitOpen(false)} onCreated={async () => { setVideoSubmitOpen(false); await load(); setNav("videoReview"); setType("全部类型"); setMessage("视频审核任务已发起"); }} />}
    {projectCreateOpen && <ArtistProjectModal users={data.users} currentUser={data.user} onClose={() => setProjectCreateOpen(false)} onCreated={async () => { setProjectCreateOpen(false); await load(); setNav("projects"); setProjectView("overview"); setMessage("明星合作项目已建立"); }} />}
    {calendarCreateOpen && <CalendarEntryModal items={[...data.items, ...data.library]} users={data.users} currentUser={data.user} onClose={() => setCalendarCreateOpen(false)} onSaved={async () => { setCalendarCreateOpen(false); await loadCollaborations(); setNav("calendar"); setMessage("素材档期已加入营销日历"); }} />}
    {calendarEditing && <CalendarEntryModal items={[...data.items, ...data.library]} users={data.users} currentUser={data.user} item={calendarEditing} onClose={() => setCalendarEditing(null)} onSaved={async () => { setCalendarEditing(null); await loadCollaborations(); setMessage("素材档期已更新"); }} />}
    {calendarBatchOpen && <CalendarBatchModal users={data.users} currentUser={data.user} onClose={() => setCalendarBatchOpen(false)} onSaved={async (count) => { setCalendarBatchOpen(false); await loadCollaborations(); setNav("calendar"); setMessage(`已批量录入 ${count} 条真实档期`); }} />}
    {selected && <ReviewDrawer item={selected} currentUser={data.user} busy={busy} onClose={() => setSelected(null)} onAction={action} onVideoResubmit={videoResubmit} onDelete={() => setDeleteTarget(selected)} />}
    {deleteTarget && <DeleteConfirm item={deleteTarget} busy={busy} onCancel={() => !busy && setDeleteTarget(null)} onConfirm={deleteItem} />}
    {project && <ProjectDrawer project={project} onClose={() => setProject(null)} onOpenItem={(item) => { setProject(null); setSelected(item); }} />}
    {calendarDetail && <CalendarDetail item={collaborations.find((entry) => entry.id === calendarDetail.id) || calendarDetail} items={[...data.items, ...data.library]} onClose={() => setCalendarDetail(null)} onEdit={() => { setCalendarEditing(collaborations.find((entry) => entry.id === calendarDetail.id) || calendarDetail); setCalendarDetail(null); }} onOpenItem={(item) => { setCalendarDetail(null); setSelected(item); }} />}
    {myLaunchReminders.length > 0 && reminderClock >= reminderDismissedUntil && <aside className="cw-overdue-toast"><button className="cw-reminder-dismiss" aria-label="一小时后再提醒" onClick={() => setReminderDismissedUntil(Date.now() + 3600000)}>稍后提醒 ×</button><strong>{myLaunchReminders.length} 项达人进度待确认</strong><p>档期已过，请核实实际进度，不代表已确认延期。</p>{myLaunchReminders.slice(0, 3).map((entry) => <button key={entry.id} onClick={() => { setNav("calendar"); setCalendarDetail(entry); }}><b>{entry.creatorName} · {entry.product}</b><span>{overdueReasons(entry).join("；")} ↗</span></button>)}</aside>}
    {message && <button className="cw-toast" onClick={() => setMessage("")}><i />{message}</button>}
  </div>;
}

function calendarIds(value: string) {
  try { const ids = JSON.parse(value || "[]"); return Array.isArray(ids) ? ids as string[] : []; } catch { return []; }
}
function CalendarLinkPicker({ items, value, onChange }: { items: Item[]; value: string; onChange: (value: string) => void }) {
  const [search, setSearch] = useState("");
  const ids = calendarIds(value);
  const unique = [...new Map(items.map((item) => [item.id, item])).values()];
  return <section className="cw-calendar-links"><strong>关联已有脚本 / 视频</strong><input placeholder="搜索素材名称、达人或作者" value={search} onChange={(e) => setSearch(e.target.value)} />
    {ids.map((id) => <button key={id} type="button" onClick={() => onChange(JSON.stringify(ids.filter((x) => x !== id)))}>{unique.find((item) => item.id === id)?.materialName || id} ×</button>)}
    {search && unique.filter((item) => !ids.includes(item.id) && `${item.materialName} ${item.artistName} ${item.authorName}`.includes(search)).slice(0, 12).map((item) => <button key={item.id} type="button" onClick={() => { onChange(JSON.stringify([...ids, item.id])); setSearch(""); }}>＋ {item.contentType === "video" ? "视频" : "脚本"} · {item.materialName} · {item.authorName}</button>)}
  </section>;
}
function CalendarDetail({ item, items, onClose, onEdit, onOpenItem }: { item: Collaboration; items: Item[]; onClose: () => void; onEdit: () => void; onOpenItem: (item: Item) => void }) {
  const linked = calendarIds(item.linkedItemIds);
  return <div className="cw-modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><section className="cw-modal cw-calendar-detail"><header><div><small>MATERIAL DETAIL · {item.id}</small><h2>{item.creatorName} · {item.product}</h2><p>{item.materialType} · 负责人：{item.owner || "待分配"}</p></div><button onClick={onClose} aria-label="关闭详情">×</button></header><div className="cw-form">
    <div className="cw-progress-track">{CALENDAR_STAGES.map((stage, index) => <span key={stage} className={CALENDAR_STAGES.indexOf(item.stage) >= index ? "active" : ""}>{index + 1}. {stage}</span>)}</div>
    {!CALENDAR_STAGES.includes(item.stage) && <p className="cw-error">历史进度「{item.stage || "未填写"}」尚未核实，请编辑确认当前状态。</p>}
    {overdueReasons(item).map((reason) => <p className="cw-error" key={reason}>{reason}</p>)}
    <div className="cw-date-summary">{[["拍摄", item.shootingDate, item.actualShootingDate], ["成片", item.finishedDate, item.actualFinishedDate], ["发布", item.launchDate, item.actualLaunchDate]].map(([label, planned, actual]) => <article key={label}><small>{label}</small><strong>{planned || "日期待确认"}</strong><p>实际：{actual || "尚未记录"}</p></article>)}</div>
    <section className="cw-calendar-links"><h3>相关脚本与视频</h3>{linked.map((id) => { const record = items.find((entry) => entry.id === id); return record ? <button key={id} onClick={() => onOpenItem(record)}>{record.contentType === "video" ? "▶ 视频" : "脚本"} · {record.materialName} ↗</button> : <p key={id}>关联素材 {id} 暂不可访问</p>; })}
      {safeCalendarUrl(item.scriptLink) && <a href={safeCalendarUrl(item.scriptLink)} target="_blank" rel="noreferrer">打开飞书脚本 ↗</a>}
      {safeCalendarUrl(item.assetLink) && <a href={safeCalendarUrl(item.assetLink)} target="_blank" rel="noreferrer">打开视频 / 素材链接 ↗</a>}
      {!linked.length && !item.scriptLink && !item.assetLink && <p>尚未关联素材，可在编辑中选择已上传脚本、视频或填写链接。</p>}
    </section>
    {item.abnormalStage && <section><h3>{item.abnormalStage}异常</h3><p>{item.abnormalNote}</p></section>}
    <section><h3>进度说明</h3><p style={{ whiteSpace: "pre-wrap" }}>{item.note || "暂无补充说明"}</p><small>数据来源：{item.source || "历史记录，待补充核对依据"}</small></section>
    </div><footer><button onClick={onClose}>关闭</button><button className="cw-primary" onClick={onEdit}>更新进度 / 关联素材 ↗</button></footer></section></div>;
}

function MarketingCalendar({ entries, keyword, currentUser, onCreate, onBatch, onOpen, onEdit, onDelete }: {
  entries: Collaboration[]; keyword: string; currentUser: User; onOpen: (entry: Collaboration) => void; onCreate: () => void; onBatch: () => void; onEdit: (entry: Collaboration) => void; onDelete: (entry: Collaboration) => Promise<void>;
}) {
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const [cursor, setCursor] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [viewMode, setViewMode] = useState<"calendar" | "list">("calendar");
  const [selectedDay, setSelectedDay] = useState("");
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [ownerFilter, setOwnerFilter] = useState("全部负责人");
  const [stageFilter, setStageFilter] = useState("");
  const monthKey = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
  const ownerOptions = [...new Set(entries.map((entry) => entry.owner).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN"));
  const matchesFilters = (entry: Collaboration) => (!stageFilter || entry.stage === stageFilter) && (!selectedTypes.length || selectedTypes.includes(entry.materialType)) && (!selectedProducts.length || selectedProducts.includes(entry.product)) && (ownerFilter === "全部负责人" || entry.owner === ownerFilter) && `${entry.id}${entry.creatorName}${entry.product}${entry.owner}${entry.materialType}${entry.note}`.toLocaleLowerCase("zh-CN").includes(keyword.trim().toLocaleLowerCase("zh-CN"));
  const filtered = entries.filter(matchesFilters);
  const monthEntries = filtered.filter((entry) => entry.shootingDate.startsWith(monthKey) || entry.launchDate.startsWith(monthKey) || entry.finishedDate?.startsWith(monthKey));
  const missing = filtered.filter((entry) => !entry.launchDate || !entry.owner || entry.owner === "待分配");
  const toggle = (value: string, values: string[], setter: (next: string[]) => void) => setter(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  const eventsFor = (date: string) => monthEntries.flatMap((entry) => [entry.shootingDate === date ? { entry, kind: "拍摄" as const } : null, entry.finishedDate === date ? { entry, kind: "成片" as const } : null, entry.launchDate === date ? { entry, kind: "上线" as const } : null].filter(Boolean) as Array<{ entry: Collaboration; kind: "拍摄" | "成片" | "上线" }>).sort((a, b) => Number(b.entry.abnormalStage === b.kind) - Number(a.entry.abnormalStage === a.kind) || a.kind.localeCompare(b.kind));
  const leading = (new Date(cursor.getFullYear(), cursor.getMonth(), 1).getDay() + 6) % 7;
  const cells = Array.from({ length: 42 }, (_, index) => { const date = new Date(cursor.getFullYear(), cursor.getMonth(), index - leading + 1); const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; return { date: key, day: date.getDate(), inMonth: date.getMonth() === cursor.getMonth(), events: date.getMonth() === cursor.getMonth() ? eventsFor(key) : [] }; });
  const selectedEvents = selectedDay ? eventsFor(selectedDay) : [];
  const sortedRows = [...monthEntries].sort((a, b) => (a.launchDate || a.shootingDate).localeCompare(b.launchDate || b.shootingDate) || a.owner.localeCompare(b.owner, "zh-CN") || a.creatorName.localeCompare(b.creatorName, "zh-CN"));
  const titleSuffix = (entry: Collaboration) => entry.sequence > 1 ? ` ${String(entry.sequence).padStart(2, "0")}` : "";

  const entryCard = (entry: Collaboration, kind?: "拍摄" | "成片" | "上线") => <article key={`${entry.id}-${kind || "row"}`} className={entry.abnormalStage ? "abnormal" : ""}>
    <div><small>{entry.id} · {entry.materialType}</small><strong>{entry.creatorName}{titleSuffix(entry)} × {entry.product}</strong><p>负责人 {entry.owner || "待分配"} · 拍摄 {entry.shootingDate || "待定"} · 上线 {entry.launchDate || "待定"}</p>{kind && <b className={`cw-event-kind ${kind === "上线" ? "launch" : "shoot"}`}>{kind}档期</b>}{entry.abnormalStage && <em>{entry.abnormalStage}异常：{entry.abnormalNote}</em>}</div>
    <div className="cw-calendar-row-actions"><button onClick={() => onOpen(entry)}>查看详情 ↗</button><span>{CALENDAR_STAGES.includes(entry.stage) ? entry.stage : "进度待确认"}</span>{safeCalendarUrl(entry.assetLink) && <a href={safeCalendarUrl(entry.assetLink)} target="_blank" rel="noreferrer">素材链接 ↗</a>}<button onClick={() => onEdit(entry)}>编辑</button><button className="danger" onClick={() => onDelete(entry)}>删除</button></div>
  </article>;

  return <section className="cw-page cw-calendar-page">
    <div className="cw-page-title"><div><small>MATERIAL CALENDAR / LIVE SCHEDULE</small><h1>营销日历</h1><p>逐条管理达人素材的拍摄与上线档期；未补齐上线日和负责人的记录会单独提示。</p></div><div className="cw-calendar-title-actions"><button className="secondary" onClick={onBatch}>批量录入</button><button onClick={onCreate}>＋ 新增素材</button></div></div>
    <div className="cw-calendar-toolbar"><div className="cw-month-switch"><button aria-label="上个月" onClick={() => { setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1)); setSelectedDay(""); }}>‹</button><strong>{cursor.getFullYear()}年{cursor.getMonth() + 1}月</strong><button aria-label="下个月" onClick={() => { setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)); setSelectedDay(""); }}>›</button><button onClick={() => setCursor(new Date(today.getFullYear(), today.getMonth(), 1))}>回到本月</button></div><div className="cw-view-switch"><button className={viewMode === "calendar" ? "active" : ""} onClick={() => setViewMode("calendar")}>月历</button><button className={viewMode === "list" ? "active" : ""} onClick={() => setViewMode("list")}>列表</button></div></div>
    <div className="cw-calendar-metrics"><article><small>本月素材</small><strong>{String(monthEntries.length).padStart(2, "0")}</strong><span>独立素材记录</span></article><article><small>本月拍摄</small><strong>{String(monthEntries.filter((entry) => entry.shootingDate.startsWith(monthKey)).length).padStart(2, "0")}</strong><span>按拍摄日期统计</span></article><article><small>本月上线</small><strong>{String(monthEntries.filter((entry) => entry.launchDate.startsWith(monthKey)).length).padStart(2, "0")}</strong><span>按上线日期统计</span></article><article className={missing.length ? "alert" : ""}><small>待补全信息</small><strong>{String(missing.length).padStart(2, "0")}</strong><span>负责人 / 上线日期</span></article><article><small>延期 / 异常</small><strong>{String(monthEntries.filter((entry) => entry.abnormalStage).length).padStart(2, "0")}</strong><span>拍摄或上线异常</span></article></div>
    <div className="cw-calendar-filters"><div><small>素材类型</small><span><button className={!selectedTypes.length ? "active" : ""} onClick={() => setSelectedTypes([])}>全部</button>{MATERIAL_TYPES.map((entry) => <button key={entry} className={selectedTypes.includes(entry) ? "active" : ""} onClick={() => toggle(entry, selectedTypes, setSelectedTypes)}>{entry}</button>)}</span></div><div><small>单品</small><span><button className={!selectedProducts.length ? "active" : ""} onClick={() => setSelectedProducts([])}>全部</button>{[...new Set(entries.map((entry) => entry.product).filter(Boolean))].map((entry) => <button key={entry} className={selectedProducts.includes(entry) ? "active" : ""} onClick={() => toggle(entry, selectedProducts, setSelectedProducts)}>{entry}</button>)}</span></div><div><small>负责人</small><select value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)}><option>全部负责人</option>{ownerOptions.map((owner) => <option key={owner}>{owner}</option>)}</select></div><div><small>进度状态</small><select value={stageFilter} onChange={(event) => setStageFilter(event.target.value)}><option value="">全部状态</option>{CALENDAR_STAGES.map((stage) => <option key={stage}>{stage}</option>)}</select></div></div>
    {missing.length > 0 && <details className="cw-missing-panel"><summary><span><b>待补全信息</b><small>{missing.length} 条记录缺少负责人或上线日期</small></span><strong>展开处理⌄</strong></summary><div>{missing.slice(0, 50).map((entry) => entryCard(entry))}</div></details>}
    {viewMode === "calendar" ? <><section className="cw-month-card cw-month-card-full"><div className="cw-calendar-week">{["周一", "周二", "周三", "周四", "周五", "周六", "周日"].map((day) => <span key={day}>{day}</span>)}</div><div className="cw-calendar-grid">{cells.map((cell) => <article key={cell.date} className={`${cell.inMonth ? "" : "muted"} ${cell.date === todayKey ? "today" : ""} ${cell.date === selectedDay ? "selected" : ""}`} onClick={() => cell.inMonth && setSelectedDay(cell.date)}><time>{cell.day}</time>{cell.events.slice(0, 3).map(({ entry, kind }) => <button key={`${entry.id}-${kind}`} onClick={(event) => { event.stopPropagation(); setSelectedDay(cell.date); onOpen(entry); }} className={`${kind === "上线" ? "is-launch" : "is-shooting"} ${entry.abnormalStage === kind ? "is-abnormal" : ""}`}><b>{entry.abnormalStage === kind ? "异常" : kind} · {entry.creatorName}{titleSuffix(entry)}</b><small>{entry.product}</small></button>)}{cell.events.length > 3 && <em>查看全部 {cell.events.length} 项</em>}</article>)}</div></section>{selectedDay && <aside className="cw-day-panel"><header><div><small>DAY DETAIL</small><h2>{selectedDay}</h2></div><button onClick={() => setSelectedDay("")}>关闭</button></header><div>{selectedEvents.length ? selectedEvents.map(({ entry, kind }) => entryCard(entry, kind)) : <Empty title="当天没有素材档期" detail="可新增拍摄或上线日期后再查看。" />}</div></aside>}</> : <section className="cw-calendar-list"><header><span>素材编号</span><span>达人 / 单品</span><span>负责人</span><span>拍摄 / 上线</span><span>状态与操作</span></header><div>{sortedRows.length ? sortedRows.map((entry) => entryCard(entry)) : <Empty title="本月没有匹配记录" detail="请切换月份或调整筛选条件。" />}</div></section>}
  </section>;
}

function CalendarEntryModal({ users, currentUser, items, item, onClose, onSaved }: { items: Item[]; users: User[]; currentUser: User; item?: Collaboration; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ creatorName: item?.creatorName || "", platform: item?.platform || "抖音", materialType: item?.materialType || MATERIAL_TYPES[0], product: item?.product || "眼膜", ownerId: item ? (item.ownerId || (users.filter((person) => person.name === item.owner).length === 1 ? users.find((person) => person.name === item.owner)!.id : "")) : currentUser.id, shootingDate: item?.shootingDate || "", finishedDate: item?.finishedDate || "", actualShootingDate: item?.actualShootingDate || "", actualFinishedDate: item?.actualFinishedDate || "", actualLaunchDate: item?.actualLaunchDate || "", stage: item ? (CALENDAR_STAGES.includes(item.stage) ? item.stage : "") : "待拍摄", linkedItemIds: item?.linkedItemIds || "[]", scriptLink: item?.scriptLink || "", source: item?.source || "", launchDate: item?.launchDate || "", abnormalStage: item?.abnormalStage || "", abnormalNote: item?.abnormalNote || "", assetLink: item?.assetLink || "", note: item?.note || "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const update = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async () => {
    if (form.creatorName.trim().length < 2) return setError("请填写达人名称");
    if (!form.shootingDate && !form.launchDate && !form.finishedDate) return setError("拍摄、成片、发布日期至少填写一项");
    if (!form.stage) return setError("请确认当前进度；历史状态不会自动当作已发布");
    if (form.abnormalStage && !form.abnormalNote.trim()) return setError("标记异常时请填写异常说明");
    const owner = users.find((entry) => entry.id === form.ownerId) ;
    setBusy(true); setError("");
    try {
      const response = await fetch(collaborationsApi, { method: item ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...form, id: item?.id, owner: owner?.name || item?.owner || "待分配" }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "创建失败");
      onSaved();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "创建失败"); } finally { setBusy(false); }
  };
  return <div className="cw-modal-bg" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="cw-modal cw-calendar-modal"><header><div><small>MATERIAL SCHEDULE</small><h2>{item ? "编辑素材进度" : "新增素材档期"}</h2><p>记录真实进度；档期已过且状态未更新时，仅提醒对应负责人。</p></div><button onClick={onClose}>×</button></header><div className="cw-form">
    <div className="cw-grid3"><label className="cw-field"><span>达人名称</span><input value={form.creatorName} onChange={(event) => update("creatorName", event.target.value)} placeholder="请输入达人姓名或账号名" /></label><label className="cw-field"><span>素材类型</span><select value={form.materialType} onChange={(event) => update("materialType", event.target.value)}>{MATERIAL_TYPES.map((entry) => <option key={entry}>{entry}</option>)}</select></label><label className="cw-field"><span>合作单品</span><select value={form.product} onChange={(event) => update("product", event.target.value)}>{PRODUCTS.map((product) => <option key={product}>{product}</option>)}</select></label></div>
    <div className="cw-grid3"><PeoplePicker label="负责人" users={users} value={form.ownerId} onChange={(value) => update("ownerId", value)} /><label className="cw-field"><span>平台</span><select value={form.platform} onChange={(event) => update("platform", event.target.value)}><option>抖音</option><option>小红书</option><option>视频号</option><option>其他</option></select></label><span /></div>
    <div className="cw-grid3"><label className="cw-field"><span>拍摄日期</span><input type="date" value={form.shootingDate} onChange={(event) => update("shootingDate", event.target.value)} /></label><label className="cw-field"><span>上线日期</span><input type="date" value={form.launchDate} onChange={(event) => update("launchDate", event.target.value)} /></label><label className="cw-field"><span>素材链接</span><input value={form.assetLink} onChange={(event) => update("assetLink", event.target.value)} placeholder="可选" /></label></div>
    <div className="cw-grid3"><label className="cw-field"><span>异常环节</span><select value={form.abnormalStage} onChange={(event) => update("abnormalStage", event.target.value)}><option value="">正常</option><option>拍摄</option><option>成片</option><option>上线</option></select></label><label className="cw-field" style={{ gridColumn: "span 2" }}><span>异常说明</span><input disabled={!form.abnormalStage} value={form.abnormalNote} onChange={(event) => update("abnormalNote", event.target.value)} placeholder={form.abnormalStage ? "说明异常原因和下一步处理" : "标记异常后填写"} /></label></div>
    <div className="cw-grid3"><label className="cw-field"><span>当前进度</span><select value={form.stage} onChange={(e) => update("stage", e.target.value)}><option value="">请选择确认后的进度</option>{CALENDAR_STAGES.map((stage) => <option key={stage}>{stage}</option>)}</select></label><label className="cw-field"><span>预计成片日期</span><input type="date" value={form.finishedDate} onChange={(e) => update("finishedDate", e.target.value)} /></label><label className="cw-field"><span>来源 / 核对依据</span><input value={form.source} onChange={(e) => update("source", e.target.value)} placeholder="文档名称、链接或确认人" /></label></div>
    <div className="cw-grid3">{([["actualShootingDate", "实际拍摄日期"], ["actualFinishedDate", "实际成片日期"], ["actualLaunchDate", "实际发布日期"]] as const).map(([key, label]) => <label key={key} className="cw-field"><span>{label}</span><input type="date" value={form[key]} onChange={(e) => update(key, e.target.value)} /></label>)}</div>
    <label className="cw-field"><span>关联飞书脚本链接</span><input value={form.scriptLink} onChange={(e) => update("scriptLink", e.target.value)} placeholder="https://…" /></label>
    <CalendarLinkPicker items={items} value={form.linkedItemIds} onChange={(value) => update("linkedItemIds", value)} />
    <label className="cw-field"><span>进度与补充说明</span><textarea value={form.note} onChange={(event) => update("note", event.target.value)} placeholder="例如：脚本已确认，等待达人回传初剪；上线后同步投放组。" /></label>{error && <p className="cw-error">{error}</p>}
  </div><footer><button className="cw-cancel" disabled={busy} onClick={onClose}>取消</button><button className="cw-primary" disabled={busy} onClick={submit}>{busy ? "正在保存…" : item ? "保存修改 ↗" : "保存素材 ↗"}</button></footer></section></div>;
}

function CalendarBatchModal({ users, currentUser, onClose, onSaved }: { users: User[]; currentUser: User; onClose: () => void; onSaved: (count: number) => void }) {
  const [text, setText] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [plan, setPlan] = useState<Array<{ line: number; action: string; error: string; row?: Collaboration }>>([]);
  const parse = () => text.split(/\r?\n/).filter((line) => line.trim()).filter((line) => !line.startsWith("负责人")).map((line) => {
    const [owner, materialType, product, creatorName, shootingDate, launchDate, abnormalStage, abnormalNote, assetLink, note, id, stage, finishedDate, scriptLink, source] = line.split(/[｜|\t]/).map((part) => part.trim());
    const person = users.find((user) => user.name === owner);
    if (owner && owner !== "待分配" && !person) throw new Error(`负责人“${owner}”不在站内人员库，请先核对姓名`);
    return { owner: owner || "待分配", ownerId: person?.id || "", materialType, product, creatorName, shootingDate, launchDate, abnormalStage, abnormalNote, assetLink, note, id: id || undefined, stage: stage || (id ? undefined : "待拍摄"), finishedDate, scriptLink, source, platform: "抖音" };
  });
  const send = async (preview: boolean) => {
    setBusy(true); setError("");
    try {
      const items = parse();
      const response = await fetch(collaborationsApi, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items, upsert: true, preview }) });
      const payload = await response.json() as { error?: string; plan?: typeof plan; count?: number };
      if (payload.plan) setPlan(payload.plan);
      if (!response.ok) throw new Error(payload.error || "保存失败");
      if (!preview) onSaved(payload.count || 0);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "导入失败"); } finally { setBusy(false); }
  };
  return <div className="cw-modal-bg" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="cw-modal cw-calendar-modal"><header><div><small>BATCH PROGRESS UPDATE</small><h2>批量导入 / 更新达人进度</h2><p>粘贴 Excel 或飞书表格数据（制表符或竖线分隔）。先预览，再确认入库。更新已有素材请填写详情中的素材编号；不按达人姓名擅自合并。</p></div><button onClick={onClose}>×</button></header><div className="cw-form"><label className="cw-field"><span>负责人｜素材类型｜单品｜达人｜拍摄日期｜发布日期｜异常环节｜异常说明｜视频链接｜备注｜素材编号｜状态｜成片日期｜脚本链接｜来源</span><textarea className="cw-batch-calendar-input" value={text} onChange={(event) => { setText(event.target.value); setPlan([]); }} placeholder="从表格复制数据；日期格式 YYYY-MM-DD，未知日期请留空。后面的可选列可省略。" /></label>
    <label className="cw-field"><span>或导入 UTF-8 文本 / TSV 文件</span><input type="file" accept=".txt,.tsv" onChange={async (event) => { const file = event.target.files?.[0]; if (file) { setText(await file.text()); setPlan([]); } }} /></label>
    {plan.length > 0 && <div className="cw-batch-preview"><header><strong>预览 {plan.length} 条</strong><span>新增 {plan.filter((row) => row.action === "新增").length} · 更新 {plan.filter((row) => row.action === "更新").length} · 冲突 {plan.filter((row) => row.error).length}</span></header>{plan.map((row) => <p key={row.line} className={row.error ? "error" : "ok"}><b>第 {row.line} 行 · {row.action}</b><span>{row.row?.creatorName} · {row.row?.product}</span><em>{row.error || `拍摄 ${row.row?.shootingDate || "待定"} / 成片 ${row.row?.finishedDate || "待定"} / 发布 ${row.row?.launchDate || "待定"} · ${row.row?.stage}`}</em></p>)}</div>}
    {error && <p className="cw-error">{error}</p>}</div><footer><button className="cw-cancel" disabled={busy} onClick={onClose}>取消</button><button disabled={busy || !text.trim()} onClick={() => send(true)}>识别并预览</button><button className="cw-primary" disabled={busy || !plan.length || plan.some((row) => row.error)} onClick={() => send(false)}>{busy ? "正在处理…" : "确认入库 ↗"}</button></footer></section></div>;
}

function ScriptWritingCenter({ library, onMessage }: { library: Item[]; onMessage: (message: string) => void }) {
  const references = library.filter((item) => item.copy && item.copy.length > 20);
  const [product, setProduct] = useState(PRODUCTS[0]);
  const [scriptType, setScriptType] = useState(WRITING_SCRIPT_TYPES[0]);
  const [referenceId, setReferenceId] = useState("");
  const [requirements, setRequirements] = useState("");
  const [targetLength, setTargetLength] = useState("300字左右");
  const [creativeMode, setCreativeMode] = useState<CreativeMode>("expand");
  const [draftTitle, setDraftTitle] = useState("");
  const [draftText, setDraftText] = useState("");
  const [versions, setVersions] = useState<WritingVersion[]>([]);
  const [lastDiversity, setLastDiversity] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const reference = references.find((item) => item.id === referenceId);
  const spokenCount = draftText.replace(/【[^】]+】[^\n]*/g, "").replace(/镜头\d+|画面[:：]|口播[:：]|\s/g, "").length;
  const stripSystemNotes = (content: string) => content.replace(/^(【创作定位】|【参考依据】|【类型标准】|【补充需求】|【长度标准】).*\n?/gm, "").trim();
  const saveVersion = (title: string, content: string, source: string, feedback = "") => {
    setVersions((current) => {
      const next = [...current];
      if (draftText.trim() && !next.some((entry) => entry.content === draftText)) next.push({ version: next.length + 1, title: draftTitle || "手动稿", content: draftText, source: "手动稿" });
      if (!next.some((entry) => entry.content === content)) next.push({ version: next.length + 1, title, content, source });
      return next;
    });
    setDraftTitle(title); setDraftText(content); setLastDiversity(feedback); setAccepted(false);
  };
  const requestWriting = async (action: "initial" | "same" | "new") => {
    const rewrite = action !== "initial";
    if (!rewrite && requirements.trim().length < 2) return onMessage("请先填写补充需求，再生成初稿");
    if (rewrite && draftText.trim().length < 20) return onMessage("请先写入或生成一版完整脚本");
    setBusy(true);
    try {
      const taskRequirement = rewrite
        ? `${action === "same" ? "保留当前稿件的核心角度，但整篇重新组织语言、节奏和画面" : "放弃当前稿件的创意骨架，重新选择人物关系、生活场景、开头钩子、叙事结构、证据方式和收口"}。不要逐句替换近义词。原稿：${draftText.trim()}。补充需求：${requirements.trim() || "保持自然口语和真实体验"}。目标字数：${targetLength}。`
        : `${requirements.trim()}。目标字数：${targetLength}。请直接输出可编辑的完整脚本。`;
      const avoidContents = rewrite ? [...versions.map((entry) => entry.content), draftText] : [];
      const response = await fetch(scriptsApi, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ product, scriptType, templateId: reference?.id || "", templateTitle: reference?.materialName || "", templateCopy: reference?.copy || "", requirements: taskRequirement, count: 1, generationKey: crypto.randomUUID(), previousContent: rewrite ? draftText : "", avoidContents, rewriteMode: action === "same" ? "same-direction" : action === "new" ? "new-direction" : undefined, creativeMode }) });
      const payload = await response.json() as { error?: string; drafts?: WritingDraft[] };
      if (!response.ok) throw new Error(payload.error || "脚本生成失败");
      const next = payload.drafts?.[0];
      if (!next) throw new Error("没有收到生成结果");
      saveVersion(next.title, stripSystemNotes(next.content), action === "same" ? "同方向重写" : action === "new" ? "全新方向" : "AI初稿", next.feedback || "");
      onMessage(action === "same" ? "已保留核心角度并全文重写" : action === "new" ? "已更换创意路线，历史版本全部保留" : "初稿已生成，可以继续编辑或换个方向");
    } catch (caught) { onMessage(caught instanceof Error ? caught.message : "脚本生成失败"); } finally { setBusy(false); }
  };
  return <section className="cw-page cw-writing-page">
    <div className="cw-page-title"><div><small>SCRIPT STUDIO / WRITE · REWRITE · CHOOSE</small><h1>脚本写作</h1><p>写一版，换一种思路再写，直到选出满意的稿件。</p></div><div className="cw-writing-flow"><b className={draftText ? "done" : "active"}>01 写稿</b><i>→</i><b className={draftText && !accepted ? "active" : accepted ? "done" : ""}>02 重写与选择</b><i>→</i><b className={accepted ? "done" : ""}>03 完成</b></div></div>
    <div className="cw-studio-layout">
      <aside className="cw-studio-brief"><header><small>CREATIVE BRIEF</small><h2>创作要求</h2></header><div className="cw-studio-fields">
        <label className="cw-field"><span>脚本类型</span><select value={scriptType} onChange={(event) => { setScriptType(event.target.value); setAccepted(false); }}>{WRITING_SCRIPT_TYPES.map((entry) => <option key={entry}>{entry}</option>)}</select></label>
        <label className="cw-field"><span>单品</span><select value={product} onChange={(event) => { setProduct(event.target.value); setAccepted(false); }}>{PRODUCTS.map((entry) => <option key={entry}>{entry}</option>)}</select></label>
        <label className="cw-field"><span>灵感参考（可选）</span><select value={referenceId} onChange={(event) => { setReferenceId(event.target.value); setAccepted(false); }}><option value="">不选案例，独立构思</option>{references.map((entry) => <option key={entry.id} value={entry.id}>{entry.materialName}</option>)}</select>{reference ? <small className="cw-reference-note">只提取有效说服方式，不沿用原稿骨架</small> : <small className="cw-reference-note">默认从需求重新建立人物、场景和结构</small>}</label>
        <label className="cw-field"><span>补充需求</span><textarea value={requirements} onChange={(event) => { setRequirements(event.target.value); setAccepted(false); }} placeholder="目标人群、场景、重点卖点，以及需要规避的表达。" /></label>
        <label className="cw-field"><span>目标字数</span><select value={targetLength} onChange={(event) => setTargetLength(event.target.value)}><option>200字左右</option><option>300字左右</option><option>400字左右</option><option>不限制</option></select></label>
        <div className="cw-field"><span>创作自由度</span><div className="cw-freedom-options">{([{ id: "steady", label: "稳妥" }, { id: "expand", label: "拓新" }, { id: "bold", label: "大胆" }] as const).map((entry) => <button type="button" key={entry.id} className={creativeMode === entry.id ? "active" : ""} onClick={() => setCreativeMode(entry.id)}>{entry.label}</button>)}</div><small className="cw-reference-note">{creativeMode === "steady" ? "靠近历史有效表达，但不复制结构" : creativeMode === "expand" ? "保留营销逻辑，主动拓展生活场景" : "允许更少见的开头、关系和叙事方式"}</small></div>
      </div><footer><button disabled={busy} onClick={() => requestWriting("initial")}>{busy ? "正在写作…" : "根据要求生成一稿"}</button><small>案例默认不选，让创作从本次需求出发。</small></footer></aside>
      <main className="cw-studio-editor"><header><div><small>WORKING DRAFT</small><h2>当前稿件</h2></div><span><b>{spokenCount}</b> 字</span></header><label className="cw-studio-title"><span>脚本名称</span><input value={draftTitle} onChange={(event) => { setDraftTitle(event.target.value); setAccepted(false); }} placeholder="输入脚本名称" /></label><textarea className="cw-studio-copy" value={draftText} onChange={(event) => { setDraftText(event.target.value); setAccepted(false); }} placeholder="从这里开始写脚本，或粘贴现有稿件……" />
        <footer><div className="cw-version-strip"><span>版本</span>{versions.length ? versions.map((entry) => <button key={entry.version} className={entry.content === draftText ? "active" : ""} title={entry.source} onClick={() => { setDraftTitle(entry.title); setDraftText(entry.content); setAccepted(false); }}>V{entry.version}</button>) : <small>每次重写后，旧稿都会留在这里</small>}</div><span className="cw-editor-state">{accepted ? "当前版本已采用" : "可继续修改或换一版"}</span></footer>
      </main>
      <aside className="cw-studio-diversity"><header><div><small>DIVERSE REWRITE</small><h2>换一种写法</h2></div><Badge tone={versions.length > 1 ? "active" : "plain"}>{versions.length || 0} 个版本</Badge></header>
        <div className="cw-diversity-core"><span className="cw-diversity-mark">↻</span><strong>{draftText ? "不满意就整篇换掉" : "先完成第一版"}</strong><p>重写会同时比较全部历史版本，主动更换开头、叙事结构、人物关系、证据方式和收口，不再围着同一套表达打转。</p>{lastDiversity && <em>{lastDiversity}</em>}<div><span>开头</span><span>结构</span><span>关系</span><span>证据</span><span>收口</span></div></div>
        <footer><button className="secondary" disabled={busy || draftText.trim().length < 20} onClick={() => requestWriting("same")}>{busy ? "正在重写…" : "同方向重写"}</button><button disabled={busy || draftText.trim().length < 20} onClick={() => requestWriting("new")}>{busy ? "正在换方向…" : "换个方向 ↗"}</button><button className="secondary" disabled={!draftText.trim() || busy} onClick={() => { setAccepted(true); onMessage("已采用当前版本"); }}>{accepted ? "已采用当前版本 ✓" : "采用当前版本"}</button><small>“换个方向”会主动避开全部历史稿件的创意骨架。</small></footer>
      </aside>
    </div>
  </section>;
}

function StarCollaborationCenter({ projects, keyword, view, onView, typeFilter, onTypeFilter, onCreate, onOpen }: {
  projects: Project[]; keyword: string; view: "overview" | "profiles" | "execution"; onView: (value: "overview" | "profiles" | "execution") => void;
  typeFilter: string; onTypeFilter: (value: string) => void; onCreate: () => void; onOpen: (project: Project) => void;
}) {
  const visible = projects.filter((entry) => (typeFilter === "全部类型" || starType(entry.projectType) === typeFilter) && `${entry.artistName}${entry.product}${entry.owner}${entry.phase}`.includes(keyword));
  const profiles = Array.from(new Map(visible.map((entry) => [entry.artistName, entry])).values());
  const expiring = projects.filter((entry) => { const status = rightsStatus(entry); return status.days !== null && status.days <= 90; }).length;
  const pendingReview = projects.filter((entry) => entry.phase.includes("审核") || entry.phase.includes("初审") || entry.phase.includes("成片")).length;
  const inProduction = projects.filter((entry) => entry.phase.includes("拍摄") || entry.phase.includes("筹备") || entry.phase.includes("内容")).length;
  const active = projects.filter((entry) => !["已完成", "暂缓", "不合作"].includes(entry.phase)).length;
  const focusProject = [...visible].filter((entry) => !["已完成", "暂缓", "不合作"].includes(entry.phase)).sort((a, b) => {
    const aDate = new Date(`${a.eta || a.launchDate || a.finalDate || a.shootDate || "2999-12-31"}T23:59:59+08:00`).getTime();
    const bDate = new Date(`${b.eta || b.launchDate || b.finalDate || b.shootDate || "2999-12-31"}T23:59:59+08:00`).getTime();
    return aDate - bDate;
  })[0] ?? visible[0];
  const attention = projects.map((entry) => ({ entry, deadline: deadlineStatus(entry), rights: rightsStatus(entry) }))
    .filter(({ deadline, rights }) => (deadline.days !== null && deadline.days <= 3) || (rights.days !== null && rights.days <= 90))
    .slice(0, 3);
  return <section className="cw-page cw-star-center">
    <div className="cw-page-title"><div><small>STAR COLLABORATION / FULL JOURNEY</small><h1>明星合作中心</h1><p>从合作判断、权益确认到内容生产、成片上线与一创再利用。</p></div><button onClick={onCreate}>＋ 建立明星合作</button></div>
    {view === "overview" && focusProject && <div className="cw-star-focus-layout">
      <button className="cw-star-focus" onClick={() => onOpen(focusProject)}><span className="cw-focus-orbit" /><header><span><small>NOW / CURRENT FOCUS</small><b>当前重点项目</b></span><Badge tone={starType(focusProject.projectType) === "AI授权明星" ? "violet" : "active"}>{starType(focusProject.projectType)}</Badge></header><div className="cw-focus-main"><span><small>{projectPeriod(focusProject.projectPeriod)} · {focusProject.phase}</small><strong>{focusProject.artistName}<i>×</i>{focusProject.product}</strong><p>{focusProject.nextMilestone || "等待补充下一节点"}</p></span><div><small>节点状态</small><b>{deadlineStatus(focusProject).label}</b><em>{focusProject.eta || focusProject.launchDate || "时间待定"}</em></div></div><div className="cw-focus-progress"><span><i style={{ width: `${phaseProgress(focusProject.phase)}%` }} /></span><b>{phaseProgress(focusProject.phase)}%</b></div><footer><span>负责人 <b>{focusProject.owner}</b></span><span>授权状态 <b>{rightsStatus(focusProject).label}</b></span><strong>打开项目 ↗</strong></footer></button>
      <aside className="cw-star-attention"><header><div><small>ATTENTION</small><h3>待处理提醒</h3></div><Badge tone={attention.length ? "danger" : "success"}>{attention.length} 项</Badge></header>{attention.length ? attention.map(({ entry, deadline, rights }) => <button key={entry.id} onClick={() => onOpen(entry)}><i /><span><b>{entry.artistName} × {entry.product}</b><small>{deadline.days !== null && deadline.days <= 3 ? deadline.label : rights.label}</small></span><strong>↗</strong></button>) : <div className="cw-attention-clear"><span>✓</span><b>当前没有临期事项</b><small>授权与关键节点均处于正常状态</small></div>}</aside>
    </div>}
    <div className="cw-star-view-tabs">
      <button className={view === "overview" ? "active" : ""} onClick={() => onView("overview")}><i>01</i><span><b>合作总览</b></span></button>
      <button className={view === "profiles" ? "active" : ""} onClick={() => onView("profiles")}><i>02</i><span><b>明星与合作信息</b></span></button>
      <button className={view === "execution" ? "active" : ""} onClick={() => onView("execution")}><i>03</i><span><b>项目执行进度</b></span></button>
    </div>
    {view === "overview" && <>
      <div className="cw-star-control-row"><div className="cw-star-metrics"><article><strong>{String(active).padStart(2, "0")}</strong><span>推进中</span></article><article><strong>{String(inProduction).padStart(2, "0")}</strong><span>内容生产</span></article><article><strong>{String(pendingReview).padStart(2, "0")}</strong><span>待样片审核</span></article><article className={expiring ? "alert" : ""}><strong>{String(expiring).padStart(2, "0")}</strong><span>授权提醒</span></article></div><div className="cw-filter cw-star-filter"><button className={typeFilter === "全部类型" ? "active" : ""} onClick={() => onTypeFilter("全部类型")}>全部类型</button>{STAR_TYPES.map((entry) => <button key={entry} className={typeFilter === entry ? "active" : ""} onClick={() => onTypeFilter(entry)}>{entry}</button>)}</div></div>
      <div className="cw-section-head"><div><small>COLLABORATION PORTFOLIO</small><h2>合作项目</h2></div><span>{visible.length} 个项目</span></div>
      <div className="cw-star-project-list">{visible.map((entry, index) => { const rights = rightsStatus(entry); const deadline = deadlineStatus(entry); return <button key={entry.id} className={focusProject?.id === entry.id ? "focus" : ""} onClick={() => onOpen(entry)}><span className="cw-star-list-no">{String(index + 1).padStart(2, "0")}</span><span className="cw-star-list-name"><small>{starType(entry.projectType)} · {projectPeriod(entry.projectPeriod)}</small><strong>{entry.artistName}<i>×</i>{entry.product}</strong></span><span className="cw-star-list-stage"><small>当前阶段</small><b>{entry.phase}</b><em><i style={{ width: `${phaseProgress(entry.phase)}%` }} /></em></span><span className="cw-star-list-next"><small>下一节点</small><b>{entry.nextMilestone || "待补充"}</b><em>{entry.owner} · {entry.eta || "时间待定"}</em></span><span className="cw-star-list-status"><Badge tone={deadline.tone}>{deadline.label}</Badge><Badge tone={rights.tone}>{rights.label}</Badge></span><strong className="cw-arrow">↗</strong></button>; })}</div>
    </>}
    {view === "profiles" && <>
      <div className="cw-section-head"><div><small>STAR PROFILES / NO IMAGE</small><h2>明星与合作信息</h2></div><span>{profiles.length} 位明星</span></div>
      <div className="cw-star-profiles">{profiles.map((profile) => { const history = visible.filter((entry) => entry.artistName === profile.artistName); return <article key={profile.artistName}><header><div><small>{starType(profile.projectType)}</small><h2>{profile.artistName}</h2></div><Badge tone="active">{history.length} 次合作</Badge></header><div className="cw-profile-facts"><span><small>适配单品</small><b>{Array.from(new Set(history.map((entry) => entry.product))).join("、")}</b></span><span><small>最近负责人</small><b>{profile.owner}</b></span><span><small>档案建档人</small><b>{profile.creatorName || profile.owner}</b></span></div><div className="cw-profile-history">{history.map((entry) => <button key={entry.id} onClick={() => onOpen(entry)}><span><small>{projectPeriod(entry.projectPeriod)}</small><b>{entry.product}</b></span><Badge tone={entry.decision === "推进" ? "success" : "plain"}>{entry.decision || "推进"}</Badge><em>{entry.phase}</em><strong>↗</strong></button>)}</div></article>; })}</div>
    </>}
    {view === "execution" && <>
      <div className="cw-execution-head"><div><small>PROJECT EXECUTION / LIVE</small><h2>项目执行进度</h2><p>合作确认、内容生产、成片审核、上线与一创再利用共用一条进度轴。</p></div><div><button className="active">项目进度</button><button>营销日历</button><button>任务列表</button></div></div>
      <div className="cw-execution-list">{visible.map((entry) => <button key={entry.id} onClick={() => onOpen(entry)}><div className="cw-execution-name"><small>{starType(entry.projectType)} · {projectPeriod(entry.projectPeriod)}</small><strong>{entry.artistName} × {entry.product}</strong><span>负责人 {entry.owner}</span></div><div className="cw-stage-rail"><i style={{ width: `${phaseProgress(entry.phase)}%` }} /><span className="done">合作确认</span><span className={phaseProgress(entry.phase) >= 35 ? "done" : ""}>内容生产</span><span className={phaseProgress(entry.phase) >= 60 ? "done" : ""}>成片审核</span><span className={phaseProgress(entry.phase) >= 80 ? "done" : ""}>上线与一创</span></div><div className="cw-execution-next"><small>当前阶段</small><b>{entry.phase}</b><span>{entry.nextMilestone || "待补充下一节点"}</span></div><strong className="cw-arrow">↗</strong></button>)}</div>
    </>}
  </section>;
}

function ArtistProjectModal({ users, currentUser, onClose, onCreated }: { users: User[]; currentUser: User; onClose: () => void; onCreated: () => void }) {
  const currentMonth = new Date().toISOString().slice(0, 7);
  const [form, setForm] = useState({ artistName: "", product: PRODUCTS[0], projectType: STAR_TYPES[1], projectPeriod: currentMonth, ownerId: currentUser.id, actualFee: "", rightsScope: "", rightsStartDate: "", rightsEndDate: "", rightsFileUrl: "", valueJudgement: "", decision: "推进", shootDate: "", finalDate: "", launchDate: "", nextMilestone: "完成合作信息确认", eta: "", firstCreationPlan: "" });
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const update = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const owner = users.find((entry) => entry.id === form.ownerId) ?? currentUser;
  const submit = async () => { setBusy(true); setError(""); try { const response = await fetch(artistProjectsApi, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(form) }); const payload = await readApiPayload(response); if (!response.ok) throw new Error(payload.error || "建立失败"); onCreated(); } catch (error) { setError(error instanceof Error ? error.message : "建立失败"); } finally { setBusy(false); } };
  return <div className="cw-modal-bg" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="cw-modal cw-star-modal"><header><div><small>NEW STAR COLLABORATION</small><h2>建立明星合作</h2><p>项目自动命名为“明星 × 单品 · 合作时间”，不上传明星照片。</p></div><button onClick={onClose}>×</button></header><div className="cw-form">
    <div className="cw-form-section"><small>01 / 明星与项目</small><div className="cw-grid3"><label className="cw-field"><span>明星姓名</span><input value={form.artistName} onChange={(e) => update("artistName", e.target.value)} placeholder="输入明星姓名" /></label><label className="cw-field"><span>明星类型</span><select value={form.projectType} onChange={(e) => update("projectType", e.target.value)}>{STAR_TYPES.map((entry) => <option key={entry}>{entry}</option>)}</select></label><label className="cw-field"><span>合作单品</span><select value={form.product} onChange={(e) => update("product", e.target.value)}>{[...PRODUCTS, "品牌合作"].map((entry) => <option key={entry}>{entry}</option>)}</select></label></div><div className="cw-grid3"><label className="cw-field"><span>合作时间</span><input type="month" value={form.projectPeriod} onChange={(e) => update("projectPeriod", e.target.value)} /></label><PeoplePicker label="项目负责人" users={users} value={form.ownerId} onChange={(value) => update("ownerId", value)} /><div className="cw-auto-owner"><small>明星档案建档人</small><strong>{owner.name}</strong><span>自动跟随当前项目负责人</span></div></div><div className="cw-project-name-preview"><small>项目名称预览</small><strong>{form.artistName || "明星姓名"} × {form.product} · {projectPeriod(form.projectPeriod)}</strong></div></div>
    <div className="cw-form-section"><small>02 / 权益与价值判断</small><div className="cw-grid3"><label className="cw-field"><span>实际合作费用</span><input value={form.actualFee} onChange={(e) => update("actualFee", e.target.value)} placeholder="例如：80万元" /></label><label className="cw-field"><span>素材授权起始日期</span><input type="date" value={form.rightsStartDate} onChange={(e) => update("rightsStartDate", e.target.value)} /></label><label className="cw-field"><span>素材授权到期日期</span><input type="date" value={form.rightsEndDate} onChange={(e) => update("rightsEndDate", e.target.value)} /></label></div><label className="cw-field"><span>权益内容与素材使用范围</span><textarea value={form.rightsScope} onChange={(e) => update("rightsScope", e.target.value)} placeholder="姓名、肖像、信息流、直播间、原片、混剪、二创或 AI 衍生等实际权益" /></label><label className="cw-field"><span>授权书或合同链接</span><input value={form.rightsFileUrl} onChange={(e) => update("rightsFileUrl", e.target.value)} placeholder="可粘贴飞书文档或云盘链接" /></label><div className="cw-grid3"><label className="cw-field"><span>合作结论</span><select value={form.decision} onChange={(e) => update("decision", e.target.value)}><option>推进</option><option>观察</option><option>暂缓</option><option>不合作</option></select></label><label className="cw-field cw-span2"><span>价值判断与原因</span><textarea value={form.valueJudgement} onChange={(e) => update("valueJudgement", e.target.value)} placeholder="自由填写为什么选择、暂缓或不选择这位明星，以及本次合作的价值判断" /></label></div></div>
    <div className="cw-form-section"><small>03 / 执行关键时间</small><div className="cw-grid3"><label className="cw-field"><span>计划拍摄日</span><input type="date" value={form.shootDate} onChange={(e) => update("shootDate", e.target.value)} /></label><label className="cw-field"><span>计划收片日</span><input type="date" value={form.finalDate} onChange={(e) => update("finalDate", e.target.value)} /></label><label className="cw-field"><span>计划上线日</span><input type="date" value={form.launchDate} onChange={(e) => update("launchDate", e.target.value)} /></label></div><div className="cw-grid3"><label className="cw-field cw-span2"><span>下一节点</span><input value={form.nextMilestone} onChange={(e) => update("nextMilestone", e.target.value)} /></label><label className="cw-field"><span>下一节点截止日</span><input type="date" value={form.eta} onChange={(e) => update("eta", e.target.value)} /></label></div><label className="cw-field"><span>上线与一创再利用规划</span><textarea value={form.firstCreationPlan} onChange={(e) => update("firstCreationPlan", e.target.value)} placeholder="计划测试的文案框架、混剪方向、一创负责人及交付安排" /></label></div>
    {error && <p className="cw-error">{error}</p>}
  </div><footer><button className="cw-cancel" onClick={onClose}>取消</button><button className="cw-primary" disabled={busy} onClick={submit}>{busy ? "正在建立…" : "建立合作项目"} ↗</button></footer></section></div>;
}

function SubmitModal({ users, currentUser, onClose, onCreated }: { users: User[]; currentUser: User; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ reviewSection: "文案审核", scriptType: SCRIPT_TYPES[0], cooperationType: "达人合作", materialName: "", authorId: currentUser.id, product: PRODUCTS[0], feishuUrl: "", artistName: "", projectName: "", priority: "普通", dueDate: "", note: "" });
  const [reviewers, setReviewers] = useState({ team_lead: "", supervisor: "", director: "" });
  const [importMode, setImportMode] = useState<"single" | "batch">("single");
  const [batchText, setBatchText] = useState("");
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const update = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async () => { setBusy(true); setError(""); try {
    const route = Object.entries(reviewers).filter(([, reviewerId]) => reviewerId).map(([role, reviewerId]) => ({ role, reviewerId }));
    const entries = importMode === "single" ? [{ materialName: form.materialName, feishuUrl: form.feishuUrl }] : batchText.split(/\n+/).map((line, index) => {
      const trimmed = line.trim(); const match = trimmed.match(/https:\/\/\S+/); const link = match?.[0] ?? "";
      const name = trimmed.replace(link, "").replace(/^[\s|｜,，;；:：-]+|[\s|｜,，;；:：-]+$/g, "");
      return { materialName: name || `批量审核素材 ${String(index + 1).padStart(2, "0")}`, feishuUrl: link };
    }).filter((entry) => entry.feishuUrl);
    if (!entries.length) throw new Error("请至少粘贴一条有效的飞书链接");
    for (const entry of entries) {
      const response = await fetch(api, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...form, ...entry, reviewers: route }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(`${entry.materialName}：${payload.error || "提交失败"}`);
    }
    onCreated();
  } catch (error) { setError(error instanceof Error ? error.message : "提交失败"); } finally { setBusy(false); } };
  return <div className="cw-modal-bg" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="cw-modal"><header><div><small>NEW REVIEW / FEISHU LINK</small><h2>发起审核任务</h2><p>只提交飞书链接；审核人按勾选层级依次流转。</p></div><button onClick={onClose}>×</button></header><div className="cw-form">
    <div className="cw-grid3"><label className="cw-field"><span>审核分类</span><select value={form.reviewSection} onChange={(e) => update("reviewSection", e.target.value)}><option>文案审核</option><option>拍摄场地审核</option><option>妆造方案审核</option></select></label>{form.reviewSection === "文案审核" && <label className="cw-field"><span>脚本类型</span><select value={form.scriptType} onChange={(e) => update("scriptType", e.target.value)}>{SCRIPT_TYPES.map((entry) => <option key={entry}>{entry}</option>)}</select></label>}<label className="cw-field"><span>合作类型</span><input value={form.cooperationType} onChange={(e) => update("cooperationType", e.target.value)} /></label></div>
    <div className="cw-import-mode"><button className={importMode === "single" ? "active" : ""} onClick={() => setImportMode("single")}>单条链接</button><button className={importMode === "batch" ? "active" : ""} onClick={() => setImportMode("batch")}>批量导入链接</button><span>{importMode === "batch" ? "一行一条，可写“素材名称｜飞书链接”" : "提交一份素材"}</span></div>
    {importMode === "single" ? <><label className="cw-field"><span>素材名称</span><input value={form.materialName} onChange={(e) => update("materialName", e.target.value)} placeholder="例如：海清黑晶面膜第一版脚本" /></label><label className="cw-field"><span>飞书链接</span><input value={form.feishuUrl} onChange={(e) => update("feishuUrl", e.target.value)} placeholder="粘贴飞书文档 / 表格 / 幻灯片 / 知识库链接" /></label></> : <label className="cw-field"><span>批量素材与飞书链接</span><textarea className="cw-batch-links" value={batchText} onChange={(e) => setBatchText(e.target.value)} placeholder={"海清第一版脚本｜https://fandow.feishu.cn/docx/...\n海清第二版脚本｜https://fandow.feishu.cn/docx/...\nhttps://fandow.feishu.cn/wiki/..."} /></label>}
    <div className="cw-grid3"><PeoplePicker label="作者" users={users} value={form.authorId} onChange={(value) => update("authorId", value)} /><label className="cw-field"><span>单品</span><select value={form.product} onChange={(e) => update("product", e.target.value)}>{PRODUCTS.map((entry) => <option key={entry}>{entry}</option>)}</select></label><label className="cw-field"><span>合作艺人</span><input value={form.artistName} onChange={(e) => update("artistName", e.target.value)} placeholder="可选" /></label></div>
    <div className="cw-path-title"><div><small>REVIEW PATH</small><strong>勾选实际需要的审核人</strong></div><span>系统自动按层级排序</span></div>
    <div className="cw-review-route"><PeoplePicker label="01 · 组长审核（可跳过）" users={users} value={reviewers.team_lead} onChange={(value) => setReviewers((current) => ({ ...current, team_lead: value }))} /><b>→</b><PeoplePicker label="02 · 主管审核（可跳过）" users={users} value={reviewers.supervisor} onChange={(value) => setReviewers((current) => ({ ...current, supervisor: value }))} /><b>→</b><PeoplePicker label="03 · 总监审核（可跳过）" users={users} value={reviewers.director} onChange={(value) => setReviewers((current) => ({ ...current, director: value }))} /></div>
    <div className="cw-grid3"><label className="cw-field"><span>优先级</span><select value={form.priority} onChange={(e) => update("priority", e.target.value)}><option>紧急</option><option>普通</option><option>低</option></select></label><label className="cw-field"><span>截止时间</span><input type="date" value={form.dueDate} onChange={(e) => update("dueDate", e.target.value)} /></label><label className="cw-field"><span>关联项目</span><input value={form.projectName} onChange={(e) => update("projectName", e.target.value)} placeholder="可选" /></label></div>
    <label className="cw-field"><span>补充说明</span><textarea value={form.note} onChange={(e) => update("note", e.target.value)} placeholder="背景、重点或需要审核人特别关注的内容" /></label>{error && <p className="cw-error">{error}</p>}
  </div><footer><button className="cw-cancel" onClick={onClose}>取消</button><button className="cw-primary" disabled={busy} onClick={submit}>{busy ? "正在提交…" : "确认并发起审核"} ↗</button></footer></section></div>;
}

function VideoSubmitModal({ users, currentUser, onClose, onCreated }: { users: User[]; currentUser: User; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ materialName: "", scriptType: SCRIPT_TYPES[0], cooperationType: "成片", authorId: currentUser.id, product: PRODUCTS[0], artistName: "", projectName: "", priority: "普通", dueDate: "", note: "" });
  const [reviewers, setReviewers] = useState({ team_lead: "", supervisor: "", director: "" });
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const [progress, setProgress] = useState("");
  const update = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async () => { setBusy(true); setError(""); try {
    const route = Object.entries(reviewers).filter(([, reviewerId]) => reviewerId).map(([role, reviewerId]) => ({ role, reviewerId }));
    if (!files.length) throw new Error("请至少上传一个 MP4 或 MOV 视频");
    await uploadVideoFiles({ mode: "create", metadata: { ...form, reviewers: route }, files, onProgress: setProgress });
    onCreated();
  } catch (error) { setError(error instanceof Error ? error.message : "提交失败"); } finally { setBusy(false); } };
  return <div className="cw-modal-bg" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="cw-modal"><header><div><small>NEW VIDEO REVIEW / MP4 · MOV</small><h2>发起视频审核任务</h2><p>同一任务可上传多个成片，并按所选审核人依次流转。</p></div><button onClick={onClose}>×</button></header><div className="cw-form">
    <div className="cw-grid3"><label className="cw-field"><span>视频素材名称</span><input value={form.materialName} onChange={(e) => update("materialName", e.target.value)} placeholder="例如：海清黑晶面膜首轮成片" /></label><label className="cw-field"><span>视频类型</span><select value={form.scriptType} onChange={(e) => update("scriptType", e.target.value)}>{SCRIPT_TYPES.map((entry) => <option key={entry} value={entry}>{videoTypeText(entry)}</option>)}</select></label><label className="cw-field"><span>合作类型</span><input value={form.cooperationType} onChange={(e) => update("cooperationType", e.target.value)} /></label></div>
    <label className="cw-video-drop"><input type="file" accept="video/mp4,video/quicktime,.mp4,.mov" multiple onChange={(event) => setFiles(Array.from(event.target.files ?? []))} /><span>＋</span><strong>上传 MP4 / MOV 成片</strong><small>可一次选择多个视频；平台不设置业务大小上限</small></label>
    {files.length > 0 && <div className="cw-file-list">{files.map((file) => <span key={`${file.name}-${file.size}`}><b>{file.name}</b><small>{(file.size / 1024 / 1024).toFixed(1)} MB</small></span>)}</div>}
    <div className="cw-grid3"><PeoplePicker label="作者" users={users} value={form.authorId} onChange={(value) => update("authorId", value)} /><label className="cw-field"><span>单品</span><select value={form.product} onChange={(e) => update("product", e.target.value)}>{PRODUCTS.map((entry) => <option key={entry}>{entry}</option>)}</select></label><label className="cw-field"><span>合作艺人</span><input value={form.artistName} onChange={(e) => update("artistName", e.target.value)} placeholder="可选" /></label></div>
    <div className="cw-path-title"><div><small>REVIEW PATH</small><strong>勾选实际需要的审核人</strong></div><span>与脚本审核路径一致</span></div>
    <div className="cw-review-route"><PeoplePicker label="01 · 组长审核（可跳过）" users={users} value={reviewers.team_lead} onChange={(value) => setReviewers((current) => ({ ...current, team_lead: value }))} /><b>→</b><PeoplePicker label="02 · 主管审核（可跳过）" users={users} value={reviewers.supervisor} onChange={(value) => setReviewers((current) => ({ ...current, supervisor: value }))} /><b>→</b><PeoplePicker label="03 · 总监审核（可跳过）" users={users} value={reviewers.director} onChange={(value) => setReviewers((current) => ({ ...current, director: value }))} /></div>
    <div className="cw-grid3"><label className="cw-field"><span>优先级</span><select value={form.priority} onChange={(e) => update("priority", e.target.value)}><option>紧急</option><option>普通</option><option>低</option></select></label><label className="cw-field"><span>截止时间</span><input type="date" value={form.dueDate} onChange={(e) => update("dueDate", e.target.value)} /></label><label className="cw-field"><span>关联项目</span><input value={form.projectName} onChange={(e) => update("projectName", e.target.value)} placeholder="可选" /></label></div>
    <label className="cw-field"><span>补充说明</span><textarea value={form.note} onChange={(e) => update("note", e.target.value)} placeholder="审核重点、版本说明或需要特别关注的画面" /></label>{error && <p className="cw-error">{error}</p>}
  </div><footer><button className="cw-cancel" disabled={busy} onClick={onClose}>取消</button><button className="cw-primary" disabled={busy} onClick={submit}>{busy ? progress || "正在建立上传任务…" : `上传 ${files.length || ""} 个视频并发起审核`} ↗</button></footer></section></div>;
}

function ReviewDrawer({ item, currentUser, busy, onClose, onAction, onVideoResubmit, onDelete }: { item: Item; currentUser: User; busy: boolean; onClose: () => void; onAction: (action: string, comment: string) => void; onVideoResubmit: (files: File[], comment: string) => void; onDelete: () => void }) {
  const [comment, setComment] = useState("");
  const [videoFiles, setVideoFiles] = useState<File[]>([]);
  const active = item.reviewers.find((step) => step.status === "active");
  const canReview = active?.reviewerId === currentUser.id;
  const canResubmit = item.status === "returned" && (item.submitterId === currentUser.id || item.authorId === currentUser.id);
  const canDelete = currentUser.name === "李雨橦" || currentUser.id.toUpperCase() === "FD-023794" || item.submitterId === currentUser.id || item.authorId === currentUser.id;
  const decisionPanel = (canReview || canResubmit) && <section className="cw-decision"><small>{canReview ? "REVIEW DECISION" : "RESUBMIT"}</small><h3>{canReview ? "填写本次审核意见" : item.contentType === "video" ? "上传新版本视频并重新提交" : "确认已在原飞书文档完成修改"}</h3>{canResubmit && item.contentType === "video" && <><label className="cw-mini-upload"><input type="file" accept="video/mp4,video/quicktime,.mp4,.mov" multiple onChange={(event) => setVideoFiles(Array.from(event.target.files ?? []))} />选择新版本 MP4 / MOV</label>{videoFiles.length > 0 && <p>{videoFiles.map((file) => file.name).join("、")}</p>}</>}<textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder={canReview ? "退回时必须填写；通过时可选填。" : "可补充本轮修改说明"} />{canReview ? <div><button disabled={busy} className="cw-return" onClick={() => onAction("return", comment)}>退回素材</button><button disabled={busy} className="cw-primary" onClick={() => onAction("pass", comment)}>通过审核 ↗</button></div> : item.contentType === "video" ? <button disabled={busy || !videoFiles.length} className="cw-primary full" onClick={() => onVideoResubmit(videoFiles, comment)}>上传新版本并重新提交 ↗</button> : <button disabled={busy} className="cw-primary full" onClick={() => onAction("resubmit", comment)}>重新提交全部审核人 ↗</button>}</section>;
  return <div className="cw-drawer-bg" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><aside className={`cw-drawer ${item.contentType === "video" ? "video-review" : ""}`}><header><div><small>{item.id} / {item.reviewSection}</small><h2>{item.materialName}</h2><p>{statusText(item)}</p></div><button onClick={onClose}>×</button></header><div className="cw-drawer-body"><div className="cw-facts"><span><small>作者</small><b>{item.authorName}</b></span><span><small>单品</small><b>{item.product || "—"}</b></span><span><small>优先级</small><b>{item.priority}</b></span><span><small>截止</small><b>{item.dueDate || "未设置"}</b></span></div>{item.feishuUrl && <a className="cw-doc-link" href={item.feishuUrl} target="_blank" rel="noreferrer"><span>飞书文档</span><strong>打开并查看完整内容</strong><b>↗</b></a>}{item.media.length > 0 && <VideoAnnotationWorkspace item={item} currentUser={currentUser} />}{item.contentType === "video" && decisionPanel}{item.note && <div className="cw-note"><small>发起说明</small><p>{item.note}</p></div>}
    {item.copy && <section className="cw-legacy-copy"><small>ARCHIVED SCRIPT</small><h3>脚本文案</h3><p>{item.copy}</p></section>}
    {item.reviewers.length > 0 && <section className="cw-route"><small>REVIEW ROUTE</small><h3>审核路径</h3>{item.reviewers.map((step) => <div key={step.id} className={step.status}><i>{step.stepOrder}</i><span><strong>{step.roleLabel}</strong><small>{step.reviewerName}</small></span><Badge tone={step.status === "passed" ? "success" : step.status === "returned" ? "danger" : step.status === "active" ? "active" : "plain"}>{step.status === "passed" ? "已通过" : step.status === "returned" ? "已退回" : step.status === "active" ? "审核中" : "等待"}</Badge>{step.comment && <p>{step.comment}</p>}</div>)}</section>}
    <section className="cw-history"><small>HISTORY</small><h3>审核记录与修改需求</h3>{item.events.map((event) => <div key={event.id}><i /><span><strong>{event.actorName} · {event.action === "submit" ? "提交审核" : event.action === "pass" ? "通过审核" : event.action === "return" ? "退回修改" : event.action === "resubmit" ? "重新提交" : "自动存档"}</strong><p>{event.comment || "无补充意见"}</p><time>{event.createdAt.replace("T", " ").slice(0, 16)}</time></span></div>)}</section>
    {item.contentType !== "video" && decisionPanel}
    {canDelete && <section className="cw-delete-zone"><div><small>DELETE MATERIAL</small><strong>删除这条{item.contentType === "video" ? "视频" : "文案"}</strong><p>退回和已存档内容均可删除；删除后不能恢复。</p></div><button disabled={busy} onClick={onDelete}>删除</button></section>}
  </div></aside></div>;
}

function DeleteConfirm({ item, busy, onCancel, onConfirm }: { item: Item; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  return <div className="cw-modal-bg cw-confirm-bg"><section className="cw-confirm"><span>!</span><small>DELETE CONFIRMATION</small><h2>确定删除“{item.materialName}”吗？</h2><p>{item.contentType === "video" ? "视频文件、历史版本、审核路径和审核记录" : "文案任务、审核路径和审核记录"}将被永久删除，无法恢复。</p><div><button disabled={busy} onClick={onCancel}>取消</button><button disabled={busy} onClick={onConfirm}>{busy ? "正在删除…" : "确认删除"}</button></div></section></div>;
}

function VideoAnnotationWorkspace({ item, currentUser }: { item: Item; currentUser: User }) {
  const orderedMedia = [...item.media].sort((a, b) => b.version - a.version || b.createdAt.localeCompare(a.createdAt));
  const [selectedId, setSelectedId] = useState(orderedMedia[0]?.id ?? "");
  const [comments, setComments] = useState<VideoComment[]>([]);
  const [draft, setDraft] = useState("");
  const [captured, setCaptured] = useState<{ time: number; preview: string; blob: Blob | null } | null>(null);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const selected = orderedMedia.find((media) => media.id === selectedId) ?? orderedMedia[0];
  const visibleComments = comments.filter((comment) => comment.mediaId === selected?.id);

  const loadComments = async () => {
    const response = await fetch(`${videoCommentsApi}?itemId=${encodeURIComponent(item.id)}`, { cache: "no-store" });
    const payload = await readApiPayload(response) as { comments?: VideoComment[]; error?: string };
    if (!response.ok) throw new Error(payload.error || "读取画面意见失败");
    setComments(payload.comments ?? []);
  };
  useEffect(() => { loadComments().catch((error) => setMessage(error.message)); }, [item.id]);
  useEffect(() => { setCaptured(null); setDraft(""); }, [selectedId]);

  const captureFrame = async () => {
    const video = videoRef.current;
    if (!video || !selected) return;
    video.pause();
    const time = video.currentTime || 0;
    let preview = "";
    let blob: Blob | null = null;
    if (video.readyState >= 2 && video.videoWidth && video.videoHeight) {
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 720 / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
      preview = canvas.toDataURL("image/jpeg", .78);
      blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", .78));
    }
    setCaptured({ time, preview, blob });
  };

  const saveComment = async () => {
    if (!selected || !captured || !draft.trim()) return;
    setSaving(true); setMessage("");
    try {
      const form = new FormData();
      form.append("itemId", item.id); form.append("mediaId", selected.id); form.append("timeSeconds", String(captured.time)); form.append("comment", draft.trim());
      if (captured.blob) form.append("screenshot", captured.blob, "frame.jpg");
      const response = await fetch(videoCommentsApi, { method: "POST", body: form });
      const payload = await readApiPayload(response);
      if (!response.ok) throw new Error(payload.error || "保存失败");
      await loadComments(); setCaptured(null); setDraft("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "保存失败"); } finally { setSaving(false); }
  };

  const toggleResolved = async (comment: VideoComment) => {
    const response = await fetch(videoCommentsApi, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: comment.id, status: comment.status === "resolved" ? "open" : "resolved" }) });
    const payload = await readApiPayload(response);
    if (!response.ok) return setMessage(payload.error || "更新失败");
    await loadComments();
  };

  const jumpTo = (time: number) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = time;
    videoRef.current.pause();
  };

  if (!selected) return null;
  return <section className="cw-video-review-workspace">
    <div className="cw-video-stage">
      <div className="cw-video-tabs">{orderedMedia.map((media) => <button key={media.id} className={media.id === selected.id ? "active" : ""} onClick={() => setSelectedId(media.id)}><b>V{media.version}</b><span>{media.originalName}</span></button>)}</div>
      <video key={selected.id} ref={videoRef} controls preload="metadata" src={`${base}${selected.url}`} />
      <div className="cw-video-stage-foot"><span><b>{selected.originalName}</b><small>{(selected.sizeBytes / 1024 / 1024).toFixed(1)} MB · V{selected.version}</small></span><button onClick={captureFrame}>＋ 在当前画面添加意见</button></div>
    </div>
    <aside className="cw-frame-comments">
      <header><div><small>FRAME COMMENTS</small><h3>画面修改意见</h3></div><span>{visibleComments.filter((entry) => entry.status !== "resolved").length} 条待处理</span></header>
      {captured && <div className="cw-frame-composer">{captured.preview ? <img src={captured.preview} alt="当前视频画面" /> : <div className="cw-frame-placeholder">当前画面</div>}<b>{formatVideoTime(captured.time)}</b><textarea autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="描述这个画面需要如何修改…" /><div><button onClick={() => { setCaptured(null); setDraft(""); }}>取消</button><button disabled={saving || !draft.trim()} onClick={saveComment}>{saving ? "保存中…" : "保存意见"}</button></div></div>}
      <div className="cw-frame-comment-list">{visibleComments.length ? visibleComments.map((comment) => <article key={comment.id} className={comment.status === "resolved" ? "resolved" : ""}><button className="cw-frame-jump" onClick={() => jumpTo(comment.timeSeconds)}>{comment.screenshotUrl ? <img src={`${base}${comment.screenshotUrl}`} alt="意见对应画面" /> : <span>▶</span>}<b>{formatVideoTime(comment.timeSeconds)}</b></button><div><p>{comment.comment}</p><small>{comment.authorName} · {comment.createdAt.replace("T", " ").slice(0, 16)}</small><button onClick={() => toggleResolved(comment)}>{comment.status === "resolved" ? "重新打开" : "标记已解决"}</button></div></article>) : <div className="cw-frame-empty"><span>◎</span><strong>暂时没有画面意见</strong><p>播放到需要修改的位置，点击“在当前画面添加意见”。</p></div>}</div>
      {message && <p className="cw-frame-error">{message}</p>}
    </aside>
  </section>;
}

function ProjectDrawer({ project, onClose, onOpenItem }: { project: Project; onClose: () => void; onOpenItem: (item: Item) => void }) {
  const rights = rightsStatus(project);
  const stages = [
    ["合作确认", project.decision === "推进" ? "已确认推进合作，继续完成权益与授权信息。" : `当前合作结论：${project.decision || "待判断"}`],
    ["内容生产", project.prepSummary || project.scriptSummary || "拉群、档期、酒店场地、妆造、脚本、分镜、拍摄团队与现场拍摄统一在此推进。"],
    ["成片审核", project.productionSummary || "样片回传后，分别记录内部审核、修改版本及艺人方审核进度。"],
    ["上线与一创再利用", project.firstCreationPlan || project.launchSummary || "记录正式上线、文案与框架裂变、混剪二创及下一轮优化方向。"],
  ];
  return <div className="cw-drawer-bg" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><aside className="cw-drawer project star-project"><header><div><small>{starType(project.projectType)} / {project.phase}</small><h2>{project.artistName} × {project.product} · {projectPeriod(project.projectPeriod)}</h2><p>下一节点：{project.nextMilestone || "待补充"}</p></div><button onClick={onClose}>×</button></header><div className="cw-drawer-body">
    <div className="cw-star-summary"><span><small>项目负责人</small><b>{project.owner}</b></span><span><small>明星档案建档人</small><b>{project.creatorName || project.owner}</b></span><span><small>当前阶段</small><b>{project.phase}</b></span><span><small>下一节点截止</small><b>{project.eta || "待定"}</b></span><span><small>授权状态</small><b className={rights.tone === "danger" ? "danger" : ""}>{rights.label}</b></span></div>
    <section className="cw-star-detail-section"><div className="cw-detail-heading"><div><small>STAR & COLLABORATION</small><h3>明星与合作信息</h3></div><Badge tone={project.decision === "推进" ? "success" : "plain"}>{project.decision || "推进"}</Badge></div><div className="cw-detail-grid"><span><small>明星类型</small><b>{starType(project.projectType)}</b></span><span><small>合作单品</small><b>{project.product}</b></span><span><small>实际合作费用</small><b>{project.actualFee || "待补充"}</b></span><span><small>判断人 / 时间</small><b>{project.decisionBy || project.owner}{project.decisionAt ? ` · ${project.decisionAt.slice(0, 10)}` : ""}</b></span></div><div className="cw-detail-copy"><small>价值判断与原因</small><p>{project.valueJudgement || "等待负责人补充本次选择、暂缓或不合作的价值判断。"}</p></div><div className="cw-detail-copy"><small>权益内容与素材使用范围</small><p>{project.rightsScope || "等待补充姓名、肖像、渠道及原片、混剪、二创等实际使用权益。"}</p><footer><span>授权起始 <b>{project.rightsStartDate || "待补充"}</b></span><span>授权到期 <b>{project.rightsEndDate || "待补充"}</b></span>{project.rightsFileUrl && <a href={project.rightsFileUrl} target="_blank" rel="noreferrer">查看授权文件 ↗</a>}</footer></div></section>
    <section className="cw-star-detail-section"><div className="cw-detail-heading"><div><small>EXECUTION PROGRESS</small><h3>项目执行进度</h3></div><Badge tone="active">{phaseProgress(project.phase)}%</Badge></div><div className="cw-key-dates"><span><small>计划拍摄</small><b>{project.shootDate || "待定"}</b></span><i>→</i><span><small>计划收片</small><b>{project.finalDate || "待定"}</b></span><i>→</i><span><small>计划上线</small><b>{project.launchDate || "待定"}</b></span></div><div className="cw-project-blocks cw-star-stages">{stages.map(([title, detail], index) => <section key={title} className={phaseProgress(project.phase) >= [10, 35, 60, 80][index] ? "active" : ""}><i>0{index + 1}</i><small>PROJECT STAGE</small><h3>{title}</h3><p>{detail}</p></section>)}</div></section>
    <section className="cw-linked"><small>LINKED REVIEW TASKS</small><h3>关联脚本与视频审核</h3>{project.linkedItems.length ? project.linkedItems.map((item) => <TaskCard key={item.id} item={item} onOpen={onOpenItem} />) : <Empty title="暂无关联审核任务" detail="发起脚本或视频审核时填写明星姓名，即可自动汇入该明星项目。" />}</section>
  </div></aside></div>;
}
