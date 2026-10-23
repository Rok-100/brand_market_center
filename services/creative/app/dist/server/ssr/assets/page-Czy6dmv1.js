import { a as require_react, o as __toESM, t as require_jsx_runtime } from "../index.js";
//#region node_modules/.pnpm/fflate@0.8.3/node_modules/fflate/esm/browser.js
var import_react = /* @__PURE__ */ __toESM(require_react(), 1);
var u8 = Uint8Array, u16 = Uint16Array, i32 = Int32Array;
var fleb = new u8([
	0,
	0,
	0,
	0,
	0,
	0,
	0,
	0,
	1,
	1,
	1,
	1,
	2,
	2,
	2,
	2,
	3,
	3,
	3,
	3,
	4,
	4,
	4,
	4,
	5,
	5,
	5,
	5,
	0,
	0,
	0,
	0
]);
var fdeb = new u8([
	0,
	0,
	0,
	0,
	1,
	1,
	2,
	2,
	3,
	3,
	4,
	4,
	5,
	5,
	6,
	6,
	7,
	7,
	8,
	8,
	9,
	9,
	10,
	10,
	11,
	11,
	12,
	12,
	13,
	13,
	0,
	0
]);
var clim = new u8([
	16,
	17,
	18,
	0,
	8,
	7,
	9,
	6,
	10,
	5,
	11,
	4,
	12,
	3,
	13,
	2,
	14,
	1,
	15
]);
var freb = function(eb, start) {
	var b = new u16(31);
	for (var i = 0; i < 31; ++i) b[i] = start += 1 << eb[i - 1];
	var r = new i32(b[30]);
	for (var i = 1; i < 30; ++i) for (var j = b[i]; j < b[i + 1]; ++j) r[j] = j - b[i] << 5 | i;
	return {
		b,
		r
	};
};
var _a = freb(fleb, 2), fl = _a.b, revfl = _a.r;
fl[28] = 258, revfl[258] = 28;
var _b = freb(fdeb, 0), fd = _b.b;
_b.r;
var rev = new u16(32768);
for (var i = 0; i < 32768; ++i) {
	var x = (i & 43690) >> 1 | (i & 21845) << 1;
	x = (x & 52428) >> 2 | (x & 13107) << 2;
	x = (x & 61680) >> 4 | (x & 3855) << 4;
	rev[i] = ((x & 65280) >> 8 | (x & 255) << 8) >> 1;
}
var hMap = (function(cd, mb, r) {
	var s = cd.length;
	var i = 0;
	var l = new u16(mb);
	for (; i < s; ++i) if (cd[i]) ++l[cd[i] - 1];
	var le = new u16(mb);
	for (i = 1; i < mb; ++i) le[i] = le[i - 1] + l[i - 1] << 1;
	var co;
	if (r) {
		co = new u16(1 << mb);
		var rvb = 15 - mb;
		for (i = 0; i < s; ++i) if (cd[i]) {
			var sv = i << 4 | cd[i];
			var r_1 = mb - cd[i];
			var v = le[cd[i] - 1]++ << r_1;
			for (var m = v | (1 << r_1) - 1; v <= m; ++v) co[rev[v] >> rvb] = sv;
		}
	} else {
		co = new u16(s);
		for (i = 0; i < s; ++i) if (cd[i]) co[i] = rev[le[cd[i] - 1]++] >> 15 - cd[i];
	}
	return co;
});
var flt = new u8(288);
for (var i = 0; i < 144; ++i) flt[i] = 8;
for (var i = 144; i < 256; ++i) flt[i] = 9;
for (var i = 256; i < 280; ++i) flt[i] = 7;
for (var i = 280; i < 288; ++i) flt[i] = 8;
var fdt = new u8(32);
for (var i = 0; i < 32; ++i) fdt[i] = 5;
var flrm = /* @__PURE__ */ hMap(flt, 9, 1), fdrm = /* @__PURE__ */ hMap(fdt, 5, 1);
var max = function(a) {
	var m = a[0];
	for (var i = 1; i < a.length; ++i) if (a[i] > m) m = a[i];
	return m;
};
var bits = function(d, p, m) {
	var o = p / 8 | 0;
	return (d[o] | d[o + 1] << 8) >> (p & 7) & m;
};
var bits16 = function(d, p) {
	var o = p / 8 | 0;
	return (d[o] | d[o + 1] << 8 | d[o + 2] << 16) >> (p & 7);
};
var shft = function(p) {
	return (p + 7) / 8 | 0;
};
var slc = function(v, s, e) {
	if (s == null || s < 0) s = 0;
	if (e == null || e > v.length) e = v.length;
	return new u8(v.subarray(s, e));
};
var ec = [
	"unexpected EOF",
	"invalid block type",
	"invalid length/literal",
	"invalid distance",
	"stream finished",
	"no stream handler",
	,
	"no callback",
	"invalid UTF-8 data",
	"extra field too long",
	"date not in range 1980-2099",
	"filename too long",
	"stream finishing",
	"invalid zip data"
];
var err = function(ind, msg, nt) {
	var e = new Error(msg || ec[ind]);
	e.code = ind;
	if (Error.captureStackTrace) Error.captureStackTrace(e, err);
	if (!nt) throw e;
	return e;
};
var inflt = function(dat, st, buf, dict) {
	var sl = dat.length, dl = dict ? dict.length : 0;
	if (!sl || st.f && !st.l) return buf || new u8(0);
	var noBuf = !buf;
	var resize = noBuf || st.i != 2;
	var noSt = st.i;
	if (noBuf) buf = new u8(sl * 3);
	var cbuf = function(l) {
		var bl = buf.length;
		if (l > bl) {
			var nbuf = new u8(Math.max(bl * 2, l));
			nbuf.set(buf);
			buf = nbuf;
		}
	};
	var final = st.f || 0, pos = st.p || 0, bt = st.b || 0, lm = st.l, dm = st.d, lbt = st.m, dbt = st.n;
	var tbts = sl * 8;
	do {
		if (!lm) {
			final = bits(dat, pos, 1);
			var type = bits(dat, pos + 1, 3);
			pos += 3;
			if (!type) {
				var s = shft(pos) + 4, l = dat[s - 4] | dat[s - 3] << 8, t = s + l;
				if (t > sl) {
					if (noSt) err(0);
					break;
				}
				if (resize) cbuf(bt + l);
				buf.set(dat.subarray(s, t), bt);
				st.b = bt += l, st.p = pos = t * 8, st.f = final;
				continue;
			} else if (type == 1) lm = flrm, dm = fdrm, lbt = 9, dbt = 5;
			else if (type == 2) {
				var hLit = bits(dat, pos, 31) + 257, hcLen = bits(dat, pos + 10, 15) + 4;
				var tl = hLit + bits(dat, pos + 5, 31) + 1;
				pos += 14;
				var ldt = new u8(tl);
				var clt = new u8(19);
				for (var i = 0; i < hcLen; ++i) clt[clim[i]] = bits(dat, pos + i * 3, 7);
				pos += hcLen * 3;
				var clb = max(clt), clbmsk = (1 << clb) - 1;
				var clm = hMap(clt, clb, 1);
				for (var i = 0; i < tl;) {
					var r = clm[bits(dat, pos, clbmsk)];
					pos += r & 15;
					var s = r >> 4;
					if (s < 16) ldt[i++] = s;
					else {
						var c = 0, n = 0;
						if (s == 16) n = 3 + bits(dat, pos, 3), pos += 2, c = ldt[i - 1];
						else if (s == 17) n = 3 + bits(dat, pos, 7), pos += 3;
						else if (s == 18) n = 11 + bits(dat, pos, 127), pos += 7;
						while (n--) ldt[i++] = c;
					}
				}
				var lt = ldt.subarray(0, hLit), dt = ldt.subarray(hLit);
				lbt = max(lt);
				dbt = max(dt);
				lm = hMap(lt, lbt, 1);
				dm = hMap(dt, dbt, 1);
			} else err(1);
			if (pos > tbts) {
				if (noSt) err(0);
				break;
			}
		}
		if (resize) cbuf(bt + 131072);
		var lms = (1 << lbt) - 1, dms = (1 << dbt) - 1;
		var lpos = pos;
		for (;; lpos = pos) {
			var c = lm[bits16(dat, pos) & lms], sym = c >> 4;
			pos += c & 15;
			if (pos > tbts) {
				if (noSt) err(0);
				break;
			}
			if (!c) err(2);
			if (sym < 256) buf[bt++] = sym;
			else if (sym == 256) {
				lpos = pos, lm = null;
				break;
			} else {
				var add = sym - 254;
				if (sym > 264) {
					var i = sym - 257, b = fleb[i];
					add = bits(dat, pos, (1 << b) - 1) + fl[i];
					pos += b;
				}
				var d = dm[bits16(dat, pos) & dms], dsym = d >> 4;
				if (!d) err(3);
				pos += d & 15;
				var dt = fd[dsym];
				if (dsym > 3) {
					var b = fdeb[dsym];
					dt += bits16(dat, pos) & (1 << b) - 1, pos += b;
				}
				if (pos > tbts) {
					if (noSt) err(0);
					break;
				}
				if (resize) cbuf(bt + 131072);
				var end = bt + add;
				if (bt < dt) {
					var shift = dl - dt, dend = Math.min(dt, end);
					if (shift + bt < 0) err(3);
					for (; bt < dend; ++bt) buf[bt] = dict[shift + bt];
				}
				for (; bt < end; ++bt) buf[bt] = buf[bt - dt];
			}
		}
		st.l = lm, st.p = lpos, st.b = bt, st.f = final;
		if (lm) final = 1, st.m = lbt, st.d = dm, st.n = dbt;
	} while (!final);
	return bt != buf.length && noBuf ? slc(buf, 0, bt) : buf.subarray(0, bt);
};
var et = /* @__PURE__ */ new u8(0);
var b2 = function(d, b) {
	return d[b] | d[b + 1] << 8;
};
var b4 = function(d, b) {
	return (d[b] | d[b + 1] << 8 | d[b + 2] << 16 | d[b + 3] << 24) >>> 0;
};
var b8 = function(d, b) {
	return b4(d, b) + b4(d, b + 4) * 4294967296;
};
function inflateSync(data, opts) {
	return inflt(data, { i: 2 }, opts && opts.out, opts && opts.dictionary);
}
var td = typeof TextDecoder != "undefined" && /* @__PURE__ */ new TextDecoder();
try {
	td.decode(et, { stream: true });
} catch (e) {}
var dutf8 = function(d) {
	for (var r = "", i = 0;;) {
		var c = d[i++];
		var eb = (c > 127) + (c > 223) + (c > 239);
		if (i + eb > d.length) return {
			s: r,
			r: slc(d, i - 1)
		};
		if (!eb) r += String.fromCharCode(c);
		else if (eb == 3) c = ((c & 15) << 18 | (d[i++] & 63) << 12 | (d[i++] & 63) << 6 | d[i++] & 63) - 65536, r += String.fromCharCode(55296 | c >> 10, 56320 | c & 1023);
		else if (eb & 1) r += String.fromCharCode((c & 31) << 6 | d[i++] & 63);
		else r += String.fromCharCode((c & 15) << 12 | (d[i++] & 63) << 6 | d[i++] & 63);
	}
};
/**
* Converts a Uint8Array to a string
* @param dat The data to decode to string
* @param latin1 Whether or not to interpret the data as Latin-1. This should
*               not need to be true unless encoding to binary string.
* @returns The original UTF-8/Latin-1 string
*/
function strFromU8(dat, latin1) {
	if (latin1) {
		var r = "";
		for (var i = 0; i < dat.length; i += 16384) r += String.fromCharCode.apply(null, dat.subarray(i, i + 16384));
		return r;
	} else if (td) return td.decode(dat);
	else {
		var _a = dutf8(dat), s = _a.s, r = _a.r;
		if (r.length) err(8);
		return s;
	}
}
var slzh = function(d, b) {
	return b + 30 + b2(d, b + 26) + b2(d, b + 28);
};
var zh = function(d, b, z) {
	var fnl = b2(d, b + 28), efl = b2(d, b + 30), fn = strFromU8(d.subarray(b + 46, b + 46 + fnl), !(b2(d, b + 8) & 2048)), es = b + 46 + fnl;
	var _a = z64hs(d, es, efl, z, b4(d, b + 20), b4(d, b + 24), b4(d, b + 42)), sc = _a[0], su = _a[1], off = _a[2];
	return [
		b2(d, b + 10),
		sc,
		su,
		fn,
		es + efl + b2(d, b + 32),
		off
	];
};
var z64hs = function(d, b, l, z, sc, su, off) {
	var nsc = sc == 4294967295, nsu = su == 4294967295, noff = off == 4294967295, e = b + l;
	var nf = nsc + nsu + noff;
	if (z && nf) {
		for (; b + 4 < e; b += 4 + b2(d, b + 2)) if (b2(d, b) == 1) return [
			nsc ? b8(d, b + 4 + 8 * nsu) : sc,
			nsu ? b8(d, b + 4) : su,
			noff ? b8(d, b + 4 + 8 * (nsu + nsc)) : off,
			1
		];
		if (z < 2) err(13);
	}
	return [
		sc,
		su,
		off,
		0
	];
};
/**
* Synchronously decompresses a ZIP archive. Prefer using `unzip` for better
* performance with more than one file.
* @param data The raw compressed ZIP file
* @param opts The ZIP extraction options
* @returns The decompressed files
*/
function unzipSync(data, opts) {
	var files = {};
	var e = data.length - 22;
	for (; b4(data, e) != 101010256; --e) if (!e || data.length - e > 65558) err(13);
	var c = b2(data, e + 8);
	if (!c) return {};
	var o = b4(data, e + 16);
	var z = b4(data, e - 20) == 117853008;
	if (z) {
		var ze = b4(data, e - 12);
		z = b4(data, ze) == 101075792;
		if (z) {
			c = b4(data, ze + 32);
			o = b4(data, ze + 48);
		}
	}
	var fltr = opts && opts.filter;
	for (var i = 0; i < c; ++i) {
		var _a = zh(data, o, z), c_2 = _a[0], sc = _a[1], su = _a[2], fn = _a[3], no = _a[4], off = _a[5], b = slzh(data, off);
		o = no;
		if (!fltr || fltr({
			name: fn,
			size: sc,
			originalSize: su,
			compression: c_2
		})) if (!c_2) files[fn] = slc(data, b, b + sc);
		else if (c_2 == 8) files[fn] = inflateSync(data.subarray(b, b + sc), { out: new u8(su) });
		else err(14, "unknown compression type " + c_2);
	}
	return files;
}
//#endregion
//#region app/page.tsx
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
var PRODUCTS = [
	"眼膜",
	"水润面膜",
	"水油/蛋白喷雾",
	"美白针",
	"黄金面膜",
	"微针面膜",
	"燕窝面膜",
	"次抛精华"
];
var COMPETITOR_BRANDS = [
	"C咖",
	"谷雨",
	"韩束",
	"奕沃/EIIO",
	"达尔肤",
	"敷尔佳",
	"达肤妍",
	"丸美",
	"可逐/kazoo",
	"造物者",
	"RNW",
	"ELL",
	"原生密码",
	"百雀羚",
	"自然堂"
];
var APP_BASE = "/yxb/wis-marketing-hub/modules/creative-hub/".replace(/\/$/, "");
var appUrl = (path) => `${APP_BASE}${path}`;
var navItems = [
	{
		id: "overview",
		label: "创意总览",
		icon: "⌂"
	},
	{
		id: "daily",
		label: "日常脚本创作",
		icon: "＋"
	},
	{
		id: "review",
		label: "审核与反馈",
		icon: "✓"
	},
	{
		id: "cases",
		label: "品牌案例库",
		icon: "▦"
	},
	{
		id: "competitors",
		label: "竞对案例库",
		icon: "◫"
	},
	{
		id: "scripts",
		label: "AI 脚本创作",
		icon: "✦"
	},
	{
		id: "collaborations",
		label: "达人合作进度",
		icon: "◎"
	}
];
function AppIcon({ children }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
		className: "app-icon",
		children
	});
}
function Tag({ children, tone = "neutral" }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
		className: `tag tag-${tone}`,
		children
	});
}
function caringGreeting(name) {
	const hour = (/* @__PURE__ */ new Date()).getHours();
	if (hour < 5) return {
		title: `${name}，夜深了`,
		note: "辛苦了，先处理最紧要的一件事，也记得早点休息。"
	};
	if (hour < 11) return {
		title: `${name}，早上好！`,
		note: "新的一天慢慢展开，重要任务已经替你整理好了。"
	};
	if (hour < 14) return {
		title: `${name}，中午好！`,
		note: "忙碌之余记得好好吃饭，下午的任务也已为你归拢。"
	};
	if (hour < 18) return {
		title: `${name}，下午好！`,
		note: "保持自己的节奏，接下来先完成最有价值的工作。"
	};
	return {
		title: `${name}，晚上好！`,
		note: "今天辛苦了，收好最后几件事，就给自己留一点放松时间。"
	};
}
function Home() {
	const [view, setView] = (0, import_react.useState)("overview");
	const [search, setSearch] = (0, import_react.useState)("");
	const [caseFilter, setCaseFilter] = (0, import_react.useState)("全部");
	const [scriptTypeFilter, setScriptTypeFilter] = (0, import_react.useState)("全部脚本");
	const [caseItems, setCaseItems] = (0, import_react.useState)([]);
	const [casesLoading, setCasesLoading] = (0, import_react.useState)(true);
	const [casesError, setCasesError] = (0, import_react.useState)("");
	const [competitorItems, setCompetitorItems] = (0, import_react.useState)([]);
	const [competitorHasMore, setCompetitorHasMore] = (0, import_react.useState)(false);
	const [reviewDrafts, setReviewDrafts] = (0, import_react.useState)([]);
	const [workbench, setWorkbench] = (0, import_react.useState)(null);
	const [stats, setStats] = (0, import_react.useState)({
		cases: 0,
		videos: 0,
		competitors: 0,
		pendingReview: 0,
		approved: 0,
		collaborations: 0
	});
	const [toast, setToast] = (0, import_react.useState)(null);
	(0, import_react.useEffect)(() => {
		let active = true;
		fetch(appUrl("/api/cases")).then((response) => response.ok ? response.json() : Promise.reject(/* @__PURE__ */ new Error("品牌案例库暂不可用"))).then((payload) => {
			if (!active) return;
			setCaseItems(payload.cases ?? []);
			setCasesError("");
		}).catch(() => active && setCasesError("品牌案例暂时没有加载成功，请刷新页面重试。")).finally(() => active && setCasesLoading(false));
		fetch(appUrl("/api/workbench")).then((response) => response.ok ? response.json() : Promise.reject(/* @__PURE__ */ new Error("个人工作台暂不可用"))).then((payload) => {
			if (!active || !payload.user) return;
			setWorkbench(payload);
			const all = [
				...payload.assigned,
				...payload.returned,
				...payload.submissions,
				...payload.teamQueue
			];
			setReviewDrafts(Array.from(new Map(all.map((item) => [item.id, item])).values()));
		}).catch(() => void 0);
		fetch(appUrl("/api/competitor-cases?limit=100&offset=0")).then((response) => response.ok ? response.json() : Promise.reject(/* @__PURE__ */ new Error("竞对案例库暂不可用"))).then((payload) => {
			if (active && payload.scripts) {
				setCompetitorItems(payload.scripts);
				setCompetitorHasMore(!!payload.hasMore);
			}
		}).catch(() => void 0);
		fetch(appUrl("/api/stats")).then((response) => response.ok ? response.json() : Promise.reject()).then((payload) => active && setStats(payload)).catch(() => void 0);
		return () => {
			active = false;
		};
	}, []);
	(0, import_react.useEffect)(() => {
		const refresh = () => fetch(appUrl("/api/stats")).then((response) => response.ok ? response.json() : Promise.reject()).then((payload) => setStats(payload)).catch(() => void 0);
		refresh();
		const timer = window.setInterval(refresh, 15e3);
		return () => window.clearInterval(timer);
	}, [
		caseItems.length,
		competitorItems.length,
		reviewDrafts.length
	]);
	const showToast = (title, detail) => {
		setToast({
			title,
			detail
		});
		window.setTimeout(() => setToast(null), 3200);
	};
	const visibleCases = (0, import_react.useMemo)(() => {
		return caseItems.filter((item) => {
			const matchesSearch = `${item.title}${item.copy}${item.product}${item.scriptType}`.toLowerCase().includes(search.toLowerCase());
			const matchesFilter = caseFilter === "全部" || item.product === caseFilter;
			const matchesType = scriptTypeFilter === "全部脚本" || item.scriptType === scriptTypeFilter;
			return matchesSearch && matchesFilter && matchesType;
		});
	}, [
		caseItems,
		search,
		caseFilter,
		scriptTypeFilter
	]);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "app-shell",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("aside", {
				className: "command-sidebar",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
						className: "brand",
						onClick: () => setView("overview"),
						"aria-label": "回到创意工作台",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "brand-mark",
							children: "IO"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "IDEA OS" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "CREATIVE COMMAND" })] })]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "workspace-identity",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "workspace-kicker",
								children: "WORKSPACE / 01"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "创意智能中枢" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "IDEA OPERATING SYSTEM" })
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "nav-label",
						children: "工作空间"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("nav", {
						className: "main-nav",
						"aria-label": "主要导航",
						children: navItems.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
							className: view === item.id ? "active" : "",
							onClick: () => setView(item.id),
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
									className: "nav-index",
									children: ["0", navItems.findIndex((nav) => nav.id === item.id) + 1]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(AppIcon, { children: item.icon }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: item.label }),
								item.badge && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("em", { children: item.badge }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", {
									className: "nav-arrow",
									children: "↗"
								})
							]
						}, item.id))
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "sidebar-bottom",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "learning-card",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "pulse-dot" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "创意系统运行中" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "数据与模型已同步" })] })]
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
							className: "profile",
							"aria-label": "当前登录员工",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "avatar",
									children: workbench?.user.name.slice(0, 1) || "创"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: workbench?.user.name || "正在读取身份" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("small", { children: [workbench?.user.employeeNo || "OA IDENTITY", workbench?.user.jobTitle ? ` · ${workbench.user.jobTitle}` : ""] })] }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "•••" })
							]
						})]
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "workspace-frame",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
					className: "command-topbar",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
							className: "mobile-brand",
							onClick: () => setView("overview"),
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "brand-mark",
								children: "IO"
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "IDEA OS" })]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
							className: "global-search",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "⌕" }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
									value: search,
									onChange: (e) => setSearch(e.target.value),
									placeholder: "搜索案例、脚本或素材 ID"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("kbd", { children: "⌘ K" })
							]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "command-actions",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
									className: "system-status",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", {}), " SYSTEM ONLINE"]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
									className: "command-date",
									children: [new Intl.DateTimeFormat("zh-CN", {
										year: "numeric",
										month: "2-digit",
										day: "2-digit"
									}).format(/* @__PURE__ */ new Date()), " / CST"]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
									className: "utility-btn",
									"aria-label": "消息通知",
									children: "●"
								})
							]
						})
					]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("main", {
					className: "workspace",
					children: [
						view === "overview" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Overview, {
							stats,
							workbench,
							onCreate: () => setView("daily"),
							onNavigate: setView
						}),
						view === "daily" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(DailyScriptsView, {
							users: workbench?.users ?? [],
							currentUser: workbench?.user ?? null,
							onSubmitted: (draft) => {
								setReviewDrafts((current) => [draft, ...current.filter((item) => item.id !== draft.id)]);
								setView("review");
								showToast("脚本已提交", `${draft.title} 已推送给 ${draft.teamLeadReviewerName}`);
							}
						}),
						view === "cases" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CasesView, {
							items: visibleCases,
							allItems: caseItems,
							currentUser: workbench?.user ?? null,
							loading: casesLoading,
							loadError: casesError,
							filter: caseFilter,
							setFilter: setCaseFilter,
							scriptTypeFilter,
							setScriptTypeFilter,
							onImported: (item) => {
								setCaseItems((current) => [item, ...current]);
								showToast("素材已入库", "已按脚本类型、单品和文案归档");
							},
							onChanged: (item) => setCaseItems((current) => current.map((entry) => entry.id === item.id ? item : entry)),
							onDeleted: (id) => setCaseItems((current) => current.filter((entry) => entry.id !== id))
						}),
						view === "competitors" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CompetitorCasesView, {
							items: competitorItems,
							hasMore: competitorHasMore,
							onLoadMore: (items, hasMore) => {
								setCompetitorItems((current) => [...current, ...items.filter((item) => !current.some((existing) => existing.id === item.id))]);
								setCompetitorHasMore(hasMore);
							},
							onImported: (items) => {
								setCompetitorItems((current) => [...items, ...current]);
								showToast("竞对脚本已入库", `本次成功存入 ${items.length} 条脚本`);
							}
						}),
						view === "scripts" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ScriptsView, {
							cases: caseItems,
							users: workbench?.users ?? [],
							currentUser: workbench?.user ?? null,
							onSubmitted: (draft) => {
								setReviewDrafts((current) => [draft, ...current.filter((item) => item.id !== draft.id)]);
								setView("review");
								showToast("已提交组长审核", `${draft.title} 已推送给 ${draft.teamLeadReviewerName}`);
							},
							showToast
						}),
						view === "review" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ReviewView, {
							items: reviewDrafts,
							currentUser: workbench?.user ?? null,
							onUpdate: (draft) => setReviewDrafts((current) => current.map((item) => item.id === draft.id ? draft : item)),
							onDeleted: (id) => setReviewDrafts((current) => current.filter((item) => item.id !== id)),
							onApproved: (draft, caseItem) => {
								setReviewDrafts((current) => current.map((item) => item.id === draft.id ? draft : item));
								setCaseItems((current) => current.some((item) => item.id === caseItem.id) ? current : [caseItem, ...current]);
								showToast("主管终审通过", `${caseItem.title} 已保存到品牌案例库`);
							},
							showToast
						}),
						view === "collaborations" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CollaborationsView, {})
					]
				})]
			}),
			toast && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "toast",
				role: "status",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "✓" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: toast.title }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: toast.detail })] })]
			})
		]
	});
}
function PageHeading({ eyebrow, title, copy, action }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "page-heading",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "eyebrow",
				children: eyebrow
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", { children: title }),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: copy })
		] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "heading-action",
			children: [action, /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
				className: "heading-index",
				children: "IDEA / OS — 2026"
			})]
		})]
	});
}
function Overview({ stats, workbench, onCreate, onNavigate }) {
	const greeting = caringGreeting(workbench?.user.name || "你好");
	const totalAssets = stats.cases + stats.competitors;
	const metrics = [
		{
			label: "品牌案例",
			value: String(stats.cases),
			delta: String(stats.videos),
			note: "关联视频",
			icon: "▦",
			tone: "mint"
		},
		{
			label: "竞对案例",
			value: String(stats.competitors),
			delta: String(stats.pendingReview),
			note: "待审核脚本",
			icon: "◫",
			tone: "violet"
		},
		{
			label: "审核通过",
			value: String(stats.approved),
			delta: String(stats.collaborations),
			note: "达人合作",
			icon: "✓",
			tone: "amber"
		},
		{
			label: "平台总资产",
			value: String(stats.cases + stats.competitors),
			delta: "实时",
			note: "数据库统计",
			icon: "⌁",
			tone: "blue"
		}
	];
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "page overview-page",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(PageHeading, {
				eyebrow: "CREATIVE COMMAND CENTER",
				title: "创意总览",
				copy: "把今天要做的事、正在推进的创意和团队沉淀，都放在触手可及的位置。",
				action: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
					className: "primary-btn",
					onClick: onCreate,
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "＋" }), " 提交日常脚本"]
				})
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "personal-workbench",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "workbench-lead",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "eyebrow",
								children: "MY WORKBENCH"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: workbench?.user.name ? greeting.title : "正在为你准备工作台" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: workbench?.user.name ? greeting.note : "登录后，你的任务与审核进度会在这里自动出现。" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("small", { children: [workbench?.user.department || "创意团队", workbench?.user.jobTitle ? ` · ${workbench.user.jobTitle}` : ""] })
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
						onClick: () => onNavigate("review"),
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "分配给我" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: workbench?.counts.assigned ?? 0 }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "进入审核 →" })
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
						onClick: () => onNavigate("review"),
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "退回待修改" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: workbench?.counts.returned ?? 0 }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "继续改稿 →" })
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
						onClick: () => onNavigate("review"),
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "我提交的" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: workbench?.counts.submitted ?? 0 }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "查看进度 →" })
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
						onClick: () => onNavigate("review"),
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "临期任务" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: workbench?.counts.dueSoon ?? 0 }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "优先处理 →" })
						]
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "ai-briefing",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "hero-number",
						children: "01"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
						className: "hero-status",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", {}), " LIVE CREATIVE SIGNAL"]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "briefing-copy",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Tag, {
								tone: "glow",
								children: "LIVE DATA BRIEF"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h2", { children: [
								"平台已沉淀",
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("br", {}),
								totalAssets,
								" 条脚本资产。"
							] }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { children: [
								"当前品牌案例 ",
								stats.cases,
								" 条、竞对案例 ",
								stats.competitors,
								" 条，关联视频 ",
								stats.videos,
								" 个；另有 ",
								stats.pendingReview,
								" 条脚本等待审核。所有数字均直接来自平台数据库。"
							] }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "briefing-actions",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
									onClick: () => onNavigate("review"),
									children: ["处理待审核脚本 ", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "↗" })]
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
									className: "ghost-light",
									onClick: () => onNavigate("scripts"),
									children: "创建新脚本"
								})]
							})
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "signal-orbit",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "orbit-index",
								children: "01 / DATABASE"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "signal-rings",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", {}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", {}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", {}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", {})
								]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "signal-core",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: stats.pendingReview }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "待审核" })]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
								className: "signal-note note-a",
								children: ["品牌案例 ", stats.cases]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
								className: "signal-note note-b",
								children: ["竞对案例 ", stats.competitors]
							})
						]
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("section", {
				className: "metric-grid",
				children: metrics.map((metric) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
					className: "metric-card",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: `metric-icon ${metric.tone}`,
						children: metric.icon
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: metric.label }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: metric.value }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: metric.delta }),
							" ",
							metric.note
						] })
					] })]
				}, metric.label))
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "overview-grid",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
						className: "panel workflow-panel",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "panel-head",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "eyebrow",
								children: "CREATIVE LOOP"
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "今日创意闭环" })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								onClick: () => onNavigate("review"),
								children: "查看任务 →"
							})]
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "pipeline",
							children: [
								{
									n: "01",
									t: "品牌案例",
									v: stats.cases,
									s: "已入库"
								},
								{
									n: "02",
									t: "关联视频",
									v: stats.videos,
									s: "已存储"
								},
								{
									n: "03",
									t: "人工审核",
									v: stats.pendingReview,
									s: "待处理"
								},
								{
									n: "04",
									t: "竞对案例",
									v: stats.competitors,
									s: "已沉淀"
								},
								{
									n: "05",
									t: "达人合作",
									v: stats.collaborations,
									s: "进行中"
								}
							].map((step, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "pipeline-step",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: step.n }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
										className: `pipeline-node ${step.v > 0 ? "done" : ""}`,
										children: step.v > 0 ? "✓" : "⌁"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: step.t }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { children: [
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: step.v }),
										" ",
										step.s
									] })
								]
							}, step.t))
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
						className: "panel alert-panel",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "panel-head",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "eyebrow",
									children: "LIVE STATUS"
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "当前工作状态" })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Tag, {
									tone: stats.pendingReview ? "warning" : "success",
									children: [stats.pendingReview, " 项待审"]
								})]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
								className: "attention-item",
								onClick: () => onNavigate("review"),
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
										className: "attention-icon risk",
										children: "!"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("strong", { children: [stats.pendingReview, " 条脚本等待审核"] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "审核通过后自动进入品牌案例库" })] }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "→" })
								]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
								className: "attention-item",
								onClick: () => onNavigate("collaborations"),
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
										className: "attention-icon down",
										children: "◎"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("strong", { children: [stats.collaborations, " 项达人合作任务"] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "在合作进度板中查看与推进" })] }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "→" })
								]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
								className: "attention-item",
								onClick: () => onNavigate("cases"),
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
										className: "attention-icon data",
										children: "＋"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("strong", { children: [stats.videos, " 个关联视频"] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "已与品牌案例建立关联" })] }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "→" })
								]
							})
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
						className: "panel performance-panel",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "panel-head",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "eyebrow",
								children: "ASSET COMPOSITION"
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "平台资产构成" })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								onClick: () => onNavigate("cases"),
								children: "查看案例 →"
							})]
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "top-creative",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
									className: "creative-rank",
									children: String(totalAssets).padStart(2, "0")
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
									className: "creative-thumb amber",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "实时数据" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "资产总览" })]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
									className: "creative-info",
									children: [
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Tag, {
											tone: "success",
											children: "数据库同步"
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h4", { children: [totalAssets, " 条可检索脚本"] }),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "品牌案例与竞对案例统一纳入创作参考体系" })
									]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
									className: "creative-stats",
									children: [
										/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "品牌" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: stats.cases })] }),
										/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "竞对" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: stats.competitors })] }),
										/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "视频" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: stats.videos })] })
									]
								})
							]
						})]
					})
				]
			})
		]
	});
}
function recognizeMaterial(raw) {
	const typeRules = [
		["自产脚本", /自产|自制|团队创作/i],
		["明星脚本", /明星|艺人|代言/i],
		["付费KOC脚本", /付费|投流|达人合作|商单/i],
		["唠嗑KOC脚本", /唠嗑|聊天|姐妹们|家人们|碎碎念/i],
		["剧情脚本", /剧情|场景|对白|转场|人物/i],
		["混剪脚本", /混剪|素材拼接|快剪|蒙太奇/i],
		["AI脚本", /\bAI\b|人工智能|数字人|对口型/i]
	];
	const productRules = [
		["水油/蛋白喷雾", /水油|蛋白喷雾|喷雾/i],
		["水润面膜", /水润面膜|补水面膜|保湿面膜/i],
		["眼膜", /眼膜|眼周|黑眼圈|眼袋/i],
		["美白针", /美白针|焕白|提亮/i],
		["黄金面膜", /黄金面膜|黄金膜/i],
		["微针面膜", /微针面膜|微针/i],
		["燕窝面膜", /燕窝面膜|燕窝/i],
		["次抛精华", /次抛|安瓶/i]
	];
	const matchedType = typeRules.find(([, pattern]) => pattern.test(raw));
	const matchedProduct = productRules.find(([, pattern]) => pattern.test(raw));
	const urls = [...raw.match(/https?:\/\/[^\s，。]+/gi) ?? []];
	const markedCopy = raw.match(/(?:脚本文案|文案)\s*[:：]\s*([\s\S]+)/i)?.[1];
	const authorName = raw.match(/(?:作者|达人名|达人)\s*[:：]\s*([^\n]+)/i)?.[1]?.trim() || "待确认";
	const authorType = /达人名|达人\s*[:：]|KOC/i.test(raw) ? "外部达人" : "内部同事";
	const fallbackCopy = raw.split(/\n+/).filter((line) => !/^\s*(?:标题|脚本名称|脚本类型|类型|单品|产品|作者|达人名|达人|视频|链接)\s*[:：]/.test(line) && !/^\s*https?:\/\//i.test(line)).join("\n").trim();
	const copy = (markedCopy ?? fallbackCopy).replace(/https?:\/\/[^\s，。]+/gi, "").trim();
	return {
		scriptType: matchedType?.[0] ?? "AI脚本",
		product: matchedProduct?.[0] ?? "水润面膜",
		copy,
		authorType,
		authorName,
		videoUrls: urls,
		confidence: Math.min(96, 64 + (matchedType ? 14 : 0) + (matchedProduct ? 14 : 0) + (copy.length > 30 ? 4 : 0))
	};
}
async function extractDocument(file) {
	if (/\.(txt|md)$/i.test(file.name) || file.type.startsWith("text/")) return file.text();
	if (!/\.docx$/i.test(file.name)) throw new Error(`${file.name} 暂不支持，请上传 DOCX、TXT 或 MD`);
	const xml = unzipSync(new Uint8Array(await file.arrayBuffer()))["word/document.xml"];
	if (!xml) throw new Error(`${file.name} 不是有效的 DOCX 文档`);
	const doc = new DOMParser().parseFromString(new TextDecoder().decode(xml), "application/xml");
	return Array.from(doc.getElementsByTagName("w:p")).map((paragraph) => paragraph.textContent?.trim()).filter(Boolean).join("\n");
}
function CasesView({ items, allItems, currentUser, loading, loadError, filter, setFilter, scriptTypeFilter, setScriptTypeFilter, onImported, onChanged, onDeleted }) {
	const [importOpen, setImportOpen] = (0, import_react.useState)(false);
	const [rawText, setRawText] = (0, import_react.useState)("");
	const [step, setStep] = (0, import_react.useState)("input");
	const [recognitions, setRecognitions] = (0, import_react.useState)([]);
	const [selectedCase, setSelectedCase] = (0, import_react.useState)(null);
	const [saving, setSaving] = (0, import_react.useState)(false);
	const [error, setError] = (0, import_react.useState)("");
	const closeImport = () => {
		setImportOpen(false);
		setStep("input");
		setRawText("");
		setRecognitions([]);
		setError("");
	};
	const analyze = () => {
		if (rawText.trim().length < 8) {
			setError("请至少输入 8 个字的素材内容");
			return;
		}
		setRecognitions(rawText.split(/\n\s*(?:-{3,}|={3,})\s*\n/g).filter((block) => block.trim().length >= 8).slice(0, 100).map(recognizeMaterial));
		setError("");
		setStep("confirm");
	};
	const save = async () => {
		if (!recognitions.length || recognitions.some((item) => item.copy.trim().length < 8)) {
			setError("请确认每条素材都有完整脚本文案");
			return;
		}
		setSaving(true);
		setError("");
		try {
			for (const recognition of recognitions) {
				const response = await fetch(appUrl("/api/cases"), {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(recognition)
				});
				const payload = await response.json();
				if (!response.ok || !payload.case) throw new Error(payload.error || "导入失败");
				onImported(payload.case);
			}
			closeImport();
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "导入失败，请稍后重试");
		} finally {
			setSaving(false);
		}
	};
	const visibleTypes = SCRIPT_TYPES.filter((type) => scriptTypeFilter === "全部脚本" || type === scriptTypeFilter);
	const importDocuments = async (files) => {
		if (!files?.length) return;
		setError("");
		try {
			setRawText((await Promise.all(Array.from(files).map(async (file) => `标题：${file.name.replace(/\.[^.]+$/, "")}\n${await extractDocument(file)}`))).join("\n---\n"));
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : "文档读取失败");
		}
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "page case-page",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(PageHeading, {
				eyebrow: "SCRIPT-FIRST LIBRARY",
				title: "品牌案例库",
				copy: "按脚本类型、单品和文案组织案例；每条文案可编辑，并关联视频文件或链接。",
				action: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					className: "primary-btn",
					onClick: () => setImportOpen(true),
					children: "＋ 批量导入素材"
				})
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "case-toolbar",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "toolbar-label",
						children: "脚本类型"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "segmented product-segments",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							className: scriptTypeFilter === "全部脚本" ? "active" : "",
							onClick: () => setScriptTypeFilter("全部脚本"),
							children: "全部"
						}), SCRIPT_TYPES.map((value) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							className: scriptTypeFilter === value ? "active" : "",
							onClick: () => setScriptTypeFilter(value),
							children: value
						}, value))]
					})] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "toolbar-label",
						children: "单品"
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "segmented product-segments",
						children: ["全部", ...PRODUCTS].map((value) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							className: filter === value ? "active" : "",
							onClick: () => setFilter(value),
							children: value
						}, value))
					})] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
						className: "case-total",
						children: [
							"显示 ",
							items.length,
							" / ",
							allItems.length,
							" 条"
						]
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "case-library-layout",
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
					className: "case-library-main",
					children: [
						visibleTypes.map((type) => {
							const typeItems = items.filter((item) => item.scriptType === type);
							if (!typeItems.length) return null;
							return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "script-type-group",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
									className: "type-group-head",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
										className: "type-index",
										children: String(SCRIPT_TYPES.indexOf(type) + 1).padStart(2, "0")
									}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: type })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [typeItems.length, " 条文案"] })]
								}), PRODUCTS.map((product) => {
									const productItems = typeItems.filter((item) => item.product === product);
									if (!productItems.length) return null;
									return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
										className: "product-group",
										children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
											className: "product-group-head",
											children: [
												/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "product-dot" }),
												/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: product }),
												/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("small", { children: [productItems.length, " 条"] })
											]
										}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
											className: "copy-list",
											children: productItems.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
												className: "copy-card",
												children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
													className: "copy-card-main",
													children: [
														/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
															className: "copy-meta",
															children: [
																/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: item.id }),
																/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Tag, { children: item.source }),
																/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Tag, {
																	tone: item.status === "新跑出" || item.status === "高ROI" ? "success" : item.status === "待验证" ? "warning" : "neutral",
																	children: item.status
																})
															]
														}),
														/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: item.title }),
														/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
															className: "case-attribution",
															children: [item.talentName && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: ["达人 ", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: item.talentName })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: ["作者 ", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: item.authorName || "待补充" })] })]
														}),
														/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
															className: "copy-preview",
															children: [item.copy.slice(0, 180), item.copy.length > 180 ? "…" : ""]
														}),
														/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
															className: "case-edit-btn",
															onClick: () => setSelectedCase(item),
															children: "查看全文 / 编辑 →"
														})
													]
												}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
													className: "copy-videos",
													children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
														className: "video-section-head",
														children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "关联视频" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: item.videos.length })]
													}), item.videos.length ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
														className: "video-strip",
														children: item.videos.map((video) => video.url ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("a", {
															href: video.url,
															target: "_blank",
															rel: "noreferrer",
															className: `script-video ${video.coverTone}`,
															children: [
																/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
																	className: "video-play",
																	children: "▶"
																}),
																/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: video.title }),
																/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: video.duration })
															]
														}, video.id) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
															className: `script-video ${video.coverTone}`,
															children: [
																/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
																	className: "video-play",
																	children: "▶"
																}),
																/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: video.title }),
																/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: video.duration })
															]
														}, video.id))
													}) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
														className: "no-video",
														children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "＋" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "尚无关联视频" })]
													})]
												})]
											}, item.id))
										})]
									}, product);
								})]
							}, type);
						}),
						loading && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "empty-state",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "正在读取品牌案例" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "案例较多，请稍候片刻。" })]
						}),
						!loading && loadError && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "empty-state",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "案例加载失败" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: loadError })]
						}),
						!loading && !loadError && items.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "empty-state",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "没有匹配的文案" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "换一个关键词，或清除脚本类型与单品筛选。" })]
						})
					]
				})
			}),
			importOpen && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "modal-backdrop",
				role: "presentation",
				onMouseDown: (event) => {
					if (event.target === event.currentTarget) closeImport();
				},
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
					className: "import-modal",
					role: "dialog",
					"aria-modal": "true",
					"aria-labelledby": "import-title",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "import-modal-head",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "eyebrow",
								children: "SMART IMPORT"
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
								id: "import-title",
								children: "导入素材"
							})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								onClick: closeImport,
								"aria-label": "关闭",
								children: "×"
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "import-steps",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
									className: step === "input" ? "active" : "done",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "1" }), "上传或粘贴"]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", {}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
									className: step === "confirm" ? "active" : "",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "2" }), "逐条确认"]
								})
							]
						}),
						step === "input" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "import-body",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
									className: "document-drop",
									children: [
										"批量导入文档",
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
											type: "file",
											multiple: true,
											accept: ".docx,.txt,.md,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document",
											onChange: (event) => importDocuments(event.target.files)
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "选择 DOCX / TXT / MD 文档" }),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "可多选，每份文档自动作为一条素材识别" })
									]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: ["或粘贴素材文字", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", {
									value: rawText,
									onChange: (event) => setRawText(event.target.value),
									placeholder: "多条素材请使用 --- 分隔\n作者：达人名或同事名\n脚本类型：剧情脚本\n单品：眼膜\n文案：凌晨一点，她刚结束今天第三场会议……"
								})] }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
									className: "recognize-hint",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "✦" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "系统会自动识别" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "作者、脚本类型、单品、脚本文案和视频链接；识别后逐条确认" })] })]
								}),
								error && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
									className: "form-error",
									children: error
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
									className: "modal-actions",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
										className: "secondary-btn",
										onClick: closeImport,
										children: "取消"
									}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
										className: "primary-btn",
										onClick: analyze,
										children: "识别全部素材 →"
									})]
								})
							]
						}) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "import-body confirm-body",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
									className: "recognition-score",
									children: [
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "✦" }),
										/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("strong", { children: [
											"识别到 ",
											recognitions.length,
											" 条素材"
										] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "请逐条检查作者、分类与文案" })] }),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Tag, {
											tone: "success",
											children: "待确认"
										})
									]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
									className: "recognized-competitor-list",
									children: recognitions.map((recognition, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", { children: [
										/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
											className: "recognized-item-head",
											children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("strong", { children: ["素材 ", String(index + 1).padStart(2, "0")] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
												onClick: () => setRecognitions((current) => current.filter((_, i) => i !== index)),
												children: "移除"
											})]
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
											className: "confirm-grid",
											children: [
												/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: ["脚本类型", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("select", {
													value: recognition.scriptType,
													onChange: (event) => setRecognitions((current) => current.map((item, i) => i === index ? {
														...item,
														scriptType: event.target.value
													} : item)),
													children: SCRIPT_TYPES.map((type) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: type }, type))
												})] }),
												/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: ["单品", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("select", {
													value: recognition.product,
													onChange: (event) => setRecognitions((current) => current.map((item, i) => i === index ? {
														...item,
														product: event.target.value
													} : item)),
													children: PRODUCTS.map((product) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: product }, product))
												})] }),
												/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: ["作者类型", /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", {
													value: recognition.authorType,
													onChange: (event) => setRecognitions((current) => current.map((item, i) => i === index ? {
														...item,
														authorType: event.target.value
													} : item)),
													children: [
														/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: "内部同事" }),
														/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: "外部达人" }),
														/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: "品牌历史素材" })
													]
												})] }),
												/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: ["作者 / 达人名", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
													value: recognition.authorName,
													onChange: (event) => setRecognitions((current) => current.map((item, i) => i === index ? {
														...item,
														authorName: event.target.value
													} : item))
												})] })
											]
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: ["脚本文案", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", {
											value: recognition.copy,
											onChange: (event) => setRecognitions((current) => current.map((item, i) => i === index ? {
												...item,
												copy: event.target.value
											} : item))
										})] }),
										/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: ["视频链接", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", {
											className: "video-links-input",
											value: recognition.videoUrls.join("\n"),
											onChange: (event) => setRecognitions((current) => current.map((item, i) => i === index ? {
												...item,
												videoUrls: event.target.value.split(/\n+/).map((v) => v.trim()).filter(Boolean)
											} : item))
										})] })
									] }, index))
								}),
								error && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
									className: "form-error",
									children: error
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
									className: "modal-actions",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
										className: "secondary-btn",
										onClick: () => {
											setStep("input");
											setError("");
										},
										children: "← 返回修改"
									}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
										className: "primary-btn",
										disabled: saving || !recognitions.length,
										onClick: save,
										children: saving ? "正在批量入库…" : `确认并存入 ${recognitions.length} 条`
									})]
								})
							]
						})
					]
				})
			}),
			selectedCase && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(CaseDetailModal, {
				item: selectedCase,
				currentUser,
				onClose: () => setSelectedCase(null),
				onChanged: (item) => {
					onChanged(item);
					setSelectedCase(item);
				},
				onDeleted: (id) => {
					onDeleted(id);
					setSelectedCase(null);
				}
			})
		]
	});
}
function CaseDetailModal({ item, currentUser, onClose, onChanged, onDeleted }) {
	const [draft, setDraft] = (0, import_react.useState)(item);
	const [videoUrls, setVideoUrls] = (0, import_react.useState)("");
	const [busy, setBusy] = (0, import_react.useState)("");
	const [error, setError] = (0, import_react.useState)("");
	const canDelete = !!currentUser && (currentUser.role === "admin" || [item.uploaderId, item.authorUserId].includes(currentUser.id));
	const save = async () => {
		setBusy("save");
		setError("");
		try {
			const response = await fetch(appUrl("/api/cases"), {
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					...draft,
					videoUrls: videoUrls.split(/\n+/).map((v) => v.trim()).filter(Boolean)
				})
			});
			const payload = await response.json();
			if (!response.ok || !payload.case) throw new Error(payload.error || "保存失败");
			setDraft(payload.case);
			setVideoUrls("");
			onChanged(payload.case);
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : "保存失败");
		} finally {
			setBusy("");
		}
	};
	const upload = async (file) => {
		if (!file) return;
		setBusy("upload");
		setError("");
		try {
			const form = new FormData();
			form.append("file", file);
			form.append("scriptId", draft.id);
			const response = await fetch(appUrl("/api/media-upload"), {
				method: "POST",
				body: form
			});
			const payload = await response.json();
			if (!response.ok || !payload.video) throw new Error(payload.error || "上传失败");
			const changed = {
				...draft,
				videos: [...draft.videos, payload.video]
			};
			setDraft(changed);
			onChanged(changed);
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : "上传失败");
		} finally {
			setBusy("");
		}
	};
	const remove = async () => {
		if (!window.confirm(`确定删除“${draft.title}”吗？此操作无法撤销。`)) return;
		setBusy("delete");
		if ((await fetch(appUrl(`/api/cases?id=${encodeURIComponent(draft.id)}`), { method: "DELETE" })).ok) onDeleted(draft.id);
		else setError("删除失败，请稍后重试");
		setBusy("");
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "modal-backdrop",
		onMouseDown: (event) => {
			if (event.target === event.currentTarget) onClose();
		},
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
			className: "import-modal case-detail-modal",
			role: "dialog",
			"aria-modal": "true",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "import-modal-head",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: "eyebrow",
					children: "CASE DETAIL"
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "查看与编辑案例" })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					onClick: onClose,
					children: "×"
				})]
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "import-body",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "confirm-grid",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: ["脚本类型", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("select", {
								value: draft.scriptType,
								onChange: (e) => setDraft({
									...draft,
									scriptType: e.target.value
								}),
								children: SCRIPT_TYPES.map((type) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: type }, type))
							})] }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: ["单品", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("select", {
								value: draft.product,
								onChange: (e) => setDraft({
									...draft,
									product: e.target.value
								}),
								children: PRODUCTS.map((product) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: product }, product))
							})] }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: ["作者类型", /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", {
								value: draft.authorType || "历史素材",
								onChange: (e) => setDraft({
									...draft,
									authorType: e.target.value
								}),
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: "内部同事" }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: "外部达人" }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: "历史素材" })
								]
							})] }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: ["作者 / 达人名", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
								value: draft.authorName || "",
								onChange: (e) => setDraft({
									...draft,
									authorName: e.target.value
								})
							})] })
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "case-owner-line",
						children: [draft.talentName && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: ["合作达人：", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: draft.talentName })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: ["终审人：", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: draft.finalReviewerName || "—" })] })]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: ["标题", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
						value: draft.title,
						onChange: (e) => setDraft({
							...draft,
							title: e.target.value
						})
					})] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: ["脚本文案", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", {
						value: draft.copy,
						onChange: (e) => setDraft({
							...draft,
							copy: e.target.value
						})
					})] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: ["新增视频链接", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", {
						value: videoUrls,
						onChange: (e) => setVideoUrls(e.target.value),
						placeholder: "每行一个视频链接"
					})] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
						className: "document-drop",
						children: [
							"上传关联视频",
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
								type: "file",
								accept: "video/mp4,video/quicktime,.mp4,.mov",
								onChange: (e) => upload(e.target.files?.[0])
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: busy === "upload" ? "正在上传…" : "选择 MP4 / MOV 文件" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "单个视频不超过 200MB" })
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "case-detail-videos",
						children: draft.videos.map((video) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("a", {
							href: video.url.startsWith("/api/") ? appUrl(video.url) : video.url,
							target: "_blank",
							rel: "noreferrer",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "▶" }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: video.title }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: video.duration })
							]
						}, video.id))
					}),
					error && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "form-error",
						children: error
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "modal-actions split-actions",
						children: [
							canDelete && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								className: "danger-btn",
								disabled: !!busy,
								onClick: remove,
								children: "删除案例"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", {
								className: "secondary-btn export-link",
								href: appUrl(`/api/cases/${draft.id}/export`),
								children: "导出 Word"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								className: "secondary-btn",
								onClick: onClose,
								children: "关闭"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								className: "primary-btn",
								disabled: !!busy,
								onClick: save,
								children: busy === "save" ? "正在保存…" : "保存修改"
							})
						]
					})
				]
			})]
		})
	});
}
function recognizeCompetitorBatch(raw) {
	const normalized = raw.replace(/\r/g, "").trim();
	const explicitBlocks = normalized.split(/\n\s*(?:-{3,}|={3,})\s*\n/g);
	return (explicitBlocks.length > 1 ? explicitBlocks : normalized.split(/\n\s*\n(?=\s*(?:脚本\s*\d+|第[一二三四五六七八九十百]+条|标题|品牌|产品|单品)\s*[:：]?)/g)).map((block, index) => {
		const title = block.match(/(?:标题|脚本名称)\s*[:：]\s*(.+)/)?.[1]?.trim();
		const explicitBrand = block.match(/品牌\s*[:：]\s*(.+)/)?.[1]?.trim();
		const explicitType = block.match(/(?:素材类型|脚本类型|类型)\s*[:：]\s*(.+)/)?.[1]?.trim();
		const cleanCopy = (block.match(/(?:脚本文案|文案|正文)\s*[:：]\s*([\s\S]+)/)?.[1]?.trim() ?? block).replace(/^\s*(?:脚本\s*\d+|第[一二三四五六七八九十百]+条)\s*[:：]?\s*/i, "").split("\n").filter((line) => !/^\s*(?:标题|脚本名称|品牌|素材类型|脚本类型|类型|产品|单品)\s*[:：]/.test(line)).join("\n").trim();
		const inferredTitle = cleanCopy.split(/[。！？\n]/).find((line) => line.trim())?.trim().slice(0, 28);
		return {
			title: title || inferredTitle || `竞对脚本 ${index + 1}`,
			brand: COMPETITOR_BRANDS.find((brand) => explicitBrand?.includes(brand) || block.includes(brand)) || COMPETITOR_BRANDS[0],
			scriptType: SCRIPT_TYPES.find((type) => explicitType?.includes(type) || block.includes(type)) || "自产脚本",
			copy: cleanCopy
		};
	}).filter((item) => item.copy.length >= 8).slice(0, 100);
}
function CompetitorCasesView({ items, hasMore, onLoadMore, onImported }) {
	const [query, setQuery] = (0, import_react.useState)("");
	const [brandFilter, setBrandFilter] = (0, import_react.useState)("全部品牌");
	const [typeFilter, setTypeFilter] = (0, import_react.useState)("全部类型");
	const [importOpen, setImportOpen] = (0, import_react.useState)(false);
	const [rawText, setRawText] = (0, import_react.useState)("");
	const [step, setStep] = (0, import_react.useState)("input");
	const [recognized, setRecognized] = (0, import_react.useState)([]);
	const [saving, setSaving] = (0, import_react.useState)(false);
	const [loadingMore, setLoadingMore] = (0, import_react.useState)(false);
	const [error, setError] = (0, import_react.useState)("");
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
		if (!result.length) {
			setError("未识别到完整脚本，请检查内容或使用 --- 分隔多条脚本");
			return;
		}
		setRecognized(result);
		setStep("confirm");
		setError("");
	};
	const updateItem = (index, patch) => {
		setRecognized((current) => current.map((item, itemIndex) => itemIndex === index ? {
			...item,
			...patch
		} : item));
	};
	const removeItem = (index) => setRecognized((current) => current.filter((_, itemIndex) => itemIndex !== index));
	const save = async () => {
		if (!recognized.length || recognized.some((item) => item.copy.trim().length < 8)) {
			setError("请确认每条脚本都包含完整文案");
			return;
		}
		setSaving(true);
		setError("");
		try {
			const response = await fetch(appUrl("/api/competitor-cases"), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ items: recognized })
			});
			const payload = await response.json();
			if (!response.ok || !payload.scripts) throw new Error(payload.error || "批量导入失败");
			onImported(payload.scripts);
			closeImport();
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "批量导入失败，请稍后重试");
		} finally {
			setSaving(false);
		}
	};
	const loadMore = async () => {
		setLoadingMore(true);
		setError("");
		try {
			const response = await fetch(appUrl(`/api/competitor-cases?limit=100&offset=${items.length}`));
			const payload = await response.json();
			if (!response.ok || !payload.scripts) throw new Error(payload.error || "加载失败");
			onLoadMore(payload.scripts, !!payload.hasMore);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "加载失败，请稍后重试");
		} finally {
			setLoadingMore(false);
		}
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "page competitor-page",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(PageHeading, {
				eyebrow: "COMPETITOR SCRIPT ARCHIVE",
				title: "竞对案例库",
				copy: "按品牌与素材类型沉淀竞对脚本，支持批量识别、逐条确认和持久化入库。",
				action: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					className: "primary-btn",
					onClick: () => setImportOpen(true),
					children: "＋ 批量导入竞对脚本"
				})
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "competitor-toolbar",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "⌕" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
					value: query,
					onChange: (event) => setQuery(event.target.value),
					placeholder: "搜索标题、品牌、素材类型或脚本文案"
				})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
					"共 ",
					visibleItems.length,
					" 条竞对脚本"
				] })]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "competitor-filters",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "品牌" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", {
					value: brandFilter,
					onChange: (e) => setBrandFilter(e.target.value),
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: "全部品牌" }), COMPETITOR_BRANDS.map((brand) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: brand }, brand))]
				})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "素材类型" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", {
					value: typeFilter,
					onChange: (e) => setTypeFilter(e.target.value),
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: "全部类型" }), SCRIPT_TYPES.map((type) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: type }, type))]
				})] })]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "competitor-list",
				children: [
					visibleItems.map((item, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
						className: "competitor-card",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
							className: "competitor-index",
							children: String(index + 1).padStart(3, "0")
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "competitor-copy",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
									className: "copy-meta",
									children: [
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: item.id }),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Tag, { children: item.brand }),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Tag, { children: item.scriptType }),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Tag, {
											tone: "warning",
											children: item.source
										})
									]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: item.title }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("summary", { children: item.copy }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: item.copy })] })
							]
						})]
					}, item.id)),
					!visibleItems.length && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "empty-state",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: items.length ? "没有匹配的竞对脚本" : "竞对案例库还是空的" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: items.length ? "换一个关键词继续搜索。" : "点击右上角按钮，可一次粘贴并导入多条竞对脚本。" })]
					}),
					hasMore && !query && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						className: "secondary-btn competitor-load-more",
						disabled: loadingMore,
						onClick: loadMore,
						children: loadingMore ? "正在加载…" : "加载更多竞对脚本"
					})
				]
			}),
			importOpen && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "modal-backdrop",
				role: "presentation",
				onMouseDown: (event) => {
					if (event.target === event.currentTarget) closeImport();
				},
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
					className: "import-modal competitor-import-modal",
					role: "dialog",
					"aria-modal": "true",
					"aria-labelledby": "competitor-import-title",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "import-modal-head",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "eyebrow",
								children: "BATCH RECOGNITION"
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
								id: "competitor-import-title",
								children: "批量导入竞对脚本"
							})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								onClick: closeImport,
								"aria-label": "关闭",
								children: "×"
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "import-steps",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
									className: step === "input" ? "active" : "done",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "1" }), "批量粘贴"]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", {}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
									className: step === "confirm" ? "active" : "",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "2" }), "逐条确认"]
								})
							]
						}),
						step === "input" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "import-body",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: ["竞对脚本文字", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", {
									value: rawText,
									onChange: (event) => setRawText(event.target.value),
									placeholder: "一次粘贴多条脚本，建议使用 --- 分隔，例如：\n标题：通勤补妆实测\n品牌：谷雨\n素材类型：唠嗑KOC脚本\n文案：姐妹们，我最近一直在用……",
									autoFocus: true
								})] }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
									className: "recognize-hint",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "✦" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "自动拆分并识别" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "系统会提取标题、品牌、素材类型和完整文案；单次最多确认 100 条" })] })]
								}),
								error && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
									className: "form-error",
									children: error
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
									className: "modal-actions",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
										className: "secondary-btn",
										onClick: closeImport,
										children: "取消"
									}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
										className: "primary-btn",
										onClick: analyze,
										children: "识别全部脚本 →"
									})]
								})
							]
						}) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "import-body competitor-confirm-body",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
									className: "recognition-score",
									children: [
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "✦" }),
										/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("strong", { children: [
											"识别到 ",
											recognized.length,
											" 条竞对脚本"
										] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "请逐条检查；不需要的条目可以移除" })] }),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Tag, {
											tone: "success",
											children: "待确认"
										})
									]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
									className: "recognized-competitor-list",
									children: recognized.map((item, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", { children: [
										/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
											className: "recognized-item-head",
											children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("strong", { children: ["脚本 ", String(index + 1).padStart(2, "0")] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
												onClick: () => removeItem(index),
												children: "移除"
											})]
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
											className: "confirm-grid",
											children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: ["标题", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
												value: item.title,
												onChange: (event) => updateItem(index, { title: event.target.value })
											})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: ["品牌", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("select", {
												value: item.brand,
												onChange: (event) => updateItem(index, { brand: event.target.value }),
												children: COMPETITOR_BRANDS.map((brand) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: brand }, brand))
											})] })]
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: ["素材类型", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("select", {
											value: item.scriptType,
											onChange: (event) => updateItem(index, { scriptType: event.target.value }),
											children: SCRIPT_TYPES.map((type) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: type }, type))
										})] }),
										/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: ["脚本文案", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", {
											value: item.copy,
											onChange: (event) => updateItem(index, { copy: event.target.value })
										})] })
									] }, `${index}-${item.title}`))
								}),
								error && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
									className: "form-error",
									children: error
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
									className: "modal-actions",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
										className: "secondary-btn",
										onClick: () => {
											setStep("input");
											setError("");
										},
										children: "← 返回原文"
									}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
										className: "primary-btn",
										disabled: saving || !recognized.length,
										onClick: save,
										children: saving ? "正在批量入库…" : `确认并存入 ${recognized.length} 条`
									})]
								})
							]
						})
					]
				})
			})
		]
	});
}
function PersonCombobox({ label, users, value, onChange, placeholder }) {
	const selected = users.find((user) => user.id === value);
	const [query, setQuery] = (0, import_react.useState)(selected?.name ?? "");
	const [open, setOpen] = (0, import_react.useState)(false);
	const matches = query.trim() ? users.filter((user) => user.name.includes(query.trim())).slice(0, 8) : [];
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
		className: "person-combobox",
		children: [label, /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
				value: selected ? selected.name : query,
				placeholder,
				autoComplete: "off",
				onFocus: () => setOpen(true),
				onBlur: () => window.setTimeout(() => setOpen(false), 120),
				onChange: (event) => {
					setQuery(event.target.value);
					onChange("");
					setOpen(true);
				}
			}),
			selected && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
				type: "button",
				"aria-label": `清除${label}`,
				onClick: () => {
					onChange("");
					setQuery("");
				},
				children: "×"
			}),
			open && query.trim() && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
				className: "person-options",
				children: [matches.map((user) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
					type: "button",
					onMouseDown: (event) => event.preventDefault(),
					onClick: () => {
						onChange(user.id);
						setQuery("");
						setOpen(false);
					},
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: user.name }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: user.department || "品牌营销部" })]
				}, user.id)), matches.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("em", { children: "未找到匹配同事" })]
			})
		] })]
	});
}
function DailyScriptsView({ users, currentUser, onSubmitted }) {
	const [form, setForm] = (0, import_react.useState)({
		title: "",
		talentName: "",
		scriptType: SCRIPT_TYPES[0],
		product: PRODUCTS[0],
		content: "",
		authorUserId: currentUser?.id ?? "",
		teamLeadReviewerId: "",
		supervisorReviewerId: "",
		priority: "普通",
		dueDate: "",
		videoUrls: ""
	});
	const [videoFiles, setVideoFiles] = (0, import_react.useState)([]);
	const [busy, setBusy] = (0, import_react.useState)(false);
	const [error, setError] = (0, import_react.useState)("");
	const effectiveAuthorUserId = form.authorUserId || currentUser?.id || "";
	const loadDocument = async (file) => {
		if (!file) return;
		try {
			const content = await extractDocument(file);
			setForm((current) => ({
				...current,
				title: current.title || file.name.replace(/\.[^.]+$/, ""),
				content
			}));
			setError("");
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : "文档读取失败");
		}
	};
	const submit = async () => {
		setBusy(true);
		setError("");
		try {
			const response = await fetch(appUrl("/api/daily-scripts"), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					...form,
					authorUserId: effectiveAuthorUserId,
					videoUrls: form.videoUrls.split(/\n+/).map((url) => url.trim()).filter(Boolean)
				})
			});
			const payload = await response.json();
			if (!response.ok || !payload.draft) throw new Error(payload.error || "提交失败");
			for (const file of videoFiles) {
				const body = new FormData();
				body.append("file", file);
				body.append("draftId", payload.draft.id);
				const upload = await fetch(appUrl("/api/draft-media"), {
					method: "POST",
					body
				});
				if (!upload.ok) {
					const result = await upload.json();
					throw new Error(result.error || `${file.name} 上传失败`);
				}
			}
			onSubmitted(payload.draft);
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : "提交失败");
		} finally {
			setBusy(false);
		}
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "page daily-page",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(PageHeading, {
			eyebrow: "DAILY SCRIPT DESK",
			title: "日常脚本创作",
			copy: "写稿、上传、指定审核路径，在同一个工作区完成日常脚本提交。"
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
			className: "daily-editor panel",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
						className: "eyebrow",
						children: "NEW SUBMISSION"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "提交一条新脚本" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "脚本会先推送给组长审核，再进入主管终审；通过后自动归档到品牌案例库。" })
				] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Tag, {
					tone: "glow-dark",
					children: "三级流转"
				})] }),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "daily-form-grid",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: ["脚本名称", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
							value: form.title,
							onChange: (e) => setForm({
								...form,
								title: e.target.value
							}),
							placeholder: "清晰描述脚本主题"
						})] }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: ["合作达人", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
							value: form.talentName,
							onChange: (e) => setForm({
								...form,
								talentName: e.target.value
							}),
							placeholder: "填写达人昵称，暂无可留空"
						})] }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: ["脚本类型", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("select", {
							value: form.scriptType,
							onChange: (e) => setForm({
								...form,
								scriptType: e.target.value
							}),
							children: SCRIPT_TYPES.map((value) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: value }, value))
						})] }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: ["单品", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("select", {
							value: form.product,
							onChange: (e) => setForm({
								...form,
								product: e.target.value
							}),
							children: PRODUCTS.map((value) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: value }, value))
						})] }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(PersonCombobox, {
							label: "作者",
							users,
							value: effectiveAuthorUserId,
							onChange: (value) => setForm({
								...form,
								authorUserId: value
							}),
							placeholder: "输入姓名搜索"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(PersonCombobox, {
							label: "组长审核人",
							users,
							value: form.teamLeadReviewerId,
							onChange: (value) => setForm({
								...form,
								teamLeadReviewerId: value
							}),
							placeholder: "输入姓名搜索"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(PersonCombobox, {
							label: "主管审核人",
							users,
							value: form.supervisorReviewerId,
							onChange: (value) => setForm({
								...form,
								supervisorReviewerId: value
							}),
							placeholder: "输入姓名搜索"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: ["优先级", /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", {
							value: form.priority,
							onChange: (e) => setForm({
								...form,
								priority: e.target.value
							}),
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: "紧急" }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: "普通" }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: "低" })
							]
						})] }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: ["期望完成", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
							type: "date",
							value: form.dueDate,
							onChange: (e) => setForm({
								...form,
								dueDate: e.target.value
							})
						})] })
					]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
					className: "daily-content",
					children: [
						"脚本文案",
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", {
							value: form.content,
							onChange: (e) => setForm({
								...form,
								content: e.target.value
							}),
							placeholder: "在这里撰写脚本，或从下方上传 DOCX / TXT / MD 文档…"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("small", { children: [form.content.replace(/\s/g, "").length, " 字"] })
					]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "daily-attachments",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
							className: "document-drop",
							children: [
								"上传脚本文档",
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
									type: "file",
									accept: ".docx,.txt,.md,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document",
									onChange: (e) => loadDocument(e.target.files?.[0])
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "选择 DOCX / TXT / MD" }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "文档内容会自动填入编辑区" })
							]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
							className: "document-drop",
							children: [
								"上传关联视频",
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
									type: "file",
									multiple: true,
									accept: "video/mp4,video/quicktime,.mp4,.mov",
									onChange: (e) => setVideoFiles(Array.from(e.target.files ?? []))
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: videoFiles.length ? `已选择 ${videoFiles.length} 个视频` : "选择 MP4 / MOV" }),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "单个文件不超过 200MB" })
							]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: ["视频链接", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", {
							value: form.videoUrls,
							onChange: (e) => setForm({
								...form,
								videoUrls: e.target.value
							}),
							placeholder: "每行一个视频链接"
						})] })
					]
				}),
				error && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "form-error",
					children: error
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("footer", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "提交后可在“审核与反馈”中查看版本和处理进度。" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					className: "primary-btn",
					disabled: busy,
					onClick: submit,
					children: busy ? "正在提交…" : "提交组长审核 →"
				})] })
			]
		})]
	});
}
function ScriptsView({ cases, users, currentUser, onSubmitted, showToast }) {
	const styles = [...SCRIPT_TYPES];
	const [product, setProduct] = (0, import_react.useState)("眼膜");
	const [scriptType, setScriptType] = (0, import_react.useState)("付费KOC脚本");
	const [audience, setAudience] = (0, import_react.useState)("30+熟龄女性，重点覆盖40+资深中产、都市银发和小镇中老年女性");
	const [requirements, setRequirements] = (0, import_react.useState)("多打抗老、容貌焦虑和显年轻；口播自然，突出肤感、状态变化、价格机制与促单，不写研发说明书。");
	const [templateSearch, setTemplateSearch] = (0, import_react.useState)("");
	const [templateId, setTemplateId] = (0, import_react.useState)(cases[0]?.id ?? "");
	const [drafts, setDrafts] = (0, import_react.useState)([]);
	const [analysis, setAnalysis] = (0, import_react.useState)("");
	const [phase, setPhase] = (0, import_react.useState)("idle");
	const [regeneratingId, setRegeneratingId] = (0, import_react.useState)("");
	const [error, setError] = (0, import_react.useState)("");
	const [authorType, setAuthorType] = (0, import_react.useState)("内部同事");
	const [authorName, setAuthorName] = (0, import_react.useState)("");
	const [authorUserId, setAuthorUserId] = (0, import_react.useState)(currentUser?.id ?? "");
	const [teamLeadReviewerId, setTeamLeadReviewerId] = (0, import_react.useState)("");
	const [supervisorReviewerId, setSupervisorReviewerId] = (0, import_react.useState)("");
	const [priority, setPriority] = (0, import_react.useState)("普通");
	const [dueDate, setDueDate] = (0, import_react.useState)("");
	const effectiveAuthorName = authorType === "内部同事" ? users.find((user) => user.id === authorUserId)?.name || currentUser?.name || "" : authorName;
	const effectiveTeamLeadId = teamLeadReviewerId;
	const effectiveSupervisorId = supervisorReviewerId;
	const teamLeadReviewers = users;
	const supervisorReviewers = users;
	const selected = cases.find((item) => item.id === templateId) ?? cases[0];
	const matchedCases = cases.filter((item) => `${item.title}${item.copy}${item.product}${item.scriptType}`.toLowerCase().includes(templateSearch.toLowerCase())).slice(0, 20);
	const generate = async (count = 1, replaceId = "") => {
		if (!selected) {
			setError("品牌案例库中暂无可选脚本，请先导入案例");
			return;
		}
		setError("");
		setRegeneratingId(replaceId);
		setPhase("analyzing");
		setAnalysis("正在读取参考脚本全文，并逐条核对补充需求…");
		window.setTimeout(() => setPhase((current) => current === "analyzing" ? "creating" : current), 450);
		try {
			const response = await fetch(appUrl("/api/scripts"), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					product,
					scriptType,
					templateId: selected.id,
					templateTitle: selected.title,
					templateCopy: selected.copy,
					requirements,
					audience,
					count,
					generationKey: crypto.randomUUID()
				})
			});
			const payload = await response.json();
			if (!response.ok || !payload.drafts) throw new Error(payload.error || "生成失败");
			setDrafts((current) => replaceId ? current.map((item) => item.id === replaceId ? payload.drafts[0] : item) : payload.drafts);
			setAnalysis(payload.analysis ?? "创作完成");
			showToast(replaceId ? "已换成全新脚本" : `已生成 ${payload.drafts.length} 个新版本`, "参考脚本与补充需求均已写入本轮创作依据");
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : "生成失败");
		} finally {
			setPhase("idle");
			setRegeneratingId("");
		}
	};
	const patchDraft = async (draft, action) => {
		setError("");
		if (action === "submit" && (!effectiveTeamLeadId || !effectiveSupervisorId)) {
			setError("送审前，请明确选择具体的组长审核人和主管审核人");
			return;
		}
		try {
			const response = await fetch(appUrl(`/api/scripts/${draft.id}`), {
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					action,
					title: draft.title,
					content: draft.content,
					authorType,
					authorName: effectiveAuthorName,
					authorUserId: authorType === "内部同事" ? authorUserId : "",
					teamLeadReviewerId: effectiveTeamLeadId,
					supervisorReviewerId: effectiveSupervisorId,
					priority,
					dueDate
				})
			});
			const payload = await response.json();
			if (!response.ok || !payload.draft) throw new Error(payload.error || "保存失败");
			setDrafts((current) => current.map((item) => item.id === draft.id ? payload.draft : item));
			if (action === "submit") onSubmitted(payload.draft);
			else showToast("修改已保存", draft.title);
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : "保存失败");
		}
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "page",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(PageHeading, {
			eyebrow: "AI SCRIPT CREATION",
			title: "AI 脚本创作",
			copy: "读取所选案例的完整内容，再把补充需求作为硬约束，生成可编辑、可单独重做的候选脚本。"
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "studio-grid",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "generator-panel panel",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "panel-head",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "eyebrow",
							children: "CREATIVE BRIEF"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "创作任务" })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Tag, {
							tone: "glow-dark",
							children: "案例库已连接"
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: ["产品", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("select", {
						value: product,
						onChange: (event) => setProduct(event.target.value),
						children: PRODUCTS.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: item }, item))
					})] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: ["目标风格", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("select", {
						value: scriptType,
						onChange: (event) => setScriptType(event.target.value),
						children: styles.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: item }, item))
					})] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: ["核心人群", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
						value: audience,
						onChange: (event) => setAudience(event.target.value),
						placeholder: "例如：40+熟龄女性、都市银发、小镇中老年"
					})] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: ["搜索案例库脚本", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
						className: "template-search",
						value: templateSearch,
						onChange: (event) => setTemplateSearch(event.target.value),
						placeholder: "按标题、文案、产品或类型搜索"
					})] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "template-picker",
						children: [matchedCases.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
							type: "button",
							className: selected?.id === item.id ? "active" : "",
							onClick: () => setTemplateId(item.id),
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: item.title }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("small", { children: [
								item.scriptType,
								" · ",
								item.product
							] })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { children: selected?.id === item.id ? "✓" : "" })]
						}, item.id)), matchedCases.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "没有匹配脚本" })]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
						"补充需求",
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", {
							value: requirements,
							onChange: (event) => setRequirements(event.target.value),
							placeholder: "自由输入创作要求，例如容貌痛点、达人语气、价格机制、肤感或指定钩子"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "普通脚本默认纯口播约300字，合适区间260—340字；镜头说明不计入。" })
					] }),
					selected && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "reference-box",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "▦" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("strong", { children: ["已选：", selected.title] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("small", { children: [
							selected.scriptType,
							" · ",
							selected.product,
							" · ",
							selected.copy.slice(0, 34),
							"…"
						] })] })]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "workflow-config",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "eyebrow",
								children: "REVIEW ROUTING"
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h4", { children: "作者与审核路径" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "confirm-grid",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: ["作者类型", /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", {
										value: authorType,
										onChange: (event) => setAuthorType(event.target.value),
										children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: "内部同事" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: "外部达人" })]
									})] }),
									authorType === "内部同事" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PersonCombobox, {
										label: "作者",
										users,
										value: authorUserId,
										onChange: setAuthorUserId,
										placeholder: "输入姓名搜索"
									}) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: ["作者 / 达人名", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
										value: authorName,
										onChange: (event) => setAuthorName(event.target.value),
										placeholder: "填写实际作者"
									})] }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)(PersonCombobox, {
										label: "组长审核人",
										users: teamLeadReviewers,
										value: effectiveTeamLeadId,
										onChange: setTeamLeadReviewerId,
										placeholder: "输入姓名搜索"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)(PersonCombobox, {
										label: "主管审核人",
										users: supervisorReviewers,
										value: effectiveSupervisorId,
										onChange: setSupervisorReviewerId,
										placeholder: "输入姓名搜索"
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: ["优先级", /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", {
										value: priority,
										onChange: (event) => setPriority(event.target.value),
										children: [
											/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: "普通" }),
											/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: "紧急" }),
											/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: "低" })
										]
									})] }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: ["期望完成", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
										type: "date",
										value: dueDate,
										onChange: (event) => setDueDate(event.target.value)
									})] })
								]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "必须明确选择组长与主管；送审后按“组长审核 → 主管终审 → 品牌案例库”推进。" })
						]
					}),
					error && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "form-error",
						children: error
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "generation-buttons",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
							className: "primary-btn full",
							type: "button",
							disabled: phase !== "idle",
							onClick: () => generate(1),
							children: ["✦ ", phase === "analyzing" ? "正在分析参考脚本…" : phase === "creating" ? "正在创作新脚本…" : "生成 1 个脚本"]
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							className: "secondary-btn full",
							type: "button",
							disabled: phase !== "idle",
							onClick: () => generate(3),
							children: "一次生成 3 个"
						})]
					})
				]
			}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "script-results",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "result-head",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "eyebrow",
							children: "OUTPUT"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: drafts.length ? `${drafts.length} 个候选版本` : "等待生成" })] }), drafts.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							className: "secondary-btn",
							disabled: phase !== "idle",
							onClick: () => generate(drafts.length),
							children: "↻ 全部重新生成"
						})]
					}),
					analysis && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "creation-analysis",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "✦" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "创作要求分析" }), analysis] })]
					}),
					drafts.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "generation-empty",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { children: "✦" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "让案例成为下一条好脚本" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "系统会读取参考脚本全文，并把补充需求逐条落实到新稿中。默认先生成一条，需要比较时也可以一次生成三条。" })
						]
					}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "draft-stack",
						children: drafts.map((draft, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
							className: "draft-card",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
									className: "draft-card-head",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
										className: "script-version",
										children: String.fromCharCode(65 + index)
									}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("small", { children: [
										draft.id,
										" · v",
										draft.version
									] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Tag, { children: draft.scriptType })] })]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
									className: "draft-title-input",
									value: draft.title,
									onChange: (event) => setDrafts((current) => current.map((item) => item.id === draft.id ? {
										...item,
										title: event.target.value
									} : item))
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", {
									className: "draft-content-input",
									value: draft.content,
									onChange: (event) => setDrafts((current) => current.map((item) => item.id === draft.id ? {
										...item,
										content: event.target.value
									} : item))
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
									className: "draft-actions",
									children: [
										/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
											className: "regenerate-btn",
											disabled: phase !== "idle",
											onClick: () => generate(1, draft.id),
											children: ["↻ ", regeneratingId === draft.id ? "正在重写…" : "重新生成此版本"]
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
											className: "secondary-btn",
											onClick: () => patchDraft(draft, "save"),
											children: "保存修改"
										}),
										/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
											className: "primary-btn",
											onClick: () => patchDraft(draft, "submit"),
											children: "确定并送审 →"
										})
									]
								})
							]
						}, draft.id))
					})
				]
			})]
		})]
	});
}
function ReviewView({ items, currentUser, onUpdate, onDeleted, onApproved, showToast }) {
	const [statusFilter, setStatusFilter] = (0, import_react.useState)("all");
	const [visibleCount, setVisibleCount] = (0, import_react.useState)(8);
	const activeItems = items.filter((item) => item.status !== "approved");
	const assigned = activeItems.filter((item) => item.currentReviewerId === currentUser?.id);
	const filteredItems = statusFilter === "active" ? activeItems : statusFilter === "approved" ? items.filter((item) => item.status === "approved") : items;
	const visibleItems = filteredItems.slice(0, visibleCount);
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "page",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(PageHeading, {
				eyebrow: "HUMAN IN THE LOOP",
				title: "审核与反馈",
				copy: "脚本按作者、组长审核与主管终审流转；每次修改留有版本，终审通过后自动归档。"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "review-summary",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: assigned.length }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "分配给我" })] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: activeItems.filter((item) => item.status === "pending_team_lead").length }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "组长审核" })] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: activeItems.filter((item) => item.status === "pending_supervisor").length }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "主管终审" })] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: activeItems.filter((item) => item.status === "returned_to_creator").length }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "退回修改" })] })
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "review-workspace",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "review-queue-head",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "eyebrow",
							children: "REVIEW QUEUE"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "脚本与审核任务" })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Tag, { children: [items.length, " 条脚本"] })]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "review-filters",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
								className: statusFilter === "all" ? "active" : "",
								onClick: () => {
									setStatusFilter("all");
									setVisibleCount(8);
								},
								children: ["全部 ", items.length]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
								className: statusFilter === "active" ? "active" : "",
								onClick: () => {
									setStatusFilter("active");
									setVisibleCount(8);
								},
								children: ["进行中 ", activeItems.length]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
								className: statusFilter === "approved" ? "active" : "",
								onClick: () => {
									setStatusFilter("approved");
									setVisibleCount(8);
								},
								children: ["已归档 ", items.length - activeItems.length]
							})
						]
					}),
					filteredItems.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "generation-empty review-empty",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { children: "✓" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "当前没有匹配脚本" }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "新的脚本与审核任务会自动出现在这里。" })
						]
					}) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "review-card-list",
						children: visibleItems.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ReviewCard, {
							item,
							currentUser,
							onUpdate,
							onDeleted,
							onApproved,
							showToast
						}, `${item.id}-${item.version}-${item.status}`))
					}), visibleItems.length < filteredItems.length && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
						className: "load-more-btn",
						onClick: () => setVisibleCount((count) => count + 8),
						children: [
							"继续加载（还有 ",
							filteredItems.length - visibleItems.length,
							" 条）"
						]
					})] })
				]
			})
		]
	});
}
function ReviewCard({ item, currentUser, onUpdate, onDeleted, onApproved, showToast }) {
	const [draft, setDraft] = (0, import_react.useState)(item);
	const [feedback, setFeedback] = (0, import_react.useState)(item.feedback ?? "");
	const [alternatives, setAlternatives] = (0, import_react.useState)([]);
	const [busy, setBusy] = (0, import_react.useState)("");
	const [error, setError] = (0, import_react.useState)("");
	const [history, setHistory] = (0, import_react.useState)(null);
	const act = async (action, alternativeId = "") => {
		setBusy(action);
		setError("");
		try {
			const response = await fetch(appUrl(`/api/scripts/${draft.id}`), {
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					action,
					title: draft.title,
					content: draft.content,
					feedback,
					alternativeId
				})
			});
			const payload = await response.json();
			if (!response.ok || !payload.draft) throw new Error(payload.error || "操作失败");
			if (action === "supervisor_approve" && payload.case) {
				onApproved(payload.draft, payload.case);
				setDraft(payload.draft);
				return;
			}
			if (action === "regenerate" && payload.alternative) {
				setAlternatives((current) => [payload.alternative, ...current]);
				showToast("AI 新稿已单独生成", "原稿没有被覆盖，可对照后再决定是否采用");
				return;
			}
			setDraft(payload.draft);
			onUpdate(payload.draft);
			if (action === "adopt_alternative") setAlternatives((current) => current.map((item) => item.id === alternativeId ? {
				...item,
				adopted: true
			} : item));
			showToast({
				adopt_alternative: `已采用为 v${payload.draft.version}`,
				team_lead_approve: "组长审核已通过",
				reject: "已退回修改",
				resubmit: "已重新送审",
				save: "修改已保存"
			}[action] || "操作已完成", payload.draft.title);
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : "操作失败");
		} finally {
			setBusy("");
		}
	};
	const statusMap = {
		generated: "创作草稿",
		pending_review: "历史待审核",
		pending_team_lead: "组长审核",
		pending_supervisor: "主管终审",
		returned_to_creator: "退回修改",
		approved: "已归档"
	};
	const admin = currentUser?.role === "admin";
	const reviewer = !!currentUser && (draft.currentReviewerId === currentUser.id || admin);
	const editor = !!currentUser && ([
		draft.creatorId,
		draft.uploaderId,
		draft.authorUserId
	].includes(currentUser.id) || admin);
	const canDelete = editor;
	const removeDraft = async () => {
		if (!window.confirm(`确定删除“${draft.title}”吗？相关审核记录也会一并删除。`)) return;
		setBusy("delete");
		setError("");
		try {
			const response = await fetch(appUrl(`/api/scripts/${draft.id}`), { method: "DELETE" });
			const payload = await response.json();
			if (!response.ok) throw new Error(payload.error || "删除失败");
			onDeleted(draft.id);
			showToast("脚本已删除", draft.title);
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : "删除失败");
		} finally {
			setBusy("");
		}
	};
	const loadHistory = async () => {
		if (history) {
			setHistory(null);
			return;
		}
		const response = await fetch(appUrl(`/api/scripts/${draft.id}/history`));
		const payload = await response.json();
		if (response.ok) {
			setHistory(payload);
			setAlternatives(payload.alternatives ?? []);
		} else setError(payload.error || "历史记录读取失败");
	};
	let videos = [];
	try {
		videos = JSON.parse(draft.videoLinks || "[]");
	} catch {
		videos = [];
	}
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
		className: "review-card",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "review-card-head",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "review-id",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: draft.id }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Tag, {
							tone: draft.status === "returned_to_creator" ? "danger" : "warning",
							children: statusMap[draft.status] || draft.status
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Tag, { children: ["v", draft.version] }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Tag, { children: draft.priority || "普通" })
					]
				}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
					value: draft.title,
					disabled: !editor && !reviewer,
					onChange: (event) => setDraft({
						...draft,
						title: event.target.value
					})
				})] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "review-product",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: draft.product }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: draft.scriptType })]
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "workflow-route",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "作者" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: draft.authorName || "待补充" })] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { children: "→" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "组长审核" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: draft.teamLeadReviewerName || "待分配" })] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { children: "→" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "主管终审" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: draft.supervisorReviewerName || "待分配" })] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("i", { children: "→" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "归档" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: "品牌案例库" })] })
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "review-context",
				children: [
					draft.talentName && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: ["合作达人：", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: draft.talentName })] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: ["当前处理人：", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: draft.currentReviewerId === currentUser?.id ? "我" : draft.status === "pending_team_lead" ? draft.teamLeadReviewerName : draft.status === "pending_supervisor" ? draft.supervisorReviewerName : draft.creatorName })] }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: ["截止：", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: draft.dueDate || "未设置" })] })
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "revision-compare",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
						className: "eyebrow",
						children: ["CURRENT VERSION · V", draft.version]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h4", { children: "当前审核稿" }),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", {
						className: "review-content",
						value: draft.content,
						disabled: !editor && !reviewer,
						onChange: (event) => setDraft({
							...draft,
							content: event.target.value
						})
					}),
					videos.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
						className: "draft-media-links",
						children: videos.map((url, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("a", {
							href: url.startsWith("/api/") ? appUrl(url) : url,
							target: "_blank",
							rel: "noreferrer",
							children: ["▶ 关联视频 ", index + 1]
						}, url))
					})
				] }), alternatives.filter((entry) => !entry.adopted).map((entry) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
					className: "alternative-draft",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "eyebrow",
							children: "AI REVISION · NEW"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h4", { children: "AI 新稿（未覆盖原稿）" }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
							className: "alternative-request",
							children: ["修改要求：", entry.request]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("pre", { children: entry.content }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							className: "primary-btn",
							disabled: !!busy,
							onClick: () => act("adopt_alternative", entry.id),
							children: "采用这版作为新版本"
						}) })
					]
				}, entry.id))]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "feedback-box",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: ["审核意见 / AI 修改要求", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", {
					value: feedback,
					onChange: (event) => setFeedback(event.target.value),
					placeholder: "写清需要调整的开头、口语感、卖点、价格机制或促单方向。"
				})] }), (editor || reviewer) && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
					className: "ai-revise-btn",
					disabled: !!busy,
					onClick: () => act("regenerate"),
					children: ["✦ ", busy === "regenerate" ? "正在按意见生成另一版…" : "AI 按意见生成新稿"]
				})]
			}),
			error && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "form-error",
				children: error
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "review-actions",
				children: [
					canDelete && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						className: "danger-btn",
						disabled: !!busy,
						onClick: removeDraft,
						children: busy === "delete" ? "正在删除…" : "删除脚本"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
						className: "history-btn",
						onClick: loadHistory,
						children: history ? "收起记录" : "查看版本与审核记录"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
						editor && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							className: "secondary-btn",
							disabled: !!busy,
							onClick: () => act("save"),
							children: "保存当前稿"
						}),
						draft.status === "returned_to_creator" && editor && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							className: "primary-btn",
							disabled: !!busy,
							onClick: () => act("resubmit"),
							children: "修改完成，重新送审 →"
						}),
						["pending_team_lead", "pending_supervisor"].includes(draft.status) && reviewer && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							className: "secondary-btn",
							disabled: !!busy,
							onClick: () => act("reject"),
							children: "退回修改"
						}),
						draft.status === "pending_team_lead" && reviewer && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							className: "approve-btn large",
							disabled: !!busy,
							onClick: () => act("team_lead_approve"),
							children: "组长审核通过 →"
						}),
						draft.status === "pending_supervisor" && reviewer && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							className: "approve-btn large",
							disabled: !!busy,
							onClick: () => act("supervisor_approve"),
							children: "主管终审并归档 ✓"
						})
					] })
				]
			}),
			history && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "history-panel",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h4", { children: "历史版本（全文）" }), history.versions.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
					className: "history-entry",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("b", { children: [
							"v",
							entry.version,
							" · ",
							entry.title
						] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("time", { children: [
							entry.editorName,
							" · ",
							entry.createdAt
						] })] }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: entry.reason }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("pre", { children: entry.content })
					]
				}, entry.id))] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h4", { children: "审核意见与修改要求" }), history.actions.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", {
					className: "history-entry action-entry",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("b", { children: [
						entry.actorName,
						" · ",
						entry.action
					] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("time", { children: entry.createdAt })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: entry.comment || "无补充意见" })]
				}, entry.id))] })]
			})
		]
	});
}
function CollaborationsView() {
	const stages = [
		"待建联",
		"已寄样",
		"脚本确认",
		"拍摄中",
		"待发布",
		"已完成"
	];
	const [items, setItems] = (0, import_react.useState)([]);
	const [form, setForm] = (0, import_react.useState)({
		creatorName: "",
		platform: "抖音",
		product: "眼膜",
		owner: "",
		stage: "待建联",
		dueDate: "",
		note: ""
	});
	const [batchOpen, setBatchOpen] = (0, import_react.useState)(false);
	const [batchText, setBatchText] = (0, import_react.useState)("");
	const [batchPreview, setBatchPreview] = (0, import_react.useState)([]);
	const [error, setError] = (0, import_react.useState)("");
	const [saving, setSaving] = (0, import_react.useState)(false);
	(0, import_react.useEffect)(() => {
		fetch(appUrl("/api/collaborations")).then((r) => r.ok ? r.json() : Promise.reject()).then((p) => setItems(p.items ?? [])).catch(() => setError("合作进度暂时无法读取"));
	}, []);
	const create = async () => {
		if (!form.creatorName.trim()) {
			setError("请填写达人名称");
			return;
		}
		setSaving(true);
		setError("");
		try {
			const r = await fetch(appUrl("/api/collaborations"), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(form)
			});
			const p = await r.json();
			if (!r.ok || !p.item) throw new Error(p.error || "创建失败");
			setItems((c) => [p.item, ...c]);
			setForm({
				...form,
				creatorName: "",
				owner: "",
				dueDate: "",
				note: ""
			});
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : "创建失败");
		} finally {
			setSaving(false);
		}
	};
	const recognizeBatch = () => {
		const rows = batchText.split(/\n+/).map((line) => line.trim()).filter(Boolean).map((line) => {
			const [creatorName, platform = "抖音", product = "眼膜", owner = "待分配", stage = "待建联", dueDate = "", ...notes] = line.split(/\t|\||，|,/).map((value) => value.trim());
			return {
				creatorName,
				platform,
				product,
				owner,
				stage: stages.includes(stage) ? stage : "待建联",
				dueDate,
				note: notes.join("，")
			};
		}).filter((row) => row.creatorName);
		if (!rows.length) {
			setError("请至少粘贴一条达人合作任务");
			return;
		}
		setError("");
		setBatchPreview(rows.slice(0, 100));
	};
	const saveBatch = async () => {
		if (!batchPreview.length) return;
		setSaving(true);
		setError("");
		try {
			const r = await fetch(appUrl("/api/collaborations"), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ items: batchPreview })
			});
			const p = await r.json();
			if (!r.ok || !p.items) throw new Error(p.error || "批量导入失败");
			setItems((current) => [...p.items, ...current]);
			setBatchOpen(false);
			setBatchText("");
			setBatchPreview([]);
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : "批量导入失败");
		} finally {
			setSaving(false);
		}
	};
	const move = async (item, stage) => {
		setError("");
		try {
			const r = await fetch(appUrl("/api/collaborations"), {
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					id: item.id,
					stage
				})
			});
			const p = await r.json();
			if (!r.ok || !p.item) throw new Error(p.error || "更新失败");
			setItems((current) => current.map((entry) => entry.id === item.id ? p.item : entry));
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : "更新失败");
		}
	};
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "page collaborations-page",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(PageHeading, {
				eyebrow: "CREATOR COLLABORATION",
				title: "达人合作进度",
				copy: "从建联、寄样、脚本确认到发布，集中管理每一项达人合作。",
				action: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
					className: "secondary-btn",
					onClick: () => setBatchOpen(true),
					children: "⇧ 批量导入"
				})
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
				className: "panel collaboration-create",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "panel-head",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "eyebrow",
							children: "SINGLE IMPORT"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: "单条导入合作任务" })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Tag, {
							tone: "glow-dark",
							children: "实时入板"
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "collaboration-form",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: ["达人名称", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
								value: form.creatorName,
								onChange: (e) => setForm({
									...form,
									creatorName: e.target.value
								}),
								placeholder: "达人昵称"
							})] }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: ["平台", /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", {
								value: form.platform,
								onChange: (e) => setForm({
									...form,
									platform: e.target.value
								}),
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: "抖音" }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: "小红书" }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: "视频号" }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: "B站" })
								]
							})] }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: ["合作产品", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("select", {
								value: form.product,
								onChange: (e) => setForm({
									...form,
									product: e.target.value
								}),
								children: PRODUCTS.map((p) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: p }, p))
							})] }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: ["负责人", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
								value: form.owner,
								onChange: (e) => setForm({
									...form,
									owner: e.target.value
								}),
								placeholder: "负责人"
							})] }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: ["截止日期", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
								type: "date",
								value: form.dueDate,
								onChange: (e) => setForm({
									...form,
									dueDate: e.target.value
								})
							})] }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: ["合作备注", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
								value: form.note,
								onChange: (e) => setForm({
									...form,
									note: e.target.value
								}),
								placeholder: "选填"
							})] }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
								className: "primary-btn",
								disabled: saving,
								onClick: create,
								children: saving ? "正在导入…" : "＋ 单条导入"
							})
						]
					}),
					error && !batchOpen && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "form-error",
						children: error
					})
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("section", {
				className: "collaboration-board",
				children: stages.map((stage, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
					className: "collaboration-column",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", { children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: String(index + 1).padStart(2, "0") }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: stage }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: items.filter((item) => item.stage === stage).length })
					] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [items.filter((item) => item.stage === stage).map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", { children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("small", { children: [
							item.id,
							" · ",
							item.platform
						] }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h4", { children: item.creatorName }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: item.product }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: item.owner || "待分配" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("time", { children: item.dueDate || "未设日期" })] }),
						item.note && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("em", { children: item.note }),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("select", {
							className: "stage-control",
							value: item.stage,
							onChange: (e) => move(item, e.target.value),
							"aria-label": "更新合作阶段",
							children: stages.map((value) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: value }, value))
						})
					] }, item.id)), !items.some((item) => item.stage === stage) && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "collaboration-empty",
						children: "暂无任务"
					})] })]
				}, stage))
			}),
			batchOpen && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "modal-backdrop",
				onMouseDown: (event) => {
					if (event.target === event.currentTarget) setBatchOpen(false);
				},
				children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
					className: "import-modal collaboration-import-modal",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "import-modal-head",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
							className: "eyebrow",
							children: "BATCH IMPORT"
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", { children: "批量导入达人合作" })] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							onClick: () => setBatchOpen(false),
							children: "×"
						})]
					}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "import-body",
						children: [!batchPreview.length ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: ["粘贴合作清单", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("textarea", {
								value: batchText,
								onChange: (event) => setBatchText(event.target.value),
								placeholder: "每行一条，按以下顺序填写：\n达人名，平台，产品，负责人，阶段，截止日期，备注\n\n示例：\n小鹿，抖音，眼膜，李雨橦，待建联，2026-08-30，首轮合作"
							})] }),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "recognize-hint",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "✦" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "支持逗号、制表符或竖线分隔" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "一次最多识别 100 条，识别后可逐条确认" })] })]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "modal-actions",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
									className: "secondary-btn",
									onClick: () => setBatchOpen(false),
									children: "取消"
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
									className: "primary-btn",
									onClick: recognizeBatch,
									children: "识别并预览 →"
								})]
							})
						] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "recognition-score",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: "✓" }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("strong", { children: [
									"已识别 ",
									batchPreview.length,
									" 条合作任务"
								] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("small", { children: "确认达人、平台、产品与负责人后再写入进度板" })] })]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "collaboration-preview",
								children: batchPreview.map((row, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", { children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { children: row.creatorName }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { children: [
										row.platform,
										" · ",
										row.product
									] }),
									/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("small", { children: [
										row.owner,
										" · ",
										row.stage,
										" · ",
										row.dueDate || "未设日期"
									] })
								] }, `${row.creatorName}-${index}`))
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "modal-actions",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
									className: "secondary-btn",
									onClick: () => setBatchPreview([]),
									children: "← 返回修改"
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
									className: "primary-btn",
									disabled: saving,
									onClick: saveBatch,
									children: saving ? "正在批量写入…" : `确认导入 ${batchPreview.length} 条`
								})]
							})
						] }), error && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "form-error",
							children: error
						})]
					})]
				})
			})
		]
	});
}
//#endregion
export { Home as default };
