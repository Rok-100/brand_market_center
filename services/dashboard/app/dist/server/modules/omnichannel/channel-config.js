"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OMNICHANNEL_TARGET_GSV_WAN = exports.CHANNEL_METADATA = exports.BRAND_MARKETING_FINANCE_TREND_2026 = void 0;
exports.getChannelMeta = getChannelMeta;
exports.getOnlineChannels = getOnlineChannels;
exports.getChannelsWithData = getChannelsWithData;
exports.getMissingChannels = getMissingChannels;
exports.BRAND_MARKETING_FINANCE_TREND_2026 = [
    { month: "2026-01", label: "1月", incomeWan: 2217, profitMarginPct: -24.2 },
    { month: "2026-02", label: "2月", incomeWan: 2576, profitMarginPct: -24.5 },
    { month: "2026-03", label: "3月", incomeWan: 5290, profitMarginPct: -5.7 },
    { month: "2026-04", label: "4月", incomeWan: 3272, profitMarginPct: -16.4 },
    { month: "2026-05", label: "5月", incomeWan: 3697, profitMarginPct: -14.7 },
    { month: "2026-06", label: "6月", incomeWan: 5508, profitMarginPct: -8.3 },
    { month: "2026-07", label: "7月", incomeWan: 5756, profitMarginPct: -7.3 },
];
exports.CHANNEL_METADATA = [
    { key: "douyin", label: "抖音", category: "online", dataSource: "mcp", hasRealData: true, dedupeKey: "platform_order_no" },
    { key: "wechat", label: "视频号", category: "online", dataSource: "postgres", hasRealData: true, dedupeKey: "wechat_order_no" },
    { key: "koc", label: "KOC", category: "online", dataSource: "pending", hasRealData: false, dedupeKey: null },
    { key: "dabo", label: "达播", category: "online", dataSource: "pending", hasRealData: false, dedupeKey: null },
    { key: "tmall", label: "天猫", category: "online", dataSource: "pending", hasRealData: false, dedupeKey: null },
    { key: "jd", label: "京东", category: "online", dataSource: "pending", hasRealData: false, dedupeKey: null },
    { key: "kuaishou", label: "快手", category: "online", dataSource: "pending", hasRealData: false, dedupeKey: null },
    { key: "pdd", label: "拼多多", category: "online", dataSource: "pending", hasRealData: false, dedupeKey: null },
    { key: "vip", label: "唯品会", category: "online", dataSource: "pending", hasRealData: false, dedupeKey: null },
    { key: "dewu", label: "得物", category: "online", dataSource: "pending", hasRealData: false, dedupeKey: null },
    { key: "pupu", label: "朴朴超市", category: "online", dataSource: "pending", hasRealData: false, dedupeKey: null },
    { key: "tmall-super", label: "天猫超市", category: "online", dataSource: "pending", hasRealData: false, dedupeKey: null },
    { key: "xiaohongshu", label: "小红书", category: "online", dataSource: "pending", hasRealData: false, dedupeKey: null },
    { key: "yunji-pop", label: "云集POP", category: "online", dataSource: "pending", hasRealData: false, dedupeKey: null },
    { key: "new-media", label: "新媒体", category: "online", dataSource: "pending", hasRealData: false, dedupeKey: null },
    { key: "offline", label: "线下", category: "offline", dataSource: "feishu", hasRealData: false, dedupeKey: "offline_store_date" },
];
exports.OMNICHANNEL_TARGET_GSV_WAN = {
    "2026-07": 7205,
};
function getChannelMeta(key) {
    return exports.CHANNEL_METADATA.find((c) => c.key === key);
}
function getOnlineChannels() {
    return exports.CHANNEL_METADATA.filter((c) => c.category === "online");
}
function getChannelsWithData() {
    return exports.CHANNEL_METADATA.filter((c) => c.hasRealData);
}
function getMissingChannels() {
    return exports.CHANNEL_METADATA.filter((c) => !c.hasRealData);
}
