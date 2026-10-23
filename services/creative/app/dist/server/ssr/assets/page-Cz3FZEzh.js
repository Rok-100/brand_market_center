import { a as require_react, o as __toESM, t as require_jsx_runtime } from "../index.js";
//#region app/creative-workbench/workbench.css
var import_react = /* @__PURE__ */ __toESM(require_react(), 1);
//#endregion
//#region lib/calendar.ts
var CALENDAR_STAGES = [
	"待拍摄",
	"已拍摄",
	"待发布",
	"已发布"
];
function chinaToday(now = /* @__PURE__ */ new Date()) {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: "Asia/Shanghai",
		year: "numeric",
		month: "2-digit",
		day: "2-digit"
	}).format(now);
}
function overdueReasons(item, today = chinaToday()) {
	const reasons = [];
	if (item.shootingDate && item.shootingDate < today && ![
		"已拍摄",
		"待发布",
		"已发布"
	].includes(item.stage)) reasons.push("拍摄日期已过，请确认拍摄进度");
	if (item.launchDate && item.launchDate < today && item.stage !== "已发布") reasons.push("发布日期已过，请确认上线进度");
	return reasons;
}
function safeCalendarUrl(value) {
	try {
		const url = new URL(value);
		return ["https:", "http:"].includes(url.protocol) ? url.href : "";
	} catch {
		return "";
	}
}
//#endregion
//#region app/creative-workbench/page.tsx
var import_jsx_runtime = require_jsx_runtime();
var SCRIPT_TYPES = [
	"付费KOC脚本",
	"唠嗑KOC脚本",
	"明星脚本",
	"AI脚本",
	"自产脚本",
	"混剪脚本",
	"剧情脚本"
];
var WRITING_SCRIPT_TYPES = [
	"付费KOC脚本",
	"唠嗑KOC脚本",
	"明星原片脚本",
	"明星营销号脚本",
	"视频号脚本"
];
var PRODUCTS = [
	"眼膜",
	"水润面膜",
	"水油/蛋白喷雾",
	"美白针",
	"黄金面膜",
	"黑晶面膜",
	"燕窝面膜",
	"次抛精华"
];
var STAR_TYPES = [
	"长期品牌向明星",
	"信息流明星",
	"AI授权明星"
];
var STAR_PHASES = [
	"明星评估",
	"市场部议价",
	"营销端确认",
	"内容生产",
	"内部样片审核",
	"艺人方审核",
	"收片待上线",
	"已上线",
	"一创再利用",
	"已完成"
];
var MATERIAL_TYPES = [
	"唠嗑KOC原片",
	"唠嗑KOC AI",
	"付费KOC原片",
	"明星原片"
];
var NAV = [
	{
		id: "mine",
		index: "01",
		cn: "我的工作台",
		en: "MY DESK"
	},
	{
		id: "writing",
		index: "02",
		cn: "脚本写作",
		en: "SCRIPT WRITING"
	},
	{
		id: "calendar",
		index: "03",
		cn: "营销日历",
		en: "MARKETING CALENDAR"
	},
	{
		id: "scriptReview",
		index: "04",
		cn: "脚本审核中心",
		en: "SCRIPT REVIEW"
	},
	{
		id: "scriptLibrary",
		index: "05",
		cn: "脚本内容库",
		en: "SCRIPT LIBRARY"
	},
	{
		id: "videoReview",
		index: "06",
		cn: "视频审核中心",
		en: "VIDEO REVIEW"
	},
	{
		id: "videoLibrary",
		index: "07",
		cn: "视频内容库",
		en: "VIDEO LIBRARY"
	},
	{
		id: "projects",
		index: "08",
		cn: "明星合作中心",
		en: "STAR COLLABORATION"
	}
];
var base = "/yxb/wis-marketing-hub/modules/creative-hub/".replace(/\/$/, "");
var api = `${base}/api/creative-workbench`;
var videoApi = `${base}/api/creative-workbench-videos`;
var videoCommentsApi = `${base}/api/video-comments`;
var artistProjectsApi = `${base}/api/artist-projects`;
var collaborationsApi = `${base}/api/collaborations`;
var scriptsApi = `${base}/api/scripts`;
var oldPlatformUrl = base.includes("/fd-023794/creative-workbench") ? "/fd-023794/idea-os-creative/" : base || "/";
function videoTypeText(value) {
	return value.replace(/脚本$/, "视频");
}
function starType(value) {
	if (value === "AI艺人") return "AI授权明星";
	if (value === "实拍艺人") return "信息流明星";
	return STAR_TYPES.includes(value) ? value : "信息流明星";
}
function projectPeriod(value) {
	const match = value.match(/^(\d{4})-(\d{2})/);
	return match ? `${match[1]}年${Number(match[2])}月` : value || "时间待定";
}
function phaseProgress(value) {
	const normalized = value.includes("议价") ? "市场部议价" : value.includes("营销") ? "营销端确认" : value.includes("上线追投") ? "一创再利用" : value.includes("上线") ? "已上线" : value.includes("成片") || value.includes("初审") ? "内部样片审核" : value.includes("拍摄") || value.includes("筹备") ? "内容生产" : value;
	const index = STAR_PHASES.indexOf(normalized);
	return index < 0 ? 18 : Math.max(8, Math.round((index + 1) / STAR_PHASES.length * 100));
}
function rightsStatus(project) {
	if (!project.rightsEndDate) return {
		label: "授权日期待补充",
		tone: "plain",
		days: null
	};
	const end = (/* @__PURE__ */ new Date(`${project.rightsEndDate}T23:59:59+08:00`)).getTime();
	const days = Math.ceil((end - Date.now()) / 864e5);
	if (days < 0) return {
		label: `授权已到期 ${Math.abs(days)} 天`,
		tone: "danger",
		days
	};
	if (days <= 30) return {
		label: `授权剩余 ${days} 天`,
		tone: "danger",
		days
	};
	if (days <= 90) return {
		label: `授权剩余 ${days} 天`,
		tone: "active",
		days
	};
	return {
		label: `授权至 ${project.rightsEndDate}`,
		tone: "success",
		days
	};
}
function deadlineStatus(project) {
	const value = project.eta || project.launchDate || project.finalDate || project.shootDate;
	if (!value) return {
		label: "截止时间待定",
		tone: "plain",
		days: null
	};
	const target = (/* @__PURE__ */ new Date(`${value}T23:59:59+08:00`)).getTime();
	const days = Math.ceil((target - Date.now()) / 864e5);
	if (days < 0) return {
		label: `已超期 ${Math.abs(days)} 天`,
		tone: "danger",
		days
	};
	if (days === 0) return {
		label: "今天截止",
		tone: "danger",
		days
	};
	if (days <= 3) return {
		label: `还有 ${days} 天`,
		tone: "danger",
		days
	};
	return {
		label: `还有 ${days} 天`,
		tone: "active",
		days
	};
}
function formatVideoTime(value) {
	const minutes = Math.floor(value / 60);
	const seconds = value - minutes * 60;
	return `${String(minutes).padStart(2, "0")}:${seconds.toFixed(1).padStart(4, "0")}`;
}
async function readApiPayload(response) {
	if ((response.headers.get("content-type") ?? "").includes("application/json")) return await response.json();
	const message = (await response.text()).trim();
	if (response.status === 413) return { error: "视频超过当前上传通道限制，请压缩文件或分开上传后重试" };
	return { error: message || `请求失败（${response.status}）` };
}
var VIDEO_CHUNK_SIZE = 8 * 1024 * 1024;
var VIDEO_UPLOAD_CONCURRENCY = 4;
async function uploadVideoFiles({ mode, itemId, metadata, comment, files, onProgress }) {
	const fileDescriptors = files.map((file) => ({
		originalName: file.name,
		mimeType: file.type || (/\.mov$/i.test(file.name) ? "video/quicktime" : "video/mp4"),
		sizeBytes: file.size
	}));
	const initResponse = await fetch(videoApi, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			action: "init",
			mode,
			itemId,
			metadata,
			files: fileDescriptors
		})
	});
	const initPayload = await readApiPayload(initResponse);
	if (!initResponse.ok || !initPayload.itemId || !initPayload.version || !initPayload.uploads || initPayload.uploads.length !== files.length) throw new Error(initPayload.error || "无法建立视频上传任务");
	try {
		let uploadedBytes = 0;
		const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
		const completedUploads = [];
		for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
			const file = files[fileIndex];
			const session = initPayload.uploads[fileIndex];
			const partCount = Math.ceil(file.size / VIDEO_CHUNK_SIZE);
			const parts = new Array(partCount);
			let nextPartIndex = 0;
			const uploadWorker = async () => {
				while (nextPartIndex < partCount) {
					const partIndex = nextPartIndex;
					nextPartIndex += 1;
					const partNumber = partIndex + 1;
					const offset = partIndex * VIDEO_CHUNK_SIZE;
					const chunk = file.slice(offset, Math.min(offset + VIDEO_CHUNK_SIZE, file.size));
					const query = new URLSearchParams({
						key: session.key,
						uploadId: session.uploadId,
						partNumber: String(partNumber)
					});
					let partResponse = null;
					for (let attempt = 1; attempt <= 3; attempt += 1) {
						partResponse = await fetch(`${videoApi}?${query}`, {
							method: "PUT",
							body: chunk
						});
						if (partResponse.ok || attempt === 3) break;
						await new Promise((resolve) => window.setTimeout(resolve, attempt * 500));
					}
					const partPayload = await readApiPayload(partResponse);
					if (!partResponse.ok || !partPayload.partNumber || !partPayload.etag) throw new Error(partPayload.error || `${file.name} 上传中断，请重试`);
					parts[partIndex] = {
						partNumber: partPayload.partNumber,
						etag: partPayload.etag
					};
					uploadedBytes += chunk.size;
					onProgress?.(`正在上传 ${file.name} · ${Math.min(100, Math.round(uploadedBytes / totalBytes * 100))}%`);
				}
			};
			await Promise.all(Array.from({ length: Math.min(VIDEO_UPLOAD_CONCURRENCY, partCount) }, () => uploadWorker()));
			completedUploads.push({
				...session,
				parts
			});
		}
		onProgress?.("正在合并视频并创建审核任务…");
		const completeResponse = await fetch(videoApi, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				action: "complete",
				mode,
				itemId: initPayload.itemId,
				version: initPayload.version,
				metadata,
				comment,
				uploads: completedUploads
			})
		});
		const completePayload = await readApiPayload(completeResponse);
		if (!completeResponse.ok) throw new Error(completePayload.error || "视频合并或提交失败");
		return completePayload;
	} catch (error) {
		await fetch(videoApi, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				action: "abort",
				uploads: initPayload.uploads
			})
		}).catch(() => void 0);
		throw error;
	}
}
function greeting(name) {
	const hour = (/* @__PURE__ */ new Date()).getHours();
	if (hour < 6) return `${name}，夜深了，辛苦啦。`;
	if (hour < 11) return `${name}，早上好！`;
	if (hour < 14) return `${name}，中午好！`;
	if (hour < 18) return `${name}，下午好！`;
	return `${name}，晚上好！`;
}
function statusText(item) {
	if (item.status === "returned") return "已退回，等待修改";
	if (item.status === "archived") return "全部通过，已自动存档";
	const active = item.reviewers.find((step) => step.status === "active");
	const passed = item.reviewers.filter((step) => step.status === "passed").length;
	return active ? `${passed}/${item.reviewers.length} 已通过 · 待${active.reviewerName}审核` : "等待审核";
}
function Badge({ children, tone = "plain" }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
		className: `cw-badge ${tone}`,
		children
	});
}
function PeoplePicker({ label, users, value, onChange }) {
	const selected = users.find((user) => user.id === value);
	const [query, setQuery] = (0, import_react.useState)(selected?.name ?? "");
	const suggestions = query.trim() ? users.filter((user) => user.name.includes(query.trim()) && user.id !== value).slice(0, 6) : [];
	(0, import_react.useEffect)(() => {
		setQuery(selected?.name ?? "");
	}, [selected?.name]);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
		className: "cw-field cw-people",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: label }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
				value: query,
				placeholder: "输入姓名查找",
				onChange: (event) => {
					setQuery(event.target.value);
					if (selected && event.target.value !== selected.name) onChange("");
				}
			}),
			suggestions.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "cw-suggestions",
				children: suggestions.map((user) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
					type: "button",
					onClick: () => {
						onChange(user.id);
						setQuery(user.name);
					},
					children: [user.name, /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: user.department || "品牌营销部" })]
				}, user.id))
			})
		]
	});
}
function TaskCard({ item, onOpen }) {
	const tone = item.status === "returned" ? "danger" : item.status === "archived" ? "success" : "active";
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
		className: "cw-task",
		onClick: () => onOpen(item),
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
				className: "cw-task-code",
				children: [item.id.slice(-4), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", {})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
				className: "cw-task-main",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: item.contentType === "video" ? `视频审核 / ${videoTypeText(item.scriptType)}` : `${item.reviewSection} / ${item.scriptType || item.cooperationType || "方案"}` }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: item.materialName }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("em", { children: [
						item.artistName ? `${item.artistName} · ` : "",
						item.product || "未设置单品",
						item.contentType === "video" ? ` · ${item.media.length} 个视频` : ""
					] })
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
				className: "cw-task-meta",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "作者" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: item.authorName })]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
				className: "cw-task-meta",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "审核进度" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("strong", { children: [
					item.reviewers.filter((step) => step.status === "passed").length,
					"/",
					item.reviewers.length
				] })]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
				className: "cw-task-state",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Badge, {
					tone,
					children: statusText(item)
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: item.dueDate ? `${item.dueDate} 截止` : "未设置截止时间" })]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "cw-arrow",
				children: "↗"
			})
		]
	});
}
function Empty({ title, detail }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "cw-empty",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "◇" }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: title }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: detail })
		]
	});
}
function CreativeWorkbench() {
	const [data, setData] = (0, import_react.useState)(null);
	const [nav, setNav] = (0, import_react.useState)("mine");
	const [mineTab, setMineTab] = (0, import_react.useState)("submitted");
	const [section, setSection] = (0, import_react.useState)("文案审核");
	const [type, setType] = (0, import_react.useState)("全部类型");
	const [keyword, setKeyword] = (0, import_react.useState)("");
	const [selected, setSelected] = (0, import_react.useState)(null);
	const [project, setProject] = (0, import_react.useState)(null);
	const [projectView, setProjectView] = (0, import_react.useState)("overview");
	const [projectTypeFilter, setProjectTypeFilter] = (0, import_react.useState)("全部类型");
	const [projectCreateOpen, setProjectCreateOpen] = (0, import_react.useState)(false);
	const [collaborations, setCollaborations] = (0, import_react.useState)([]);
	const [calendarCreateOpen, setCalendarCreateOpen] = (0, import_react.useState)(false);
	const [calendarBatchOpen, setCalendarBatchOpen] = (0, import_react.useState)(false);
	const [calendarEditing, setCalendarEditing] = (0, import_react.useState)(null);
	const [calendarDetail, setCalendarDetail] = (0, import_react.useState)(null);
	const [reminderDismissedUntil, setReminderDismissedUntil] = (0, import_react.useState)(0);
	const [reminderClock, setReminderClock] = (0, import_react.useState)(Date.now());
	(0, import_react.useEffect)(() => {
		const timer = setInterval(() => {
			setReminderClock(Date.now());
			loadCollaborations().catch(() => {});
		}, 6e4);
		return () => clearInterval(timer);
	}, []);
	const [submitOpen, setSubmitOpen] = (0, import_react.useState)(false);
	const [videoSubmitOpen, setVideoSubmitOpen] = (0, import_react.useState)(false);
	const [deleteTarget, setDeleteTarget] = (0, import_react.useState)(null);
	const [message, setMessage] = (0, import_react.useState)("");
	const [busy, setBusy] = (0, import_react.useState)(false);
	const load = async () => {
		const response = await fetch(api, { cache: "no-store" });
		const payload = await response.json();
		if (!response.ok) throw new Error(payload.error || "读取失败");
		setData(payload);
		if (selected) setSelected(payload.items.find((item) => item.id === selected.id) ?? null);
	};
	const loadCollaborations = async () => {
		const response = await fetch(collaborationsApi, { cache: "no-store" });
		const payload = await response.json();
		if (!response.ok) throw new Error(payload.error || "达人进度读取失败");
		setCollaborations(payload.items ?? []);
	};
	(0, import_react.useEffect)(() => {
		Promise.all([load(), loadCollaborations()]).catch((error) => setMessage(error.message));
	}, []);
	const filtered = (0, import_react.useMemo)(() => (data?.items ?? []).filter((item) => {
		if (item.contentType === "video") return false;
		const matchesSection = item.reviewSection === section;
		const matchesType = section !== "文案审核" || type === "全部类型" || item.scriptType === type;
		const matchesKeyword = `${item.materialName}${item.authorName}${item.product}${item.artistName}`.includes(keyword);
		return matchesSection && matchesType && matchesKeyword;
	}), [
		data,
		section,
		type,
		keyword
	]);
	const library = (0, import_react.useMemo)(() => (data?.library ?? []).filter((item) => {
		if (item.contentType === "video") return false;
		return (type === "全部类型" || (type.endsWith("审核") ? item.reviewSection === type : item.scriptType === type)) && `${item.materialName}${item.authorName}${item.product}${item.artistName}`.includes(keyword);
	}), [
		data,
		type,
		keyword
	]);
	const videoTasks = (0, import_react.useMemo)(() => (data?.items ?? []).filter((item) => item.contentType === "video" && `${item.materialName}${item.authorName}${item.product}${item.artistName}`.includes(keyword)), [data, keyword]);
	const videoLibrary = (0, import_react.useMemo)(() => (data?.library ?? []).filter((item) => item.contentType === "video" && `${item.materialName}${item.authorName}${item.product}${item.artistName}`.includes(keyword)), [data, keyword]);
	const myLaunchReminders = (0, import_react.useMemo)(() => collaborations.filter((entry) => (entry.ownerId ? entry.ownerId === data?.user.id : entry.owner === data?.user.name) && overdueReasons(entry).length), [
		collaborations,
		data?.user.id,
		data?.user.name,
		reminderClock
	]);
	const action = async (actionName, comment) => {
		if (!selected) return;
		setBusy(true);
		try {
			const response = await fetch(api, {
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					id: selected.id,
					action: actionName,
					comment
				})
			});
			const payload = await response.json();
			if (!response.ok) throw new Error(payload.error || "操作失败");
			await load();
			setMessage(actionName === "return" ? "素材已退回" : actionName === "resubmit" ? "已重新提交审核" : "审核已通过");
		} catch (error) {
			setMessage(error instanceof Error ? error.message : "操作失败");
		} finally {
			setBusy(false);
		}
	};
	const videoResubmit = async (files, comment) => {
		if (!selected) return;
		setBusy(true);
		try {
			await uploadVideoFiles({
				mode: "revision",
				itemId: selected.id,
				comment,
				files,
				onProgress: setMessage
			});
			await load();
			setMessage("新版本视频已上传并重新提交审核");
		} catch (error) {
			setMessage(error instanceof Error ? error.message : "新版本上传失败");
		} finally {
			setBusy(false);
		}
	};
	const deleteItem = async () => {
		if (!deleteTarget) return;
		setBusy(true);
		try {
			const response = await fetch(api, {
				method: "DELETE",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ id: deleteTarget.id })
			});
			const payload = await readApiPayload(response);
			if (!response.ok) throw new Error(payload.error || "删除失败");
			setSelected(null);
			setDeleteTarget(null);
			await load();
			setMessage(`${deleteTarget.contentType === "video" ? "视频" : "文案"}已删除`);
		} catch (error) {
			setMessage(error instanceof Error ? error.message : "删除失败");
		} finally {
			setBusy(false);
		}
	};
	if (!data) return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "cw-loading",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "IO" }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "正在进入创意创作台" }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: message || "连接工作空间与身份信息…" })
		]
	});
	const mineTabs = [
		[
			"submitted",
			"我提交的",
			data.counts.submitted
		],
		[
			"assigned",
			"待我审核",
			data.counts.assigned
		],
		[
			"returned",
			"退回待修改",
			data.counts.returned
		],
		[
			"dueSoon",
			"即将超期",
			data.counts.dueSoon
		],
		[
			"participating",
			"我参与的项目",
			data.counts.participating
		]
	];
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "cw-shell",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("aside", {
				className: "cw-sidebar",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
						className: "cw-brand",
						onClick: () => setNav("writing"),
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "IO" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "创意创作台" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "CREATIVE WORKBENCH" })] })]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "cw-space",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "WORKSPACE / 02" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "内容审核与协作" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "CONTENT OPERATIONS" })
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "cw-nav-label",
						children: "工作空间"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("nav", { children: NAV.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
						className: nav === item.id ? "active" : "",
						onClick: () => setNav(item.id),
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { children: item.index }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: item.cn }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: item.en })] }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "↗" })
						]
					}, item.id)) }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "cw-side-foot",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
								className: "cw-online",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", {}), " WORKSPACE ONLINE"]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "cw-person",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("em", { children: data.user.name.slice(0, 1) }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: data.user.name }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "品牌营销部" })] })]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("a", {
								href: oldPlatformUrl,
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "返回创意中枢系统" }), " ↗"]
							})
						]
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
				className: "cw-main",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
						className: "cw-top",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "FANDOW · CREATIVE OPERATIONS" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: NAV.find((item) => item.id === nav)?.cn })] }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "⌕" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
								value: keyword,
								onChange: (event) => setKeyword(event.target.value),
								placeholder: "搜索素材、作者、艺人或单品"
							})] }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("time", { children: new Intl.DateTimeFormat("zh-CN", {
								month: "2-digit",
								day: "2-digit",
								weekday: "short"
							}).format(/* @__PURE__ */ new Date()) })
						]
					}),
					nav === "mine" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
						className: "cw-page",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "cw-hero",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "GOOD DAY / PERSONAL DESK" }),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", { children: greeting(data.user.name) }),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "今天的脚本、视频、审核和协作进度已经为你归拢。" })
									] }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
										className: "cw-hero-actions",
										children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
											onClick: () => setSubmitOpen(true),
											children: "＋ 脚本审核"
										}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
											onClick: () => setVideoSubmitOpen(true),
											children: "＋ 视频审核"
										})]
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "cw-orbit" })
								]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "cw-mine-tabs",
								children: mineTabs.map(([id, label, count]) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
									className: mineTab === id ? "active" : "",
									onClick: () => setMineTab(id),
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: String(count).padStart(2, "0") }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: label })]
								}, id))
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "cw-section-head",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "FOCUS QUEUE" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: mineTabs.find(([id]) => id === mineTab)?.[1] })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [data.mine[mineTab]?.length ?? 0, " 条任务"] })]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "cw-list",
								children: (data.mine[mineTab] ?? []).length ? data.mine[mineTab].map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TaskCard, {
									item,
									onOpen: setSelected
								}, item.id)) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Empty, {
									title: "这里暂时没有任务",
									detail: "新的工作会在进入你的流程后自动出现。"
								})
							})
						]
					}),
					nav === "scriptReview" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
						className: "cw-page",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "cw-page-title",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "SCRIPT REVIEW / LIVE WORKFLOW" }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", { children: "脚本审核中心" }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "用飞书承载脚本与方案，在这里完成路径、意见和决策。" })
								] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
									onClick: () => setSubmitOpen(true),
									children: "＋ 发起脚本审核"
								})]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "cw-section-switch",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
										className: section === "文案审核" ? "active" : "",
										onClick: () => setSection("文案审核"),
										children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "01" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: ["文案审核", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "脚本与内容" })] })]
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
										className: section === "拍摄场地审核" ? "active" : "",
										onClick: () => setSection("拍摄场地审核"),
										children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "02" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: ["拍摄场地审核", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "酒店与场地方案" })] })]
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
										className: section === "妆造方案审核" ? "active" : "",
										onClick: () => setSection("妆造方案审核"),
										children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "03" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: ["妆造方案审核", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "妆发与服装方案" })] })]
									})
								]
							}),
							section === "文案审核" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "cw-filter",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
									className: type === "全部类型" ? "active" : "",
									onClick: () => setType("全部类型"),
									children: "全部"
								}), SCRIPT_TYPES.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
									className: type === entry ? "active" : "",
									onClick: () => setType(entry),
									children: entry
								}, entry))]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "cw-section-head",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "REVIEW QUEUE" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: section })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [filtered.length, " 条任务"] })]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "cw-list",
								children: filtered.length ? filtered.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TaskCard, {
									item,
									onOpen: setSelected
								}, item.id)) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Empty, {
									title: "当前筛选下暂无任务",
									detail: "可以调整筛选，或发起一条新的审核任务。"
								})
							})
						]
					}),
					nav === "scriptLibrary" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
						className: "cw-page",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "cw-page-title",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "SCRIPT CONTENT / APPROVED ONLY" }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", { children: "脚本内容库" }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "只收录经过全部审核人确认的最终脚本与方案。" })
								] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Badge, {
									tone: "success",
									children: [library.length, " 条已存档"]
								})]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "cw-filter",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
										className: type === "全部类型" ? "active" : "",
										onClick: () => setType("全部类型"),
										children: "全部内容"
									}),
									SCRIPT_TYPES.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
										className: type === entry ? "active" : "",
										onClick: () => setType(entry),
										children: entry
									}, entry)),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
										onClick: () => setType("拍摄场地审核"),
										children: "拍摄场地"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
										onClick: () => setType("妆造方案审核"),
										children: "妆造方案"
									})
								]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "cw-library-head",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "合作类型" }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "素材名称" }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "作者" }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "单品" }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "存档时间" }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {})
								]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "cw-library",
								children: library.length ? library.map((item) => item.feishuUrl ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("a", {
									href: item.feishuUrl,
									target: "_blank",
									rel: "noreferrer",
									children: [
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Badge, { children: item.cooperationType || item.reviewSection }),
										/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("strong", { children: [item.materialName, /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: item.scriptType || item.reviewSection })] }),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: item.authorName }),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: item.product || "—" }),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("time", { children: item.archivedAt ? item.archivedAt.slice(0, 10) : "—" }),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "打开文档 ↗" })
									]
								}, item.id) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
									className: "cw-library-legacy",
									onClick: () => setSelected(item),
									children: [
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Badge, { children: item.cooperationType || "历史案例" }),
										/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("strong", { children: [item.materialName, /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: item.scriptType })] }),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: item.authorName }),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: item.product || "—" }),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("time", { children: item.archivedAt ? item.archivedAt.slice(0, 10) : "—" }),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "查看文案 ↗" })
									]
								}, item.id)) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Empty, {
									title: "内容库等待第一份合格素材",
									detail: "全部审核人通过后，素材会自动出现在这里。"
								})
							})
						]
					}),
					nav === "videoReview" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
						className: "cw-page",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "cw-page-title",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "VIDEO REVIEW / LIVE WORKFLOW" }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", { children: "视频审核中心" }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "一条任务可包含多个成片，沿用与脚本一致的逐级审核路径。" })
								] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
									onClick: () => setVideoSubmitOpen(true),
									children: "＋ 发起视频审核"
								})]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "cw-filter",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
									className: type === "全部类型" ? "active" : "",
									onClick: () => setType("全部类型"),
									children: "全部视频"
								}), SCRIPT_TYPES.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
									className: type === entry ? "active" : "",
									onClick: () => setType(entry),
									children: videoTypeText(entry)
								}, entry))]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "cw-section-head",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "VIDEO REVIEW QUEUE" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "成片审核任务" })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [videoTasks.length, " 条任务"] })]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "cw-list",
								children: videoTasks.length ? videoTasks.filter((item) => type === "全部类型" || item.scriptType === type).map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TaskCard, {
									item,
									onOpen: setSelected
								}, item.id)) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Empty, {
									title: "暂时没有视频审核任务",
									detail: "上传 MP4 或 MOV 成片后，任务会在这里按审核路径流转。"
								})
							})
						]
					}),
					nav === "videoLibrary" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
						className: "cw-page",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "cw-page-title",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "VIDEO CONTENT / APPROVED ONLY" }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", { children: "视频内容库" }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "所有审核人通过后，成片及其历史版本自动沉淀在这里。" })
							] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Badge, {
								tone: "success",
								children: [videoLibrary.length, " 条已存档"]
							})]
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "cw-video-library",
							children: videoLibrary.length ? videoLibrary.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
								onClick: () => setSelected(item),
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
										className: "cw-video-cover",
										children: ["▶", /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("small", { children: [item.media.length, " 个视频"] })]
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
										/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("small", { children: [
											videoTypeText(item.scriptType),
											" · ",
											item.product || "未设置单品"
										] }),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: item.materialName }),
										/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("em", { children: [item.artistName ? `${item.artistName} · ` : "", item.authorName] })
									] }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("time", { children: item.archivedAt.slice(0, 10) }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "查看成片 ↗" })
								]
							}, item.id)) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Empty, {
								title: "视频内容库等待第一组成片",
								detail: "全部审核人通过后，视频会连同历史版本自动存档。"
							})
						})]
					}),
					nav === "projects" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StarCollaborationCenter, {
						projects: data.projects,
						keyword,
						view: projectView,
						onView: setProjectView,
						typeFilter: projectTypeFilter,
						onTypeFilter: setProjectTypeFilter,
						onCreate: () => setProjectCreateOpen(true),
						onOpen: setProject
					}),
					nav === "calendar" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(MarketingCalendar, {
						entries: collaborations,
						keyword,
						currentUser: data.user,
						onCreate: () => setCalendarCreateOpen(true),
						onBatch: () => setCalendarBatchOpen(true),
						onOpen: setCalendarDetail,
						onEdit: setCalendarEditing,
						onDelete: async (entry) => {
							if (!window.confirm(`确定删除“${entry.creatorName}”这条素材档期吗？删除后无法恢复。`)) return;
							const response = await fetch(`${collaborationsApi}?id=${encodeURIComponent(entry.id)}`, { method: "DELETE" });
							const payload = await response.json();
							if (!response.ok) return setMessage(payload.error || "删除失败");
							await loadCollaborations();
							setMessage("素材档期已删除");
						}
					}),
					nav === "writing" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ScriptWritingCenter, {
						library: data.library,
						onMessage: setMessage
					})
				]
			}),
			submitOpen && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SubmitModal, {
				users: data.users,
				currentUser: data.user,
				onClose: () => setSubmitOpen(false),
				onCreated: async () => {
					setSubmitOpen(false);
					await load();
					setNav("scriptReview");
					setMessage("脚本审核任务已发起");
				}
			}),
			videoSubmitOpen && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(VideoSubmitModal, {
				users: data.users,
				currentUser: data.user,
				onClose: () => setVideoSubmitOpen(false),
				onCreated: async () => {
					setVideoSubmitOpen(false);
					await load();
					setNav("videoReview");
					setType("全部类型");
					setMessage("视频审核任务已发起");
				}
			}),
			projectCreateOpen && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ArtistProjectModal, {
				users: data.users,
				currentUser: data.user,
				onClose: () => setProjectCreateOpen(false),
				onCreated: async () => {
					setProjectCreateOpen(false);
					await load();
					setNav("projects");
					setProjectView("overview");
					setMessage("明星合作项目已建立");
				}
			}),
			calendarCreateOpen && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CalendarEntryModal, {
				items: [...data.items, ...data.library],
				users: data.users,
				currentUser: data.user,
				onClose: () => setCalendarCreateOpen(false),
				onSaved: async () => {
					setCalendarCreateOpen(false);
					await loadCollaborations();
					setNav("calendar");
					setMessage("素材档期已加入营销日历");
				}
			}),
			calendarEditing && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CalendarEntryModal, {
				items: [...data.items, ...data.library],
				users: data.users,
				currentUser: data.user,
				item: calendarEditing,
				onClose: () => setCalendarEditing(null),
				onSaved: async () => {
					setCalendarEditing(null);
					await loadCollaborations();
					setMessage("素材档期已更新");
				}
			}),
			calendarBatchOpen && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CalendarBatchModal, {
				users: data.users,
				currentUser: data.user,
				onClose: () => setCalendarBatchOpen(false),
				onSaved: async (count) => {
					setCalendarBatchOpen(false);
					await loadCollaborations();
					setNav("calendar");
					setMessage(`已批量录入 ${count} 条真实档期`);
				}
			}),
			selected && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ReviewDrawer, {
				item: selected,
				currentUser: data.user,
				busy,
				onClose: () => setSelected(null),
				onAction: action,
				onVideoResubmit: videoResubmit,
				onDelete: () => setDeleteTarget(selected)
			}),
			deleteTarget && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(DeleteConfirm, {
				item: deleteTarget,
				busy,
				onCancel: () => !busy && setDeleteTarget(null),
				onConfirm: deleteItem
			}),
			project && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ProjectDrawer, {
				project,
				onClose: () => setProject(null),
				onOpenItem: (item) => {
					setProject(null);
					setSelected(item);
				}
			}),
			calendarDetail && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CalendarDetail, {
				item: collaborations.find((entry) => entry.id === calendarDetail.id) || calendarDetail,
				items: [...data.items, ...data.library],
				onClose: () => setCalendarDetail(null),
				onEdit: () => {
					setCalendarEditing(collaborations.find((entry) => entry.id === calendarDetail.id) || calendarDetail);
					setCalendarDetail(null);
				},
				onOpenItem: (item) => {
					setCalendarDetail(null);
					setSelected(item);
				}
			}),
			myLaunchReminders.length > 0 && reminderClock >= reminderDismissedUntil && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("aside", {
				className: "cw-overdue-toast",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						className: "cw-reminder-dismiss",
						"aria-label": "一小时后再提醒",
						onClick: () => setReminderDismissedUntil(Date.now() + 36e5),
						children: "稍后提醒 ×"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("strong", { children: [myLaunchReminders.length, " 项达人进度待确认"] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "档期已过，请核实实际进度，不代表已确认延期。" }),
					myLaunchReminders.slice(0, 3).map((entry) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
						onClick: () => {
							setNav("calendar");
							setCalendarDetail(entry);
						},
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("b", { children: [
							entry.creatorName,
							" · ",
							entry.product
						] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [overdueReasons(entry).join("；"), " ↗"] })]
					}, entry.id))
				]
			}),
			message && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
				className: "cw-toast",
				onClick: () => setMessage(""),
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", {}), message]
			})
		]
	});
}
function calendarIds(value) {
	try {
		const ids = JSON.parse(value || "[]");
		return Array.isArray(ids) ? ids : [];
	} catch {
		return [];
	}
}
function CalendarLinkPicker({ items, value, onChange }) {
	const [search, setSearch] = (0, import_react.useState)("");
	const ids = calendarIds(value);
	const unique = [...new Map(items.map((item) => [item.id, item])).values()];
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
		className: "cw-calendar-links",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "关联已有脚本 / 视频" }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
				placeholder: "搜索素材名称、达人或作者",
				value: search,
				onChange: (e) => setSearch(e.target.value)
			}),
			ids.map((id) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
				type: "button",
				onClick: () => onChange(JSON.stringify(ids.filter((x) => x !== id))),
				children: [unique.find((item) => item.id === id)?.materialName || id, " ×"]
			}, id)),
			search && unique.filter((item) => !ids.includes(item.id) && `${item.materialName} ${item.artistName} ${item.authorName}`.includes(search)).slice(0, 12).map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
				type: "button",
				onClick: () => {
					onChange(JSON.stringify([...ids, item.id]));
					setSearch("");
				},
				children: [
					"＋ ",
					item.contentType === "video" ? "视频" : "脚本",
					" · ",
					item.materialName,
					" · ",
					item.authorName
				]
			}, item.id))
		]
	});
}
function CalendarDetail({ item, items, onClose, onEdit, onOpenItem }) {
	const linked = calendarIds(item.linkedItemIds);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "cw-modal-bg",
		onMouseDown: (e) => e.target === e.currentTarget && onClose(),
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
			className: "cw-modal cw-calendar-detail",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("small", { children: ["MATERIAL DETAIL · ", item.id] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h2", { children: [
						item.creatorName,
						" · ",
						item.product
					] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { children: [
						item.materialType,
						" · 负责人：",
						item.owner || "待分配"
					] })
				] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					onClick: onClose,
					"aria-label": "关闭详情",
					children: "×"
				})] }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "cw-form",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "cw-progress-track",
							children: CALENDAR_STAGES.map((stage, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
								className: CALENDAR_STAGES.indexOf(item.stage) >= index ? "active" : "",
								children: [
									index + 1,
									". ",
									stage
								]
							}, stage))
						}),
						!CALENDAR_STAGES.includes(item.stage) && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
							className: "cw-error",
							children: [
								"历史进度「",
								item.stage || "未填写",
								"」尚未核实，请编辑确认当前状态。"
							]
						}),
						overdueReasons(item).map((reason) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "cw-error",
							children: reason
						}, reason)),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "cw-date-summary",
							children: [
								[
									"拍摄",
									item.shootingDate,
									item.actualShootingDate
								],
								[
									"成片",
									item.finishedDate,
									item.actualFinishedDate
								],
								[
									"发布",
									item.launchDate,
									item.actualLaunchDate
								]
							].map(([label, planned, actual]) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", { children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: label }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: planned || "日期待确认" }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { children: ["实际：", actual || "尚未记录"] })
							] }, label))
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
							className: "cw-calendar-links",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "相关脚本与视频" }),
								linked.map((id) => {
									const record = items.find((entry) => entry.id === id);
									return record ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
										onClick: () => onOpenItem(record),
										children: [
											record.contentType === "video" ? "▶ 视频" : "脚本",
											" · ",
											record.materialName,
											" ↗"
										]
									}, id) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { children: [
										"关联素材 ",
										id,
										" 暂不可访问"
									] }, id);
								}),
								safeCalendarUrl(item.scriptLink) && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", {
									href: safeCalendarUrl(item.scriptLink),
									target: "_blank",
									rel: "noreferrer",
									children: "打开飞书脚本 ↗"
								}),
								safeCalendarUrl(item.assetLink) && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", {
									href: safeCalendarUrl(item.assetLink),
									target: "_blank",
									rel: "noreferrer",
									children: "打开视频 / 素材链接 ↗"
								}),
								!linked.length && !item.scriptLink && !item.assetLink && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "尚未关联素材，可在编辑中选择已上传脚本、视频或填写链接。" })
							]
						}),
						item.abnormalStage && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h3", { children: [item.abnormalStage, "异常"] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: item.abnormalNote })] }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "进度说明" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								style: { whiteSpace: "pre-wrap" },
								children: item.note || "暂无补充说明"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("small", { children: ["数据来源：", item.source || "历史记录，待补充核对依据"] })
						] })
					]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("footer", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					onClick: onClose,
					children: "关闭"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					className: "cw-primary",
					onClick: onEdit,
					children: "更新进度 / 关联素材 ↗"
				})] })
			]
		})
	});
}
function MarketingCalendar({ entries, keyword, currentUser, onCreate, onBatch, onOpen, onEdit, onDelete }) {
	const today = /* @__PURE__ */ new Date();
	const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
	const [cursor, setCursor] = (0, import_react.useState)(() => new Date(today.getFullYear(), today.getMonth(), 1));
	const [viewMode, setViewMode] = (0, import_react.useState)("calendar");
	const [selectedDay, setSelectedDay] = (0, import_react.useState)("");
	const [selectedTypes, setSelectedTypes] = (0, import_react.useState)([]);
	const [selectedProducts, setSelectedProducts] = (0, import_react.useState)([]);
	const [ownerFilter, setOwnerFilter] = (0, import_react.useState)("全部负责人");
	const [stageFilter, setStageFilter] = (0, import_react.useState)("");
	const monthKey = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
	const ownerOptions = [...new Set(entries.map((entry) => entry.owner).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN"));
	const matchesFilters = (entry) => (!stageFilter || entry.stage === stageFilter) && (!selectedTypes.length || selectedTypes.includes(entry.materialType)) && (!selectedProducts.length || selectedProducts.includes(entry.product)) && (ownerFilter === "全部负责人" || entry.owner === ownerFilter) && `${entry.id}${entry.creatorName}${entry.product}${entry.owner}${entry.materialType}${entry.note}`.toLocaleLowerCase("zh-CN").includes(keyword.trim().toLocaleLowerCase("zh-CN"));
	const filtered = entries.filter(matchesFilters);
	const monthEntries = filtered.filter((entry) => entry.shootingDate.startsWith(monthKey) || entry.launchDate.startsWith(monthKey) || entry.finishedDate?.startsWith(monthKey));
	const missing = filtered.filter((entry) => !entry.launchDate || !entry.owner || entry.owner === "待分配");
	const toggle = (value, values, setter) => setter(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
	const eventsFor = (date) => monthEntries.flatMap((entry) => [
		entry.shootingDate === date ? {
			entry,
			kind: "拍摄"
		} : null,
		entry.finishedDate === date ? {
			entry,
			kind: "成片"
		} : null,
		entry.launchDate === date ? {
			entry,
			kind: "上线"
		} : null
	].filter(Boolean)).sort((a, b) => Number(b.entry.abnormalStage === b.kind) - Number(a.entry.abnormalStage === a.kind) || a.kind.localeCompare(b.kind));
	const leading = (new Date(cursor.getFullYear(), cursor.getMonth(), 1).getDay() + 6) % 7;
	const cells = Array.from({ length: 42 }, (_, index) => {
		const date = new Date(cursor.getFullYear(), cursor.getMonth(), index - leading + 1);
		const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
		return {
			date: key,
			day: date.getDate(),
			inMonth: date.getMonth() === cursor.getMonth(),
			events: date.getMonth() === cursor.getMonth() ? eventsFor(key) : []
		};
	});
	const selectedEvents = selectedDay ? eventsFor(selectedDay) : [];
	const sortedRows = [...monthEntries].sort((a, b) => (a.launchDate || a.shootingDate).localeCompare(b.launchDate || b.shootingDate) || a.owner.localeCompare(b.owner, "zh-CN") || a.creatorName.localeCompare(b.creatorName, "zh-CN"));
	const titleSuffix = (entry) => entry.sequence > 1 ? ` ${String(entry.sequence).padStart(2, "0")}` : "";
	const entryCard = (entry, kind) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
		className: entry.abnormalStage ? "abnormal" : "",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("small", { children: [
				entry.id,
				" · ",
				entry.materialType
			] }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("strong", { children: [
				entry.creatorName,
				titleSuffix(entry),
				" × ",
				entry.product
			] }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { children: [
				"负责人 ",
				entry.owner || "待分配",
				" · 拍摄 ",
				entry.shootingDate || "待定",
				" · 上线 ",
				entry.launchDate || "待定"
			] }),
			kind && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("b", {
				className: `cw-event-kind ${kind === "上线" ? "launch" : "shoot"}`,
				children: [kind, "档期"]
			}),
			entry.abnormalStage && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("em", { children: [
				entry.abnormalStage,
				"异常：",
				entry.abnormalNote
			] })
		] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "cw-calendar-row-actions",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					onClick: () => onOpen(entry),
					children: "查看详情 ↗"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: CALENDAR_STAGES.includes(entry.stage) ? entry.stage : "进度待确认" }),
				safeCalendarUrl(entry.assetLink) && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", {
					href: safeCalendarUrl(entry.assetLink),
					target: "_blank",
					rel: "noreferrer",
					children: "素材链接 ↗"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					onClick: () => onEdit(entry),
					children: "编辑"
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					className: "danger",
					onClick: () => onDelete(entry),
					children: "删除"
				})
			]
		})]
	}, `${entry.id}-${kind || "row"}`);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
		className: "cw-page cw-calendar-page",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "cw-page-title",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "MATERIAL CALENDAR / LIVE SCHEDULE" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", { children: "营销日历" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "逐条管理达人素材的拍摄与上线档期；未补齐上线日和负责人的记录会单独提示。" })
				] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "cw-calendar-title-actions",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						className: "secondary",
						onClick: onBatch,
						children: "批量录入"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						onClick: onCreate,
						children: "＋ 新增素材"
					})]
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "cw-calendar-toolbar",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "cw-month-switch",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							"aria-label": "上个月",
							onClick: () => {
								setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1));
								setSelectedDay("");
							},
							children: "‹"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("strong", { children: [
							cursor.getFullYear(),
							"年",
							cursor.getMonth() + 1,
							"月"
						] }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							"aria-label": "下个月",
							onClick: () => {
								setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1));
								setSelectedDay("");
							},
							children: "›"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							onClick: () => setCursor(new Date(today.getFullYear(), today.getMonth(), 1)),
							children: "回到本月"
						})
					]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "cw-view-switch",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						className: viewMode === "calendar" ? "active" : "",
						onClick: () => setViewMode("calendar"),
						children: "月历"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						className: viewMode === "list" ? "active" : "",
						onClick: () => setViewMode("list"),
						children: "列表"
					})]
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "cw-calendar-metrics",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", { children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "本月素材" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: String(monthEntries.length).padStart(2, "0") }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "独立素材记录" })
					] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", { children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "本月拍摄" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: String(monthEntries.filter((entry) => entry.shootingDate.startsWith(monthKey)).length).padStart(2, "0") }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "按拍摄日期统计" })
					] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", { children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "本月上线" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: String(monthEntries.filter((entry) => entry.launchDate.startsWith(monthKey)).length).padStart(2, "0") }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "按上线日期统计" })
					] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
						className: missing.length ? "alert" : "",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "待补全信息" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: String(missing.length).padStart(2, "0") }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "负责人 / 上线日期" })
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", { children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "延期 / 异常" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: String(monthEntries.filter((entry) => entry.abnormalStage).length).padStart(2, "0") }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "拍摄或上线异常" })
					] })
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "cw-calendar-filters",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "素材类型" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						className: !selectedTypes.length ? "active" : "",
						onClick: () => setSelectedTypes([]),
						children: "全部"
					}), MATERIAL_TYPES.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						className: selectedTypes.includes(entry) ? "active" : "",
						onClick: () => toggle(entry, selectedTypes, setSelectedTypes),
						children: entry
					}, entry))] })] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "单品" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						className: !selectedProducts.length ? "active" : "",
						onClick: () => setSelectedProducts([]),
						children: "全部"
					}), [...new Set(entries.map((entry) => entry.product).filter(Boolean))].map((entry) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						className: selectedProducts.includes(entry) ? "active" : "",
						onClick: () => toggle(entry, selectedProducts, setSelectedProducts),
						children: entry
					}, entry))] })] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "负责人" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", {
						value: ownerFilter,
						onChange: (event) => setOwnerFilter(event.target.value),
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: "全部负责人" }), ownerOptions.map((owner) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: owner }, owner))]
					})] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "进度状态" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", {
						value: stageFilter,
						onChange: (event) => setStageFilter(event.target.value),
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
							value: "",
							children: "全部状态"
						}), CALENDAR_STAGES.map((stage) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: stage }, stage))]
					})] })
				]
			}),
			missing.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", {
				className: "cw-missing-panel",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("summary", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "待补全信息" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("small", { children: [missing.length, " 条记录缺少负责人或上线日期"] })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "展开处理⌄" })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { children: missing.slice(0, 50).map((entry) => entryCard(entry)) })]
			}),
			viewMode === "calendar" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "cw-month-card cw-month-card-full",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "cw-calendar-week",
					children: [
						"周一",
						"周二",
						"周三",
						"周四",
						"周五",
						"周六",
						"周日"
					].map((day) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: day }, day))
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "cw-calendar-grid",
					children: cells.map((cell) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
						className: `${cell.inMonth ? "" : "muted"} ${cell.date === todayKey ? "today" : ""} ${cell.date === selectedDay ? "selected" : ""}`,
						onClick: () => cell.inMonth && setSelectedDay(cell.date),
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("time", { children: cell.day }),
							cell.events.slice(0, 3).map(({ entry, kind }) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
								onClick: (event) => {
									event.stopPropagation();
									setSelectedDay(cell.date);
									onOpen(entry);
								},
								className: `${kind === "上线" ? "is-launch" : "is-shooting"} ${entry.abnormalStage === kind ? "is-abnormal" : ""}`,
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("b", { children: [
									entry.abnormalStage === kind ? "异常" : kind,
									" · ",
									entry.creatorName,
									titleSuffix(entry)
								] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: entry.product })]
							}, `${entry.id}-${kind}`)),
							cell.events.length > 3 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("em", { children: [
								"查看全部 ",
								cell.events.length,
								" 项"
							] })
						]
					}, cell.date))
				})]
			}), selectedDay && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("aside", {
				className: "cw-day-panel",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "DAY DETAIL" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: selectedDay })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					onClick: () => setSelectedDay(""),
					children: "关闭"
				})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { children: selectedEvents.length ? selectedEvents.map(({ entry, kind }) => entryCard(entry, kind)) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Empty, {
					title: "当天没有素材档期",
					detail: "可新增拍摄或上线日期后再查看。"
				}) })]
			})] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "cw-calendar-list",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "素材编号" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "达人 / 单品" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "负责人" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "拍摄 / 上线" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "状态与操作" })
				] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { children: sortedRows.length ? sortedRows.map((entry) => entryCard(entry)) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Empty, {
					title: "本月没有匹配记录",
					detail: "请切换月份或调整筛选条件。"
				}) })]
			})
		]
	});
}
function CalendarEntryModal({ users, currentUser, items, item, onClose, onSaved }) {
	const [form, setForm] = (0, import_react.useState)({
		creatorName: item?.creatorName || "",
		platform: item?.platform || "抖音",
		materialType: item?.materialType || MATERIAL_TYPES[0],
		product: item?.product || "眼膜",
		ownerId: item ? item.ownerId || (users.filter((person) => person.name === item.owner).length === 1 ? users.find((person) => person.name === item.owner).id : "") : currentUser.id,
		shootingDate: item?.shootingDate || "",
		finishedDate: item?.finishedDate || "",
		actualShootingDate: item?.actualShootingDate || "",
		actualFinishedDate: item?.actualFinishedDate || "",
		actualLaunchDate: item?.actualLaunchDate || "",
		stage: item ? CALENDAR_STAGES.includes(item.stage) ? item.stage : "" : "待拍摄",
		linkedItemIds: item?.linkedItemIds || "[]",
		scriptLink: item?.scriptLink || "",
		source: item?.source || "",
		launchDate: item?.launchDate || "",
		abnormalStage: item?.abnormalStage || "",
		abnormalNote: item?.abnormalNote || "",
		assetLink: item?.assetLink || "",
		note: item?.note || ""
	});
	const [busy, setBusy] = (0, import_react.useState)(false);
	const [error, setError] = (0, import_react.useState)("");
	const update = (key, value) => setForm((current) => ({
		...current,
		[key]: value
	}));
	const submit = async () => {
		if (form.creatorName.trim().length < 2) return setError("请填写达人名称");
		if (!form.shootingDate && !form.launchDate && !form.finishedDate) return setError("拍摄、成片、发布日期至少填写一项");
		if (!form.stage) return setError("请确认当前进度；历史状态不会自动当作已发布");
		if (form.abnormalStage && !form.abnormalNote.trim()) return setError("标记异常时请填写异常说明");
		const owner = users.find((entry) => entry.id === form.ownerId);
		setBusy(true);
		setError("");
		try {
			const response = await fetch(collaborationsApi, {
				method: item ? "PATCH" : "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					...form,
					id: item?.id,
					owner: owner?.name || item?.owner || "待分配"
				})
			});
			const payload = await response.json();
			if (!response.ok) throw new Error(payload.error || "创建失败");
			onSaved();
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "创建失败");
		} finally {
			setBusy(false);
		}
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "cw-modal-bg",
		onMouseDown: (event) => event.target === event.currentTarget && onClose(),
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
			className: "cw-modal cw-calendar-modal",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "MATERIAL SCHEDULE" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: item ? "编辑素材进度" : "新增素材档期" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "记录真实进度；档期已过且状态未更新时，仅提醒对应负责人。" })
				] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					onClick: onClose,
					children: "×"
				})] }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "cw-form",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "cw-grid3",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
									className: "cw-field",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "达人名称" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
										value: form.creatorName,
										onChange: (event) => update("creatorName", event.target.value),
										placeholder: "请输入达人姓名或账号名"
									})]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
									className: "cw-field",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "素材类型" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("select", {
										value: form.materialType,
										onChange: (event) => update("materialType", event.target.value),
										children: MATERIAL_TYPES.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: entry }, entry))
									})]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
									className: "cw-field",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "合作单品" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("select", {
										value: form.product,
										onChange: (event) => update("product", event.target.value),
										children: PRODUCTS.map((product) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: product }, product))
									})]
								})
							]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "cw-grid3",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(PeoplePicker, {
									label: "负责人",
									users,
									value: form.ownerId,
									onChange: (value) => update("ownerId", value)
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
									className: "cw-field",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "平台" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", {
										value: form.platform,
										onChange: (event) => update("platform", event.target.value),
										children: [
											/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: "抖音" }),
											/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: "小红书" }),
											/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: "视频号" }),
											/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: "其他" })
										]
									})]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {})
							]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "cw-grid3",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
									className: "cw-field",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "拍摄日期" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
										type: "date",
										value: form.shootingDate,
										onChange: (event) => update("shootingDate", event.target.value)
									})]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
									className: "cw-field",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "上线日期" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
										type: "date",
										value: form.launchDate,
										onChange: (event) => update("launchDate", event.target.value)
									})]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
									className: "cw-field",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "素材链接" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
										value: form.assetLink,
										onChange: (event) => update("assetLink", event.target.value),
										placeholder: "可选"
									})]
								})
							]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "cw-grid3",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
								className: "cw-field",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "异常环节" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", {
									value: form.abnormalStage,
									onChange: (event) => update("abnormalStage", event.target.value),
									children: [
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
											value: "",
											children: "正常"
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: "拍摄" }),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: "成片" }),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: "上线" })
									]
								})]
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
								className: "cw-field",
								style: { gridColumn: "span 2" },
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "异常说明" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
									disabled: !form.abnormalStage,
									value: form.abnormalNote,
									onChange: (event) => update("abnormalNote", event.target.value),
									placeholder: form.abnormalStage ? "说明异常原因和下一步处理" : "标记异常后填写"
								})]
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "cw-grid3",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
									className: "cw-field",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "当前进度" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", {
										value: form.stage,
										onChange: (e) => update("stage", e.target.value),
										children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
											value: "",
											children: "请选择确认后的进度"
										}), CALENDAR_STAGES.map((stage) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: stage }, stage))]
									})]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
									className: "cw-field",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "预计成片日期" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
										type: "date",
										value: form.finishedDate,
										onChange: (e) => update("finishedDate", e.target.value)
									})]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
									className: "cw-field",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "来源 / 核对依据" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
										value: form.source,
										onChange: (e) => update("source", e.target.value),
										placeholder: "文档名称、链接或确认人"
									})]
								})
							]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "cw-grid3",
							children: [
								["actualShootingDate", "实际拍摄日期"],
								["actualFinishedDate", "实际成片日期"],
								["actualLaunchDate", "实际发布日期"]
							].map(([key, label]) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
								className: "cw-field",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: label }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
									type: "date",
									value: form[key],
									onChange: (e) => update(key, e.target.value)
								})]
							}, key))
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
							className: "cw-field",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "关联飞书脚本链接" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
								value: form.scriptLink,
								onChange: (e) => update("scriptLink", e.target.value),
								placeholder: "https://…"
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(CalendarLinkPicker, {
							items,
							value: form.linkedItemIds,
							onChange: (value) => update("linkedItemIds", value)
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
							className: "cw-field",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "进度与补充说明" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", {
								value: form.note,
								onChange: (event) => update("note", event.target.value),
								placeholder: "例如：脚本已确认，等待达人回传初剪；上线后同步投放组。"
							})]
						}),
						error && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "cw-error",
							children: error
						})
					]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("footer", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					className: "cw-cancel",
					disabled: busy,
					onClick: onClose,
					children: "取消"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					className: "cw-primary",
					disabled: busy,
					onClick: submit,
					children: busy ? "正在保存…" : item ? "保存修改 ↗" : "保存素材 ↗"
				})] })
			]
		})
	});
}
function CalendarBatchModal({ users, currentUser, onClose, onSaved }) {
	const [text, setText] = (0, import_react.useState)("");
	const [busy, setBusy] = (0, import_react.useState)(false);
	const [error, setError] = (0, import_react.useState)("");
	const [plan, setPlan] = (0, import_react.useState)([]);
	const parse = () => text.split(/\r?\n/).filter((line) => line.trim()).filter((line) => !line.startsWith("负责人")).map((line) => {
		const [owner, materialType, product, creatorName, shootingDate, launchDate, abnormalStage, abnormalNote, assetLink, note, id, stage, finishedDate, scriptLink, source] = line.split(/[｜|\t]/).map((part) => part.trim());
		const person = users.find((user) => user.name === owner);
		if (owner && owner !== "待分配" && !person) throw new Error(`负责人“${owner}”不在站内人员库，请先核对姓名`);
		return {
			owner: owner || "待分配",
			ownerId: person?.id || "",
			materialType,
			product,
			creatorName,
			shootingDate,
			launchDate,
			abnormalStage,
			abnormalNote,
			assetLink,
			note,
			id: id || void 0,
			stage: stage || (id ? void 0 : "待拍摄"),
			finishedDate,
			scriptLink,
			source,
			platform: "抖音"
		};
	});
	const send = async (preview) => {
		setBusy(true);
		setError("");
		try {
			const items = parse();
			const response = await fetch(collaborationsApi, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					items,
					upsert: true,
					preview
				})
			});
			const payload = await response.json();
			if (payload.plan) setPlan(payload.plan);
			if (!response.ok) throw new Error(payload.error || "保存失败");
			if (!preview) onSaved(payload.count || 0);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "导入失败");
		} finally {
			setBusy(false);
		}
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "cw-modal-bg",
		onMouseDown: (event) => event.target === event.currentTarget && onClose(),
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
			className: "cw-modal cw-calendar-modal",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "BATCH PROGRESS UPDATE" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "批量导入 / 更新达人进度" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "粘贴 Excel 或飞书表格数据（制表符或竖线分隔）。先预览，再确认入库。更新已有素材请填写详情中的素材编号；不按达人姓名擅自合并。" })
				] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					onClick: onClose,
					children: "×"
				})] }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "cw-form",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
							className: "cw-field",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "负责人｜素材类型｜单品｜达人｜拍摄日期｜发布日期｜异常环节｜异常说明｜视频链接｜备注｜素材编号｜状态｜成片日期｜脚本链接｜来源" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", {
								className: "cw-batch-calendar-input",
								value: text,
								onChange: (event) => {
									setText(event.target.value);
									setPlan([]);
								},
								placeholder: "从表格复制数据；日期格式 YYYY-MM-DD，未知日期请留空。后面的可选列可省略。"
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
							className: "cw-field",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "或导入 UTF-8 文本 / TSV 文件" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
								type: "file",
								accept: ".txt,.tsv",
								onChange: async (event) => {
									const file = event.target.files?.[0];
									if (file) {
										setText(await file.text());
										setPlan([]);
									}
								}
							})]
						}),
						plan.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "cw-batch-preview",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("strong", { children: [
								"预览 ",
								plan.length,
								" 条"
							] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
								"新增 ",
								plan.filter((row) => row.action === "新增").length,
								" · 更新 ",
								plan.filter((row) => row.action === "更新").length,
								" · 冲突 ",
								plan.filter((row) => row.error).length
							] })] }), plan.map((row) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
								className: row.error ? "error" : "ok",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("b", { children: [
										"第 ",
										row.line,
										" 行 · ",
										row.action
									] }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
										row.row?.creatorName,
										" · ",
										row.row?.product
									] }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("em", { children: row.error || `拍摄 ${row.row?.shootingDate || "待定"} / 成片 ${row.row?.finishedDate || "待定"} / 发布 ${row.row?.launchDate || "待定"} · ${row.row?.stage}` })
								]
							}, row.line))]
						}),
						error && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "cw-error",
							children: error
						})
					]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("footer", { children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						className: "cw-cancel",
						disabled: busy,
						onClick: onClose,
						children: "取消"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						disabled: busy || !text.trim(),
						onClick: () => send(true),
						children: "识别并预览"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						className: "cw-primary",
						disabled: busy || !plan.length || plan.some((row) => row.error),
						onClick: () => send(false),
						children: busy ? "正在处理…" : "确认入库 ↗"
					})
				] })
			]
		})
	});
}
function ScriptWritingCenter({ library, onMessage }) {
	const references = library.filter((item) => item.copy && item.copy.length > 20);
	const [product, setProduct] = (0, import_react.useState)(PRODUCTS[0]);
	const [scriptType, setScriptType] = (0, import_react.useState)(WRITING_SCRIPT_TYPES[0]);
	const [referenceId, setReferenceId] = (0, import_react.useState)("");
	const [requirements, setRequirements] = (0, import_react.useState)("");
	const [targetLength, setTargetLength] = (0, import_react.useState)("300字左右");
	const [creativeMode, setCreativeMode] = (0, import_react.useState)("expand");
	const [draftTitle, setDraftTitle] = (0, import_react.useState)("");
	const [draftText, setDraftText] = (0, import_react.useState)("");
	const [versions, setVersions] = (0, import_react.useState)([]);
	const [lastDiversity, setLastDiversity] = (0, import_react.useState)("");
	const [accepted, setAccepted] = (0, import_react.useState)(false);
	const [busy, setBusy] = (0, import_react.useState)(false);
	const reference = references.find((item) => item.id === referenceId);
	const spokenCount = draftText.replace(/【[^】]+】[^\n]*/g, "").replace(/镜头\d+|画面[:：]|口播[:：]|\s/g, "").length;
	const stripSystemNotes = (content) => content.replace(/^(【创作定位】|【参考依据】|【类型标准】|【补充需求】|【长度标准】).*\n?/gm, "").trim();
	const saveVersion = (title, content, source, feedback = "") => {
		setVersions((current) => {
			const next = [...current];
			if (draftText.trim() && !next.some((entry) => entry.content === draftText)) next.push({
				version: next.length + 1,
				title: draftTitle || "手动稿",
				content: draftText,
				source: "手动稿"
			});
			if (!next.some((entry) => entry.content === content)) next.push({
				version: next.length + 1,
				title,
				content,
				source
			});
			return next;
		});
		setDraftTitle(title);
		setDraftText(content);
		setLastDiversity(feedback);
		setAccepted(false);
	};
	const requestWriting = async (action) => {
		const rewrite = action !== "initial";
		if (!rewrite && requirements.trim().length < 2) return onMessage("请先填写补充需求，再生成初稿");
		if (rewrite && draftText.trim().length < 20) return onMessage("请先写入或生成一版完整脚本");
		setBusy(true);
		try {
			const taskRequirement = rewrite ? `${action === "same" ? "保留当前稿件的核心角度，但整篇重新组织语言、节奏和画面" : "放弃当前稿件的创意骨架，重新选择人物关系、生活场景、开头钩子、叙事结构、证据方式和收口"}。不要逐句替换近义词。原稿：${draftText.trim()}。补充需求：${requirements.trim() || "保持自然口语和真实体验"}。目标字数：${targetLength}。` : `${requirements.trim()}。目标字数：${targetLength}。请直接输出可编辑的完整脚本。`;
			const avoidContents = rewrite ? [...versions.map((entry) => entry.content), draftText] : [];
			const response = await fetch(scriptsApi, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					product,
					scriptType,
					templateId: reference?.id || "",
					templateTitle: reference?.materialName || "",
					templateCopy: reference?.copy || "",
					requirements: taskRequirement,
					count: 1,
					generationKey: crypto.randomUUID(),
					previousContent: rewrite ? draftText : "",
					avoidContents,
					rewriteMode: action === "same" ? "same-direction" : action === "new" ? "new-direction" : void 0,
					creativeMode
				})
			});
			const payload = await response.json();
			if (!response.ok) throw new Error(payload.error || "脚本生成失败");
			const next = payload.drafts?.[0];
			if (!next) throw new Error("没有收到生成结果");
			saveVersion(next.title, stripSystemNotes(next.content), action === "same" ? "同方向重写" : action === "new" ? "全新方向" : "AI初稿", next.feedback || "");
			onMessage(action === "same" ? "已保留核心角度并全文重写" : action === "new" ? "已更换创意路线，历史版本全部保留" : "初稿已生成，可以继续编辑或换个方向");
		} catch (caught) {
			onMessage(caught instanceof Error ? caught.message : "脚本生成失败");
		} finally {
			setBusy(false);
		}
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
		className: "cw-page cw-writing-page",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "cw-page-title",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "SCRIPT STUDIO / WRITE · REWRITE · CHOOSE" }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", { children: "脚本写作" }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "写一版，换一种思路再写，直到选出满意的稿件。" })
			] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "cw-writing-flow",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", {
						className: draftText ? "done" : "active",
						children: "01 写稿"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { children: "→" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", {
						className: draftText && !accepted ? "active" : accepted ? "done" : "",
						children: "02 重写与选择"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { children: "→" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", {
						className: accepted ? "done" : "",
						children: "03 完成"
					})
				]
			})]
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "cw-studio-layout",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("aside", {
					className: "cw-studio-brief",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "CREATIVE BRIEF" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "创作要求" })] }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "cw-studio-fields",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
									className: "cw-field",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "脚本类型" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("select", {
										value: scriptType,
										onChange: (event) => {
											setScriptType(event.target.value);
											setAccepted(false);
										},
										children: WRITING_SCRIPT_TYPES.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: entry }, entry))
									})]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
									className: "cw-field",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "单品" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("select", {
										value: product,
										onChange: (event) => {
											setProduct(event.target.value);
											setAccepted(false);
										},
										children: PRODUCTS.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: entry }, entry))
									})]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
									className: "cw-field",
									children: [
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "灵感参考（可选）" }),
										/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", {
											value: referenceId,
											onChange: (event) => {
												setReferenceId(event.target.value);
												setAccepted(false);
											},
											children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
												value: "",
												children: "不选案例，独立构思"
											}), references.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
												value: entry.id,
												children: entry.materialName
											}, entry.id))]
										}),
										reference ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", {
											className: "cw-reference-note",
											children: "只提取有效说服方式，不沿用原稿骨架"
										}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", {
											className: "cw-reference-note",
											children: "默认从需求重新建立人物、场景和结构"
										})
									]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
									className: "cw-field",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "补充需求" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", {
										value: requirements,
										onChange: (event) => {
											setRequirements(event.target.value);
											setAccepted(false);
										},
										placeholder: "目标人群、场景、重点卖点，以及需要规避的表达。"
									})]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
									className: "cw-field",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "目标字数" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", {
										value: targetLength,
										onChange: (event) => setTargetLength(event.target.value),
										children: [
											/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: "200字左右" }),
											/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: "300字左右" }),
											/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: "400字左右" }),
											/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: "不限制" })
										]
									})]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
									className: "cw-field",
									children: [
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "创作自由度" }),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
											className: "cw-freedom-options",
											children: [
												{
													id: "steady",
													label: "稳妥"
												},
												{
													id: "expand",
													label: "拓新"
												},
												{
													id: "bold",
													label: "大胆"
												}
											].map((entry) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
												type: "button",
												className: creativeMode === entry.id ? "active" : "",
												onClick: () => setCreativeMode(entry.id),
												children: entry.label
											}, entry.id))
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", {
											className: "cw-reference-note",
											children: creativeMode === "steady" ? "靠近历史有效表达，但不复制结构" : creativeMode === "expand" ? "保留营销逻辑，主动拓展生活场景" : "允许更少见的开头、关系和叙事方式"
										})
									]
								})
							]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("footer", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							disabled: busy,
							onClick: () => requestWriting("initial"),
							children: busy ? "正在写作…" : "根据要求生成一稿"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "案例默认不选，让创作从本次需求出发。" })] })
					]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
					className: "cw-studio-editor",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "WORKING DRAFT" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "当前稿件" })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: spokenCount }), " 字"] })] }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
							className: "cw-studio-title",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "脚本名称" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
								value: draftTitle,
								onChange: (event) => {
									setDraftTitle(event.target.value);
									setAccepted(false);
								},
								placeholder: "输入脚本名称"
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", {
							className: "cw-studio-copy",
							value: draftText,
							onChange: (event) => {
								setDraftText(event.target.value);
								setAccepted(false);
							},
							placeholder: "从这里开始写脚本，或粘贴现有稿件……"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("footer", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "cw-version-strip",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "版本" }), versions.length ? versions.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
								className: entry.content === draftText ? "active" : "",
								title: entry.source,
								onClick: () => {
									setDraftTitle(entry.title);
									setDraftText(entry.content);
									setAccepted(false);
								},
								children: ["V", entry.version]
							}, entry.version)) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "每次重写后，旧稿都会留在这里" })]
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "cw-editor-state",
							children: accepted ? "当前版本已采用" : "可继续修改或换一版"
						})] })
					]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("aside", {
					className: "cw-studio-diversity",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "DIVERSE REWRITE" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "换一种写法" })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Badge, {
							tone: versions.length > 1 ? "active" : "plain",
							children: [versions.length || 0, " 个版本"]
						})] }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "cw-diversity-core",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "cw-diversity-mark",
									children: "↻"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: draftText ? "不满意就整篇换掉" : "先完成第一版" }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "重写会同时比较全部历史版本，主动更换开头、叙事结构、人物关系、证据方式和收口，不再围着同一套表达打转。" }),
								lastDiversity && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("em", { children: lastDiversity }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "开头" }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "结构" }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "关系" }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "证据" }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "收口" })
								] })
							]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("footer", { children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								className: "secondary",
								disabled: busy || draftText.trim().length < 20,
								onClick: () => requestWriting("same"),
								children: busy ? "正在重写…" : "同方向重写"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								disabled: busy || draftText.trim().length < 20,
								onClick: () => requestWriting("new"),
								children: busy ? "正在换方向…" : "换个方向 ↗"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								className: "secondary",
								disabled: !draftText.trim() || busy,
								onClick: () => {
									setAccepted(true);
									onMessage("已采用当前版本");
								},
								children: accepted ? "已采用当前版本 ✓" : "采用当前版本"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "“换个方向”会主动避开全部历史稿件的创意骨架。" })
						] })
					]
				})
			]
		})]
	});
}
function StarCollaborationCenter({ projects, keyword, view, onView, typeFilter, onTypeFilter, onCreate, onOpen }) {
	const visible = projects.filter((entry) => (typeFilter === "全部类型" || starType(entry.projectType) === typeFilter) && `${entry.artistName}${entry.product}${entry.owner}${entry.phase}`.includes(keyword));
	const profiles = Array.from(new Map(visible.map((entry) => [entry.artistName, entry])).values());
	const expiring = projects.filter((entry) => {
		const status = rightsStatus(entry);
		return status.days !== null && status.days <= 90;
	}).length;
	const pendingReview = projects.filter((entry) => entry.phase.includes("审核") || entry.phase.includes("初审") || entry.phase.includes("成片")).length;
	const inProduction = projects.filter((entry) => entry.phase.includes("拍摄") || entry.phase.includes("筹备") || entry.phase.includes("内容")).length;
	const active = projects.filter((entry) => ![
		"已完成",
		"暂缓",
		"不合作"
	].includes(entry.phase)).length;
	const focusProject = [...visible].filter((entry) => ![
		"已完成",
		"暂缓",
		"不合作"
	].includes(entry.phase)).sort((a, b) => {
		return (/* @__PURE__ */ new Date(`${a.eta || a.launchDate || a.finalDate || a.shootDate || "2999-12-31"}T23:59:59+08:00`)).getTime() - (/* @__PURE__ */ new Date(`${b.eta || b.launchDate || b.finalDate || b.shootDate || "2999-12-31"}T23:59:59+08:00`)).getTime();
	})[0] ?? visible[0];
	const attention = projects.map((entry) => ({
		entry,
		deadline: deadlineStatus(entry),
		rights: rightsStatus(entry)
	})).filter(({ deadline, rights }) => deadline.days !== null && deadline.days <= 3 || rights.days !== null && rights.days <= 90).slice(0, 3);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
		className: "cw-page cw-star-center",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "cw-page-title",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "STAR COLLABORATION / FULL JOURNEY" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", { children: "明星合作中心" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "从合作判断、权益确认到内容生产、成片上线与一创再利用。" })
				] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					onClick: onCreate,
					children: "＋ 建立明星合作"
				})]
			}),
			view === "overview" && focusProject && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "cw-star-focus-layout",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
					className: "cw-star-focus",
					onClick: () => onOpen(focusProject),
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "cw-focus-orbit" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "NOW / CURRENT FOCUS" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "当前重点项目" })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Badge, {
							tone: starType(focusProject.projectType) === "AI授权明星" ? "violet" : "active",
							children: starType(focusProject.projectType)
						})] }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "cw-focus-main",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("small", { children: [
									projectPeriod(focusProject.projectPeriod),
									" · ",
									focusProject.phase
								] }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("strong", { children: [
									focusProject.artistName,
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { children: "×" }),
									focusProject.product
								] }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: focusProject.nextMilestone || "等待补充下一节点" })
							] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "节点状态" }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: deadlineStatus(focusProject).label }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("em", { children: focusProject.eta || focusProject.launchDate || "时间待定" })
							] })]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "cw-focus-progress",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { style: { width: `${phaseProgress(focusProject.phase)}%` } }) }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("b", { children: [phaseProgress(focusProject.phase), "%"] })]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("footer", { children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: ["负责人 ", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: focusProject.owner })] }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: ["授权状态 ", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: rightsStatus(focusProject).label })] }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "打开项目 ↗" })
						] })
					]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("aside", {
					className: "cw-star-attention",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "ATTENTION" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "待处理提醒" })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Badge, {
						tone: attention.length ? "danger" : "success",
						children: [attention.length, " 项"]
					})] }), attention.length ? attention.map(({ entry, deadline, rights }) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
						onClick: () => onOpen(entry),
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", {}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("b", { children: [
								entry.artistName,
								" × ",
								entry.product
							] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: deadline.days !== null && deadline.days <= 3 ? deadline.label : rights.label })] }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "↗" })
						]
					}, entry.id)) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "cw-attention-clear",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "✓" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "当前没有临期事项" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "授权与关键节点均处于正常状态" })
						]
					})]
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "cw-star-view-tabs",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
						className: view === "overview" ? "active" : "",
						onClick: () => onView("overview"),
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { children: "01" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "合作总览" }) })]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
						className: view === "profiles" ? "active" : "",
						onClick: () => onView("profiles"),
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { children: "02" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "明星与合作信息" }) })]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
						className: view === "execution" ? "active" : "",
						onClick: () => onView("execution"),
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { children: "03" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "项目执行进度" }) })]
					})
				]
			}),
			view === "overview" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "cw-star-control-row",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "cw-star-metrics",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: String(active).padStart(2, "0") }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "推进中" })] }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: String(inProduction).padStart(2, "0") }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "内容生产" })] }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: String(pendingReview).padStart(2, "0") }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "待样片审核" })] }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
								className: expiring ? "alert" : "",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: String(expiring).padStart(2, "0") }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "授权提醒" })]
							})
						]
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "cw-filter cw-star-filter",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							className: typeFilter === "全部类型" ? "active" : "",
							onClick: () => onTypeFilter("全部类型"),
							children: "全部类型"
						}), STAR_TYPES.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							className: typeFilter === entry ? "active" : "",
							onClick: () => onTypeFilter(entry),
							children: entry
						}, entry))]
					})]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "cw-section-head",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "COLLABORATION PORTFOLIO" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "合作项目" })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [visible.length, " 个项目"] })]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "cw-star-project-list",
					children: visible.map((entry, index) => {
						const rights = rightsStatus(entry);
						const deadline = deadlineStatus(entry);
						return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
							className: focusProject?.id === entry.id ? "focus" : "",
							onClick: () => onOpen(entry),
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "cw-star-list-no",
									children: String(index + 1).padStart(2, "0")
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
									className: "cw-star-list-name",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("small", { children: [
										starType(entry.projectType),
										" · ",
										projectPeriod(entry.projectPeriod)
									] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("strong", { children: [
										entry.artistName,
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { children: "×" }),
										entry.product
									] })]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
									className: "cw-star-list-stage",
									children: [
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "当前阶段" }),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: entry.phase }),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("em", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { style: { width: `${phaseProgress(entry.phase)}%` } }) })
									]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
									className: "cw-star-list-next",
									children: [
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "下一节点" }),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: entry.nextMilestone || "待补充" }),
										/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("em", { children: [
											entry.owner,
											" · ",
											entry.eta || "时间待定"
										] })
									]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
									className: "cw-star-list-status",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Badge, {
										tone: deadline.tone,
										children: deadline.label
									}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Badge, {
										tone: rights.tone,
										children: rights.label
									})]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", {
									className: "cw-arrow",
									children: "↗"
								})
							]
						}, entry.id);
					})
				})
			] }),
			view === "profiles" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "cw-section-head",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "STAR PROFILES / NO IMAGE" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "明星与合作信息" })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [profiles.length, " 位明星"] })]
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "cw-star-profiles",
				children: profiles.map((profile) => {
					const history = visible.filter((entry) => entry.artistName === profile.artistName);
					return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", { children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: starType(profile.projectType) }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: profile.artistName })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Badge, {
							tone: "active",
							children: [history.length, " 次合作"]
						})] }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "cw-profile-facts",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "适配单品" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: Array.from(new Set(history.map((entry) => entry.product))).join("、") })] }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "最近负责人" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: profile.owner })] }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "档案建档人" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: profile.creatorName || profile.owner })] })
							]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "cw-profile-history",
							children: history.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
								onClick: () => onOpen(entry),
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: projectPeriod(entry.projectPeriod) }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: entry.product })] }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Badge, {
										tone: entry.decision === "推进" ? "success" : "plain",
										children: entry.decision || "推进"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("em", { children: entry.phase }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "↗" })
								]
							}, entry.id))
						})
					] }, profile.artistName);
				})
			})] }),
			view === "execution" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "cw-execution-head",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "PROJECT EXECUTION / LIVE" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "项目执行进度" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "合作确认、内容生产、成片审核、上线与一创再利用共用一条进度轴。" })
				] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						className: "active",
						children: "项目进度"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { children: "营销日历" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { children: "任务列表" })
				] })]
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "cw-execution-list",
				children: visible.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
					onClick: () => onOpen(entry),
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "cw-execution-name",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("small", { children: [
									starType(entry.projectType),
									" · ",
									projectPeriod(entry.projectPeriod)
								] }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("strong", { children: [
									entry.artistName,
									" × ",
									entry.product
								] }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: ["负责人 ", entry.owner] })
							]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "cw-stage-rail",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { style: { width: `${phaseProgress(entry.phase)}%` } }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "done",
									children: "合作确认"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: phaseProgress(entry.phase) >= 35 ? "done" : "",
									children: "内容生产"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: phaseProgress(entry.phase) >= 60 ? "done" : "",
									children: "成片审核"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: phaseProgress(entry.phase) >= 80 ? "done" : "",
									children: "上线与一创"
								})
							]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "cw-execution-next",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "当前阶段" }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: entry.phase }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: entry.nextMilestone || "待补充下一节点" })
							]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", {
							className: "cw-arrow",
							children: "↗"
						})
					]
				}, entry.id))
			})] })
		]
	});
}
function ArtistProjectModal({ users, currentUser, onClose, onCreated }) {
	const currentMonth = (/* @__PURE__ */ new Date()).toISOString().slice(0, 7);
	const [form, setForm] = (0, import_react.useState)({
		artistName: "",
		product: PRODUCTS[0],
		projectType: STAR_TYPES[1],
		projectPeriod: currentMonth,
		ownerId: currentUser.id,
		actualFee: "",
		rightsScope: "",
		rightsStartDate: "",
		rightsEndDate: "",
		rightsFileUrl: "",
		valueJudgement: "",
		decision: "推进",
		shootDate: "",
		finalDate: "",
		launchDate: "",
		nextMilestone: "完成合作信息确认",
		eta: "",
		firstCreationPlan: ""
	});
	const [busy, setBusy] = (0, import_react.useState)(false);
	const [error, setError] = (0, import_react.useState)("");
	const update = (key, value) => setForm((current) => ({
		...current,
		[key]: value
	}));
	const owner = users.find((entry) => entry.id === form.ownerId) ?? currentUser;
	const submit = async () => {
		setBusy(true);
		setError("");
		try {
			const response = await fetch(artistProjectsApi, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(form)
			});
			const payload = await readApiPayload(response);
			if (!response.ok) throw new Error(payload.error || "建立失败");
			onCreated();
		} catch (error) {
			setError(error instanceof Error ? error.message : "建立失败");
		} finally {
			setBusy(false);
		}
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "cw-modal-bg",
		onMouseDown: (event) => event.target === event.currentTarget && onClose(),
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
			className: "cw-modal cw-star-modal",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "NEW STAR COLLABORATION" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "建立明星合作" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "项目自动命名为“明星 × 单品 · 合作时间”，不上传明星照片。" })
				] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					onClick: onClose,
					children: "×"
				})] }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "cw-form",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "cw-form-section",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "01 / 明星与项目" }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
									className: "cw-grid3",
									children: [
										/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
											className: "cw-field",
											children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "明星姓名" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
												value: form.artistName,
												onChange: (e) => update("artistName", e.target.value),
												placeholder: "输入明星姓名"
											})]
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
											className: "cw-field",
											children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "明星类型" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("select", {
												value: form.projectType,
												onChange: (e) => update("projectType", e.target.value),
												children: STAR_TYPES.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: entry }, entry))
											})]
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
											className: "cw-field",
											children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "合作单品" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("select", {
												value: form.product,
												onChange: (e) => update("product", e.target.value),
												children: [...PRODUCTS, "品牌合作"].map((entry) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: entry }, entry))
											})]
										})
									]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
									className: "cw-grid3",
									children: [
										/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
											className: "cw-field",
											children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "合作时间" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
												type: "month",
												value: form.projectPeriod,
												onChange: (e) => update("projectPeriod", e.target.value)
											})]
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)(PeoplePicker, {
											label: "项目负责人",
											users,
											value: form.ownerId,
											onChange: (value) => update("ownerId", value)
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
											className: "cw-auto-owner",
											children: [
												/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "明星档案建档人" }),
												/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: owner.name }),
												/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "自动跟随当前项目负责人" })
											]
										})
									]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
									className: "cw-project-name-preview",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "项目名称预览" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("strong", { children: [
										form.artistName || "明星姓名",
										" × ",
										form.product,
										" · ",
										projectPeriod(form.projectPeriod)
									] })]
								})
							]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "cw-form-section",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "02 / 权益与价值判断" }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
									className: "cw-grid3",
									children: [
										/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
											className: "cw-field",
											children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "实际合作费用" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
												value: form.actualFee,
												onChange: (e) => update("actualFee", e.target.value),
												placeholder: "例如：80万元"
											})]
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
											className: "cw-field",
											children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "素材授权起始日期" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
												type: "date",
												value: form.rightsStartDate,
												onChange: (e) => update("rightsStartDate", e.target.value)
											})]
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
											className: "cw-field",
											children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "素材授权到期日期" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
												type: "date",
												value: form.rightsEndDate,
												onChange: (e) => update("rightsEndDate", e.target.value)
											})]
										})
									]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
									className: "cw-field",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "权益内容与素材使用范围" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", {
										value: form.rightsScope,
										onChange: (e) => update("rightsScope", e.target.value),
										placeholder: "姓名、肖像、信息流、直播间、原片、混剪、二创或 AI 衍生等实际权益"
									})]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
									className: "cw-field",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "授权书或合同链接" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
										value: form.rightsFileUrl,
										onChange: (e) => update("rightsFileUrl", e.target.value),
										placeholder: "可粘贴飞书文档或云盘链接"
									})]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
									className: "cw-grid3",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
										className: "cw-field",
										children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "合作结论" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", {
											value: form.decision,
											onChange: (e) => update("decision", e.target.value),
											children: [
												/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: "推进" }),
												/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: "观察" }),
												/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: "暂缓" }),
												/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: "不合作" })
											]
										})]
									}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
										className: "cw-field cw-span2",
										children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "价值判断与原因" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", {
											value: form.valueJudgement,
											onChange: (e) => update("valueJudgement", e.target.value),
											placeholder: "自由填写为什么选择、暂缓或不选择这位明星，以及本次合作的价值判断"
										})]
									})]
								})
							]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "cw-form-section",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "03 / 执行关键时间" }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
									className: "cw-grid3",
									children: [
										/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
											className: "cw-field",
											children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "计划拍摄日" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
												type: "date",
												value: form.shootDate,
												onChange: (e) => update("shootDate", e.target.value)
											})]
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
											className: "cw-field",
											children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "计划收片日" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
												type: "date",
												value: form.finalDate,
												onChange: (e) => update("finalDate", e.target.value)
											})]
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
											className: "cw-field",
											children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "计划上线日" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
												type: "date",
												value: form.launchDate,
												onChange: (e) => update("launchDate", e.target.value)
											})]
										})
									]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
									className: "cw-grid3",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
										className: "cw-field cw-span2",
										children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "下一节点" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
											value: form.nextMilestone,
											onChange: (e) => update("nextMilestone", e.target.value)
										})]
									}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
										className: "cw-field",
										children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "下一节点截止日" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
											type: "date",
											value: form.eta,
											onChange: (e) => update("eta", e.target.value)
										})]
									})]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
									className: "cw-field",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "上线与一创再利用规划" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", {
										value: form.firstCreationPlan,
										onChange: (e) => update("firstCreationPlan", e.target.value),
										placeholder: "计划测试的文案框架、混剪方向、一创负责人及交付安排"
									})]
								})
							]
						}),
						error && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "cw-error",
							children: error
						})
					]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("footer", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					className: "cw-cancel",
					onClick: onClose,
					children: "取消"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
					className: "cw-primary",
					disabled: busy,
					onClick: submit,
					children: [busy ? "正在建立…" : "建立合作项目", " ↗"]
				})] })
			]
		})
	});
}
function SubmitModal({ users, currentUser, onClose, onCreated }) {
	const [form, setForm] = (0, import_react.useState)({
		reviewSection: "文案审核",
		scriptType: SCRIPT_TYPES[0],
		cooperationType: "达人合作",
		materialName: "",
		authorId: currentUser.id,
		product: PRODUCTS[0],
		feishuUrl: "",
		artistName: "",
		projectName: "",
		priority: "普通",
		dueDate: "",
		note: ""
	});
	const [reviewers, setReviewers] = (0, import_react.useState)({
		team_lead: "",
		supervisor: "",
		director: ""
	});
	const [importMode, setImportMode] = (0, import_react.useState)("single");
	const [batchText, setBatchText] = (0, import_react.useState)("");
	const [error, setError] = (0, import_react.useState)("");
	const [busy, setBusy] = (0, import_react.useState)(false);
	const update = (key, value) => setForm((current) => ({
		...current,
		[key]: value
	}));
	const submit = async () => {
		setBusy(true);
		setError("");
		try {
			const route = Object.entries(reviewers).filter(([, reviewerId]) => reviewerId).map(([role, reviewerId]) => ({
				role,
				reviewerId
			}));
			const entries = importMode === "single" ? [{
				materialName: form.materialName,
				feishuUrl: form.feishuUrl
			}] : batchText.split(/\n+/).map((line, index) => {
				const trimmed = line.trim();
				const link = trimmed.match(/https:\/\/\S+/)?.[0] ?? "";
				return {
					materialName: trimmed.replace(link, "").replace(/^[\s|｜,，;；:：-]+|[\s|｜,，;；:：-]+$/g, "") || `批量审核素材 ${String(index + 1).padStart(2, "0")}`,
					feishuUrl: link
				};
			}).filter((entry) => entry.feishuUrl);
			if (!entries.length) throw new Error("请至少粘贴一条有效的飞书链接");
			for (const entry of entries) {
				const response = await fetch(api, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						...form,
						...entry,
						reviewers: route
					})
				});
				const payload = await response.json();
				if (!response.ok) throw new Error(`${entry.materialName}：${payload.error || "提交失败"}`);
			}
			onCreated();
		} catch (error) {
			setError(error instanceof Error ? error.message : "提交失败");
		} finally {
			setBusy(false);
		}
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "cw-modal-bg",
		onMouseDown: (event) => event.target === event.currentTarget && onClose(),
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
			className: "cw-modal",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "NEW REVIEW / FEISHU LINK" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "发起审核任务" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "只提交飞书链接；审核人按勾选层级依次流转。" })
				] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					onClick: onClose,
					children: "×"
				})] }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "cw-form",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "cw-grid3",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
									className: "cw-field",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "审核分类" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", {
										value: form.reviewSection,
										onChange: (e) => update("reviewSection", e.target.value),
										children: [
											/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: "文案审核" }),
											/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: "拍摄场地审核" }),
											/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: "妆造方案审核" })
										]
									})]
								}),
								form.reviewSection === "文案审核" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
									className: "cw-field",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "脚本类型" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("select", {
										value: form.scriptType,
										onChange: (e) => update("scriptType", e.target.value),
										children: SCRIPT_TYPES.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: entry }, entry))
									})]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
									className: "cw-field",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "合作类型" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
										value: form.cooperationType,
										onChange: (e) => update("cooperationType", e.target.value)
									})]
								})
							]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "cw-import-mode",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
									className: importMode === "single" ? "active" : "",
									onClick: () => setImportMode("single"),
									children: "单条链接"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
									className: importMode === "batch" ? "active" : "",
									onClick: () => setImportMode("batch"),
									children: "批量导入链接"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: importMode === "batch" ? "一行一条，可写“素材名称｜飞书链接”" : "提交一份素材" })
							]
						}),
						importMode === "single" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
							className: "cw-field",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "素材名称" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
								value: form.materialName,
								onChange: (e) => update("materialName", e.target.value),
								placeholder: "例如：海清黑晶面膜第一版脚本"
							})]
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
							className: "cw-field",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "飞书链接" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
								value: form.feishuUrl,
								onChange: (e) => update("feishuUrl", e.target.value),
								placeholder: "粘贴飞书文档 / 表格 / 幻灯片 / 知识库链接"
							})]
						})] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
							className: "cw-field",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "批量素材与飞书链接" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", {
								className: "cw-batch-links",
								value: batchText,
								onChange: (e) => setBatchText(e.target.value),
								placeholder: "海清第一版脚本｜https://fandow.feishu.cn/docx/...\n海清第二版脚本｜https://fandow.feishu.cn/docx/...\nhttps://fandow.feishu.cn/wiki/..."
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "cw-grid3",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(PeoplePicker, {
									label: "作者",
									users,
									value: form.authorId,
									onChange: (value) => update("authorId", value)
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
									className: "cw-field",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "单品" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("select", {
										value: form.product,
										onChange: (e) => update("product", e.target.value),
										children: PRODUCTS.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: entry }, entry))
									})]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
									className: "cw-field",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "合作艺人" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
										value: form.artistName,
										onChange: (e) => update("artistName", e.target.value),
										placeholder: "可选"
									})]
								})
							]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "cw-path-title",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "REVIEW PATH" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "勾选实际需要的审核人" })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "系统自动按层级排序" })]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "cw-review-route",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(PeoplePicker, {
									label: "01 · 组长审核（可跳过）",
									users,
									value: reviewers.team_lead,
									onChange: (value) => setReviewers((current) => ({
										...current,
										team_lead: value
									}))
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "→" }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(PeoplePicker, {
									label: "02 · 主管审核（可跳过）",
									users,
									value: reviewers.supervisor,
									onChange: (value) => setReviewers((current) => ({
										...current,
										supervisor: value
									}))
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "→" }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(PeoplePicker, {
									label: "03 · 总监审核（可跳过）",
									users,
									value: reviewers.director,
									onChange: (value) => setReviewers((current) => ({
										...current,
										director: value
									}))
								})
							]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "cw-grid3",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
									className: "cw-field",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "优先级" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", {
										value: form.priority,
										onChange: (e) => update("priority", e.target.value),
										children: [
											/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: "紧急" }),
											/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: "普通" }),
											/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: "低" })
										]
									})]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
									className: "cw-field",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "截止时间" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
										type: "date",
										value: form.dueDate,
										onChange: (e) => update("dueDate", e.target.value)
									})]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
									className: "cw-field",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "关联项目" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
										value: form.projectName,
										onChange: (e) => update("projectName", e.target.value),
										placeholder: "可选"
									})]
								})
							]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
							className: "cw-field",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "补充说明" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", {
								value: form.note,
								onChange: (e) => update("note", e.target.value),
								placeholder: "背景、重点或需要审核人特别关注的内容"
							})]
						}),
						error && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "cw-error",
							children: error
						})
					]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("footer", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					className: "cw-cancel",
					onClick: onClose,
					children: "取消"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
					className: "cw-primary",
					disabled: busy,
					onClick: submit,
					children: [busy ? "正在提交…" : "确认并发起审核", " ↗"]
				})] })
			]
		})
	});
}
function VideoSubmitModal({ users, currentUser, onClose, onCreated }) {
	const [form, setForm] = (0, import_react.useState)({
		materialName: "",
		scriptType: SCRIPT_TYPES[0],
		cooperationType: "成片",
		authorId: currentUser.id,
		product: PRODUCTS[0],
		artistName: "",
		projectName: "",
		priority: "普通",
		dueDate: "",
		note: ""
	});
	const [reviewers, setReviewers] = (0, import_react.useState)({
		team_lead: "",
		supervisor: "",
		director: ""
	});
	const [files, setFiles] = (0, import_react.useState)([]);
	const [error, setError] = (0, import_react.useState)("");
	const [busy, setBusy] = (0, import_react.useState)(false);
	const [progress, setProgress] = (0, import_react.useState)("");
	const update = (key, value) => setForm((current) => ({
		...current,
		[key]: value
	}));
	const submit = async () => {
		setBusy(true);
		setError("");
		try {
			const route = Object.entries(reviewers).filter(([, reviewerId]) => reviewerId).map(([role, reviewerId]) => ({
				role,
				reviewerId
			}));
			if (!files.length) throw new Error("请至少上传一个 MP4 或 MOV 视频");
			await uploadVideoFiles({
				mode: "create",
				metadata: {
					...form,
					reviewers: route
				},
				files,
				onProgress: setProgress
			});
			onCreated();
		} catch (error) {
			setError(error instanceof Error ? error.message : "提交失败");
		} finally {
			setBusy(false);
		}
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "cw-modal-bg",
		onMouseDown: (event) => event.target === event.currentTarget && onClose(),
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
			className: "cw-modal",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "NEW VIDEO REVIEW / MP4 · MOV" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "发起视频审核任务" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "同一任务可上传多个成片，并按所选审核人依次流转。" })
				] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					onClick: onClose,
					children: "×"
				})] }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "cw-form",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "cw-grid3",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
									className: "cw-field",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "视频素材名称" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
										value: form.materialName,
										onChange: (e) => update("materialName", e.target.value),
										placeholder: "例如：海清黑晶面膜首轮成片"
									})]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
									className: "cw-field",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "视频类型" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("select", {
										value: form.scriptType,
										onChange: (e) => update("scriptType", e.target.value),
										children: SCRIPT_TYPES.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
											value: entry,
											children: videoTypeText(entry)
										}, entry))
									})]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
									className: "cw-field",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "合作类型" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
										value: form.cooperationType,
										onChange: (e) => update("cooperationType", e.target.value)
									})]
								})
							]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
							className: "cw-video-drop",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
									type: "file",
									accept: "video/mp4,video/quicktime,.mp4,.mov",
									multiple: true,
									onChange: (event) => setFiles(Array.from(event.target.files ?? []))
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "＋" }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "上传 MP4 / MOV 成片" }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "可一次选择多个视频；平台不设置业务大小上限" })
							]
						}),
						files.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "cw-file-list",
							children: files.map((file) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: file.name }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("small", { children: [(file.size / 1024 / 1024).toFixed(1), " MB"] })] }, `${file.name}-${file.size}`))
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "cw-grid3",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(PeoplePicker, {
									label: "作者",
									users,
									value: form.authorId,
									onChange: (value) => update("authorId", value)
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
									className: "cw-field",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "单品" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("select", {
										value: form.product,
										onChange: (e) => update("product", e.target.value),
										children: PRODUCTS.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: entry }, entry))
									})]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
									className: "cw-field",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "合作艺人" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
										value: form.artistName,
										onChange: (e) => update("artistName", e.target.value),
										placeholder: "可选"
									})]
								})
							]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "cw-path-title",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "REVIEW PATH" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "勾选实际需要的审核人" })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "与脚本审核路径一致" })]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "cw-review-route",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(PeoplePicker, {
									label: "01 · 组长审核（可跳过）",
									users,
									value: reviewers.team_lead,
									onChange: (value) => setReviewers((current) => ({
										...current,
										team_lead: value
									}))
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "→" }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(PeoplePicker, {
									label: "02 · 主管审核（可跳过）",
									users,
									value: reviewers.supervisor,
									onChange: (value) => setReviewers((current) => ({
										...current,
										supervisor: value
									}))
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "→" }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(PeoplePicker, {
									label: "03 · 总监审核（可跳过）",
									users,
									value: reviewers.director,
									onChange: (value) => setReviewers((current) => ({
										...current,
										director: value
									}))
								})
							]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "cw-grid3",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
									className: "cw-field",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "优先级" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", {
										value: form.priority,
										onChange: (e) => update("priority", e.target.value),
										children: [
											/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: "紧急" }),
											/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: "普通" }),
											/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: "低" })
										]
									})]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
									className: "cw-field",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "截止时间" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
										type: "date",
										value: form.dueDate,
										onChange: (e) => update("dueDate", e.target.value)
									})]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
									className: "cw-field",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "关联项目" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
										value: form.projectName,
										onChange: (e) => update("projectName", e.target.value),
										placeholder: "可选"
									})]
								})
							]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
							className: "cw-field",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "补充说明" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", {
								value: form.note,
								onChange: (e) => update("note", e.target.value),
								placeholder: "审核重点、版本说明或需要特别关注的画面"
							})]
						}),
						error && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "cw-error",
							children: error
						})
					]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("footer", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					className: "cw-cancel",
					disabled: busy,
					onClick: onClose,
					children: "取消"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
					className: "cw-primary",
					disabled: busy,
					onClick: submit,
					children: [busy ? progress || "正在建立上传任务…" : `上传 ${files.length || ""} 个视频并发起审核`, " ↗"]
				})] })
			]
		})
	});
}
function ReviewDrawer({ item, currentUser, busy, onClose, onAction, onVideoResubmit, onDelete }) {
	const [comment, setComment] = (0, import_react.useState)("");
	const [videoFiles, setVideoFiles] = (0, import_react.useState)([]);
	const canReview = item.reviewers.find((step) => step.status === "active")?.reviewerId === currentUser.id;
	const canResubmit = item.status === "returned" && (item.submitterId === currentUser.id || item.authorId === currentUser.id);
	const canDelete = currentUser.name === "李雨橦" || currentUser.id.toUpperCase() === "FD-023794" || item.submitterId === currentUser.id || item.authorId === currentUser.id;
	const decisionPanel = (canReview || canResubmit) && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
		className: "cw-decision",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: canReview ? "REVIEW DECISION" : "RESUBMIT" }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: canReview ? "填写本次审核意见" : item.contentType === "video" ? "上传新版本视频并重新提交" : "确认已在原飞书文档完成修改" }),
			canResubmit && item.contentType === "video" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
				className: "cw-mini-upload",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
					type: "file",
					accept: "video/mp4,video/quicktime,.mp4,.mov",
					multiple: true,
					onChange: (event) => setVideoFiles(Array.from(event.target.files ?? []))
				}), "选择新版本 MP4 / MOV"]
			}), videoFiles.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: videoFiles.map((file) => file.name).join("、") })] }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", {
				value: comment,
				onChange: (e) => setComment(e.target.value),
				placeholder: canReview ? "退回时必须填写；通过时可选填。" : "可补充本轮修改说明"
			}),
			canReview ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				disabled: busy,
				className: "cw-return",
				onClick: () => onAction("return", comment),
				children: "退回素材"
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				disabled: busy,
				className: "cw-primary",
				onClick: () => onAction("pass", comment),
				children: "通过审核 ↗"
			})] }) : item.contentType === "video" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				disabled: busy || !videoFiles.length,
				className: "cw-primary full",
				onClick: () => onVideoResubmit(videoFiles, comment),
				children: "上传新版本并重新提交 ↗"
			}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				disabled: busy,
				className: "cw-primary full",
				onClick: () => onAction("resubmit", comment),
				children: "重新提交全部审核人 ↗"
			})
		]
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "cw-drawer-bg",
		onMouseDown: (event) => event.target === event.currentTarget && onClose(),
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("aside", {
			className: `cw-drawer ${item.contentType === "video" ? "video-review" : ""}`,
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("small", { children: [
					item.id,
					" / ",
					item.reviewSection
				] }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: item.materialName }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: statusText(item) })
			] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				onClick: onClose,
				children: "×"
			})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "cw-drawer-body",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "cw-facts",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "作者" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: item.authorName })] }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "单品" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: item.product || "—" })] }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "优先级" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: item.priority })] }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "截止" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: item.dueDate || "未设置" })] })
						]
					}),
					item.feishuUrl && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("a", {
						className: "cw-doc-link",
						href: item.feishuUrl,
						target: "_blank",
						rel: "noreferrer",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "飞书文档" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "打开并查看完整内容" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "↗" })
						]
					}),
					item.media.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(VideoAnnotationWorkspace, {
						item,
						currentUser
					}),
					item.contentType === "video" && decisionPanel,
					item.note && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "cw-note",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "发起说明" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: item.note })]
					}),
					item.copy && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
						className: "cw-legacy-copy",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "ARCHIVED SCRIPT" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "脚本文案" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: item.copy })
						]
					}),
					item.reviewers.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
						className: "cw-route",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "REVIEW ROUTE" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "审核路径" }),
							item.reviewers.map((step) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: step.status,
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { children: step.stepOrder }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: step.roleLabel }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: step.reviewerName })] }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Badge, {
										tone: step.status === "passed" ? "success" : step.status === "returned" ? "danger" : step.status === "active" ? "active" : "plain",
										children: step.status === "passed" ? "已通过" : step.status === "returned" ? "已退回" : step.status === "active" ? "审核中" : "等待"
									}),
									step.comment && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: step.comment })
								]
							}, step.id))
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
						className: "cw-history",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "HISTORY" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "审核记录与修改需求" }),
							item.events.map((event) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", {}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("strong", { children: [
									event.actorName,
									" · ",
									event.action === "submit" ? "提交审核" : event.action === "pass" ? "通过审核" : event.action === "return" ? "退回修改" : event.action === "resubmit" ? "重新提交" : "自动存档"
								] }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: event.comment || "无补充意见" }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("time", { children: event.createdAt.replace("T", " ").slice(0, 16) })
							] })] }, event.id))
						]
					}),
					item.contentType !== "video" && decisionPanel,
					canDelete && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
						className: "cw-delete-zone",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "DELETE MATERIAL" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("strong", { children: ["删除这条", item.contentType === "video" ? "视频" : "文案"] }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "退回和已存档内容均可删除；删除后不能恢复。" })
						] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							disabled: busy,
							onClick: onDelete,
							children: "删除"
						})]
					})
				]
			})]
		})
	});
}
function DeleteConfirm({ item, busy, onCancel, onConfirm }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "cw-modal-bg cw-confirm-bg",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
			className: "cw-confirm",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "!" }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "DELETE CONFIRMATION" }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h2", { children: [
					"确定删除“",
					item.materialName,
					"”吗？"
				] }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { children: [item.contentType === "video" ? "视频文件、历史版本、审核路径和审核记录" : "文案任务、审核路径和审核记录", "将被永久删除，无法恢复。"] }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					disabled: busy,
					onClick: onCancel,
					children: "取消"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					disabled: busy,
					onClick: onConfirm,
					children: busy ? "正在删除…" : "确认删除"
				})] })
			]
		})
	});
}
function VideoAnnotationWorkspace({ item, currentUser }) {
	const orderedMedia = [...item.media].sort((a, b) => b.version - a.version || b.createdAt.localeCompare(a.createdAt));
	const [selectedId, setSelectedId] = (0, import_react.useState)(orderedMedia[0]?.id ?? "");
	const [comments, setComments] = (0, import_react.useState)([]);
	const [draft, setDraft] = (0, import_react.useState)("");
	const [captured, setCaptured] = (0, import_react.useState)(null);
	const [message, setMessage] = (0, import_react.useState)("");
	const [saving, setSaving] = (0, import_react.useState)(false);
	const videoRef = (0, import_react.useRef)(null);
	const selected = orderedMedia.find((media) => media.id === selectedId) ?? orderedMedia[0];
	const visibleComments = comments.filter((comment) => comment.mediaId === selected?.id);
	const loadComments = async () => {
		const response = await fetch(`${videoCommentsApi}?itemId=${encodeURIComponent(item.id)}`, { cache: "no-store" });
		const payload = await readApiPayload(response);
		if (!response.ok) throw new Error(payload.error || "读取画面意见失败");
		setComments(payload.comments ?? []);
	};
	(0, import_react.useEffect)(() => {
		loadComments().catch((error) => setMessage(error.message));
	}, [item.id]);
	(0, import_react.useEffect)(() => {
		setCaptured(null);
		setDraft("");
	}, [selectedId]);
	const captureFrame = async () => {
		const video = videoRef.current;
		if (!video || !selected) return;
		video.pause();
		const time = video.currentTime || 0;
		let preview = "";
		let blob = null;
		if (video.readyState >= 2 && video.videoWidth && video.videoHeight) {
			const canvas = document.createElement("canvas");
			const scale = Math.min(1, 720 / video.videoWidth);
			canvas.width = Math.round(video.videoWidth * scale);
			canvas.height = Math.round(video.videoHeight * scale);
			canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
			preview = canvas.toDataURL("image/jpeg", .78);
			blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", .78));
		}
		setCaptured({
			time,
			preview,
			blob
		});
	};
	const saveComment = async () => {
		if (!selected || !captured || !draft.trim()) return;
		setSaving(true);
		setMessage("");
		try {
			const form = new FormData();
			form.append("itemId", item.id);
			form.append("mediaId", selected.id);
			form.append("timeSeconds", String(captured.time));
			form.append("comment", draft.trim());
			if (captured.blob) form.append("screenshot", captured.blob, "frame.jpg");
			const response = await fetch(videoCommentsApi, {
				method: "POST",
				body: form
			});
			const payload = await readApiPayload(response);
			if (!response.ok) throw new Error(payload.error || "保存失败");
			await loadComments();
			setCaptured(null);
			setDraft("");
		} catch (error) {
			setMessage(error instanceof Error ? error.message : "保存失败");
		} finally {
			setSaving(false);
		}
	};
	const toggleResolved = async (comment) => {
		const response = await fetch(videoCommentsApi, {
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				id: comment.id,
				status: comment.status === "resolved" ? "open" : "resolved"
			})
		});
		const payload = await readApiPayload(response);
		if (!response.ok) return setMessage(payload.error || "更新失败");
		await loadComments();
	};
	const jumpTo = (time) => {
		if (!videoRef.current) return;
		videoRef.current.currentTime = time;
		videoRef.current.pause();
	};
	if (!selected) return null;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
		className: "cw-video-review-workspace",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "cw-video-stage",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "cw-video-tabs",
					children: orderedMedia.map((media) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
						className: media.id === selected.id ? "active" : "",
						onClick: () => setSelectedId(media.id),
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("b", { children: ["V", media.version] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: media.originalName })]
					}, media.id))
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("video", {
					ref: videoRef,
					controls: true,
					preload: "metadata",
					src: `${base}${selected.url}`
				}, selected.id),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "cw-video-stage-foot",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: selected.originalName }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("small", { children: [
						(selected.sizeBytes / 1024 / 1024).toFixed(1),
						" MB · V",
						selected.version
					] })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						onClick: captureFrame,
						children: "＋ 在当前画面添加意见"
					})]
				})
			]
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("aside", {
			className: "cw-frame-comments",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "FRAME COMMENTS" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "画面修改意见" })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [visibleComments.filter((entry) => entry.status !== "resolved").length, " 条待处理"] })] }),
				captured && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "cw-frame-composer",
					children: [
						captured.preview ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", {
							src: captured.preview,
							alt: "当前视频画面"
						}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "cw-frame-placeholder",
							children: "当前画面"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: formatVideoTime(captured.time) }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", {
							autoFocus: true,
							value: draft,
							onChange: (event) => setDraft(event.target.value),
							placeholder: "描述这个画面需要如何修改…"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							onClick: () => {
								setCaptured(null);
								setDraft("");
							},
							children: "取消"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							disabled: saving || !draft.trim(),
							onClick: saveComment,
							children: saving ? "保存中…" : "保存意见"
						})] })
					]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
					className: "cw-frame-comment-list",
					children: visibleComments.length ? visibleComments.map((comment) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
						className: comment.status === "resolved" ? "resolved" : "",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
							className: "cw-frame-jump",
							onClick: () => jumpTo(comment.timeSeconds),
							children: [comment.screenshotUrl ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", {
								src: `${base}${comment.screenshotUrl}`,
								alt: "意见对应画面"
							}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "▶" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: formatVideoTime(comment.timeSeconds) })]
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: comment.comment }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("small", { children: [
								comment.authorName,
								" · ",
								comment.createdAt.replace("T", " ").slice(0, 16)
							] }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								onClick: () => toggleResolved(comment),
								children: comment.status === "resolved" ? "重新打开" : "标记已解决"
							})
						] })]
					}, comment.id)) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "cw-frame-empty",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "◎" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "暂时没有画面意见" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "播放到需要修改的位置，点击“在当前画面添加意见”。" })
						]
					})
				}),
				message && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "cw-frame-error",
					children: message
				})
			]
		})]
	});
}
function ProjectDrawer({ project, onClose, onOpenItem }) {
	const rights = rightsStatus(project);
	const stages = [
		["合作确认", project.decision === "推进" ? "已确认推进合作，继续完成权益与授权信息。" : `当前合作结论：${project.decision || "待判断"}`],
		["内容生产", project.prepSummary || project.scriptSummary || "拉群、档期、酒店场地、妆造、脚本、分镜、拍摄团队与现场拍摄统一在此推进。"],
		["成片审核", project.productionSummary || "样片回传后，分别记录内部审核、修改版本及艺人方审核进度。"],
		["上线与一创再利用", project.firstCreationPlan || project.launchSummary || "记录正式上线、文案与框架裂变、混剪二创及下一轮优化方向。"]
	];
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "cw-drawer-bg",
		onMouseDown: (event) => event.target === event.currentTarget && onClose(),
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("aside", {
			className: "cw-drawer project star-project",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("small", { children: [
					starType(project.projectType),
					" / ",
					project.phase
				] }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h2", { children: [
					project.artistName,
					" × ",
					project.product,
					" · ",
					projectPeriod(project.projectPeriod)
				] }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { children: ["下一节点：", project.nextMilestone || "待补充"] })
			] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				onClick: onClose,
				children: "×"
			})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "cw-drawer-body",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "cw-star-summary",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "项目负责人" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: project.owner })] }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "明星档案建档人" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: project.creatorName || project.owner })] }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "当前阶段" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: project.phase })] }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "下一节点截止" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: project.eta || "待定" })] }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "授权状态" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", {
								className: rights.tone === "danger" ? "danger" : "",
								children: rights.label
							})] })
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
						className: "cw-star-detail-section",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "cw-detail-heading",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "STAR & COLLABORATION" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "明星与合作信息" })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Badge, {
									tone: project.decision === "推进" ? "success" : "plain",
									children: project.decision || "推进"
								})]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "cw-detail-grid",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "明星类型" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: starType(project.projectType) })] }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "合作单品" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: project.product })] }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "实际合作费用" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: project.actualFee || "待补充" })] }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "判断人 / 时间" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("b", { children: [project.decisionBy || project.owner, project.decisionAt ? ` · ${project.decisionAt.slice(0, 10)}` : ""] })] })
								]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "cw-detail-copy",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "价值判断与原因" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: project.valueJudgement || "等待负责人补充本次选择、暂缓或不合作的价值判断。" })]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "cw-detail-copy",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "权益内容与素材使用范围" }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: project.rightsScope || "等待补充姓名、肖像、渠道及原片、混剪、二创等实际使用权益。" }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("footer", { children: [
										/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: ["授权起始 ", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: project.rightsStartDate || "待补充" })] }),
										/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: ["授权到期 ", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: project.rightsEndDate || "待补充" })] }),
										project.rightsFileUrl && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", {
											href: project.rightsFileUrl,
											target: "_blank",
											rel: "noreferrer",
											children: "查看授权文件 ↗"
										})
									] })
								]
							})
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
						className: "cw-star-detail-section",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "cw-detail-heading",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "EXECUTION PROGRESS" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "项目执行进度" })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Badge, {
									tone: "active",
									children: [phaseProgress(project.phase), "%"]
								})]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "cw-key-dates",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "计划拍摄" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: project.shootDate || "待定" })] }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { children: "→" }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "计划收片" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: project.finalDate || "待定" })] }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { children: "→" }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "计划上线" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: project.launchDate || "待定" })] })
								]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "cw-project-blocks cw-star-stages",
								children: stages.map(([title, detail], index) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
									className: phaseProgress(project.phase) >= [
										10,
										35,
										60,
										80
									][index] ? "active" : "",
									children: [
										/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("i", { children: ["0", index + 1] }),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "PROJECT STAGE" }),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: title }),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: detail })
									]
								}, title))
							})
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
						className: "cw-linked",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "LINKED REVIEW TASKS" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "关联脚本与视频审核" }),
							project.linkedItems.length ? project.linkedItems.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TaskCard, {
								item,
								onOpen: onOpenItem
							}, item.id)) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Empty, {
								title: "暂无关联审核任务",
								detail: "发起脚本或视频审核时填写明星姓名，即可自动汇入该明星项目。"
							})
						]
					})
				]
			})]
		})
	});
}
//#endregion
export { CreativeWorkbench as default };
