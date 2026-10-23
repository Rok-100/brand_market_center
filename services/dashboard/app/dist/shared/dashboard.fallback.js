"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FALLBACK_DASHBOARD = void 0;
const calibratedTrend = [
    ["2026-07-02", 664390.57, 6747, "2026-07-16 17:48:06", true],
    ["2026-07-03", 617937.36, 6396, "2026-07-17 10:11:08", true],
    ["2026-07-04", 648167.25, 6764, "2026-07-17 10:11:13", true],
    ["2026-07-05", 741957.39, 7780, "2026-07-17 10:11:13", true],
    ["2026-07-06", 846880.75, 8892, "2026-07-17 10:11:12", true],
    ["2026-07-07", 889752.50, 9493, "2026-07-17 10:11:13", true],
    ["2026-07-08", 922069.73, 9920, "2026-07-17 10:11:12", true],
    ["2026-07-09", 759271.65, 8067, "2026-07-17 10:11:13", true],
    ["2026-07-10", 784996.71, 8309, "2026-07-17 10:11:13", true],
    ["2026-07-11", 861181.40, 9012, "2026-07-17 10:11:13", true],
    ["2026-07-12", 979511.41, 10195, "2026-07-17 10:11:13", true],
    ["2026-07-13", 811818.85, 8139, "2026-07-17 10:11:13", true],
    ["2026-07-14", 728804.43, 7319, "2026-07-17 10:11:13", true],
    ["2026-07-15", 670431.84, 6494, "2026-07-17 10:11:13", true],
    ["2026-07-16", 772120.37, 7040, "2026-07-17 10:11:12", true],
].map(([date, paidSalesYuan, paidOrderCount, sourceUpdatedAt, hasData]) => ({
    date: String(date), paidSalesYuan: Number(paidSalesYuan), paidOrderCount: Number(paidOrderCount),
    sourceUpdatedAt: sourceUpdatedAt ? String(sourceUpdatedAt) : null, hasData: Boolean(hasData),
}));
const calibratedProducts = [
    ["水润面膜", 446356.42, 2978, 2990, 20, 57.81], ["晶润紧致眼膜", 248084.94, 2918, 2923, 12, 32.13],
    ["乳糖酸多效面膜", 25333.51, 273, 276, 6, 3.28], ["抗老护肤套装", 10582.80, 29, 29, 2, 1.37],
    ["极润紧肤护肤套装", 10356.85, 75, 76, 12, 1.34], ["玻尿酸极润面膜", 8900.75, 62, 62, 11, 1.15],
    ["凝颜护肤套装", 7500, 24, 24, 6, .97], ["黑晶光蕴面膜", 5306.52, 70, 70, 3, .69],
    ["深海精粹弹嫩次抛", 2891.66, 40, 40, 2, .37], ["凝颜精粹水", 1389.80, 11, 12, 2, .18],
    ["凝颜洁面乳", 1036, 4, 4, 3, .13], ["时光精粹护肤套装", 918, 6, 6, 1, .12],
    ["温润洁面泡沫", 440.20, 5, 5, 2, .06], ["凝颜紧致弹嫩乳", 417, 3, 3, 1, .05],
    ["凝颜精粹霜", 398, 2, 2, 1, .05], ["男士清爽洁面乳", 375, 5, 5, 1, .05],
    ["净澈洁颜黑泥膜", 373.12, 5, 5, 1, .05], ["痘肌修护面膜", 306, 2, 2, 1, .04],
    ["男士劲能畅通套装", 223, 1, 1, 1, .03], ["重组胶原蛋白次抛精华", 198, 2, 2, 2, .03],
    ["其他：【官方正品】WIS奢研时光精粹乳保湿补水紧致肌肤舒缓精粹乳套装", 168, 1, 1, 1, .02],
    ["温和净透洁面乳", 99.8, 1, 2, 1, .01], ["其他：WIS净澈清肌泡泡面膜油脂10片发泡毛孔清洁控油官方正品", 99, 1, 1, 1, .01],
    ["其他：【官方正品】WIS温和清爽洁面乳控油深层清洁保湿去油光男士洗面奶t", 99, 1, 1, 1, .01],
    ["WIS肌活蛋白喷雾", 99, 1, 1, 1, .01],
    ["其他：【官方正品】WIS胶原奢养抗皱颈膜颈纹保湿紧致颈部护理官方正品tk", 99, 1, 1, 1, .01],
    ["亲肤润唇膏", 69, 1, 1, 1, .01],
].map(([standardProductName, paidSalesYuan, orderCount, productQuantity, productLinkCount, salesSharePct]) => ({
    date: "2026-07-16", standardProductName: String(standardProductName), paidSalesYuan: Number(paidSalesYuan),
    orderCount: Number(orderCount), productQuantity: Number(productQuantity), productLinkCount: Number(productLinkCount),
    salesSharePct: Number(salesSharePct), sourceUpdatedAt: "2026-07-17 10:11:12",
}));
const calibratedTestProductTrends = [
    ["2026-07-02", 251739.75, 198.00], ["2026-07-03", 210781.33, 297.00], ["2026-07-04", 221788.84, 495.00],
    ["2026-07-05", 223753.04, 366.00], ["2026-07-06", 251777.91, 1137.00], ["2026-07-07", 215487.23, 450.00],
    ["2026-07-08", 211798.40, 1281.63], ["2026-07-09", 229726.41, 1168.98], ["2026-07-10", 237968.02, 3551.34],
    ["2026-07-11", 280277.52, 1987.42], ["2026-07-12", 319999.36, 2261.69], ["2026-07-13", 356028.21, 3859.30],
    ["2026-07-14", 333711.85, 2466.03], ["2026-07-15", 339555.70, 2241.27], ["2026-07-16", 434646.44, 2891.66],
].flatMap(([date, waterSales, ampouleSales]) => ([
    {
        date: String(date), standardProductName: "水润面膜", paidSalesYuan: Number(waterSales),
        orderCount: 0, productQuantity: 0, productLinkCount: 0, salesSharePct: 0, sourceUpdatedAt: null,
    },
    {
        date: String(date), standardProductName: "深海精粹弹嫩次抛", paidSalesYuan: Number(ampouleSales),
        orderCount: 0, productQuantity: 0, productLinkCount: 0, salesSharePct: 0, sourceUpdatedAt: null,
    },
]));
const calibratedProductTrends = [
    ...calibratedProducts.filter((item) => !["水润面膜", "深海精粹弹嫩次抛"].includes(item.standardProductName)),
    ...calibratedTestProductTrends,
];
const calibratedAdSpend = [
    ["2026-07-02", 336801.67, 105613.13, 231188.54, "2026-07-18 22:44:12"],
    ["2026-07-03", 315127.77, 105624.70, 209503.07, "2026-07-18 22:45:29"],
    ["2026-07-04", 320187.75, 116974.47, 203213.28, "2026-07-18 22:46:47"],
    ["2026-07-05", 357384.30, 117648.48, 239735.82, "2026-07-18 22:48:04"],
    ["2026-07-06", 418871.65, 150558.23, 268313.42, "2026-07-18 22:49:20"],
    ["2026-07-07", 448649.07, 189587.79, 259061.28, "2026-07-18 22:50:37"],
    ["2026-07-08", 447888.16, 170678.76, 277209.40, "2026-07-18 22:51:54"],
    ["2026-07-09", 367036.30, 149460.17, 217576.13, "2026-07-18 22:53:10"],
    ["2026-07-10", 386131.52, 139904.26, 246227.26, "2026-07-18 22:54:27"],
    ["2026-07-11", 419692.78, 158929.07, 260763.71, "2026-07-18 22:55:44"],
    ["2026-07-12", 462849.60, 180940.24, 281909.36, "2026-07-18 22:57:02"],
    ["2026-07-13", 396532.44, 171654.11, 224878.33, "2026-07-18 22:58:18"],
    ["2026-07-14", 357384.96, 136748.52, 220636.44, "2026-07-18 22:59:36"],
    ["2026-07-15", 329243.78, 118184.75, 211059.03, "2026-07-18 23:00:54"],
    ["2026-07-16", 373925.02, 129086.03, 244838.99, "2026-07-18 23:02:12"],
].map(([date, qianchuanCostYuan, videoCostYuan, liveCostYuan, sourceUpdatedAt]) => ({
    date: String(date), qianchuanCostYuan: Number(qianchuanCostYuan), videoCostYuan: Number(videoCostYuan),
    liveCostYuan: Number(liveCostYuan), advertiserCount: 79, completeRowCount: 79, rowCount: 79,
    sourceUpdatedAt: String(sourceUpdatedAt), hasData: true, isComplete: true,
}));
function fallbackTargetItem(name, targetWan, completedWan) {
    const daysPassed = 16;
    const remainingDays = 15;
    const dailyActualWan = completedWan / daysPassed;
    const dailyRequiredWan = Math.max((targetWan - completedWan) / remainingDays, 0);
    return {
        name,
        targetWan,
        completedWan,
        dailyActualWan,
        dailyRequiredWan,
        dailyGapWan: Math.max(dailyRequiredWan - dailyActualWan, 0),
        progressPct: Math.min(completedWan / targetWan * 100, 100),
    };
}
const FALLBACK_GMV_TARGET = {
    monthLabel: "2026年7月",
    throughDate: "2026-07-16",
    brandTotal: fallbackTargetItem("品牌总目标", 3297, 1158.32),
    products: [
        fallbackTargetItem("眼膜", 1700, 596.8),
        fallbackTargetItem("水润面膜", 1300, 507.0),
        fallbackTargetItem("凝颜", 120, 34.5),
    ],
    remainingDays: 15,
    daysPassed: 16,
    daysInMonth: 31,
};
const calibratedProductSpend = [
    ["2026-07-02", 21896.72, 2, 8, 65.08, 1, 1, "2026-07-19 04:46:47"],
    ["2026-07-03", 26169.78, 2, 9, 96.58, 1, 1, "2026-07-19 05:07:47"],
    ["2026-07-04", 23856.22, 2, 9, 73.85, 1, 1, "2026-07-19 05:29:53"],
    ["2026-07-05", 25497.55, 2, 8, 76.29, 1, 1, "2026-07-19 05:50:23"],
    ["2026-07-06", 124652.17, 3, 11, 633.85, 1, 1, "2026-07-19 06:13:07"],
    ["2026-07-07", 108828.11, 3, 12, 80.14, 1, 2, "2026-07-19 02:07:41"],
    ["2026-07-08", 97785.17, 3, 12, 391.51, 1, 2, "2026-07-19 04:00:08"],
    ["2026-07-09", 112006.59, 3, 12, 501.04, 1, 2, "2026-07-19 04:20:10"],
    ["2026-07-10", 112675.15, 3, 13, 4093.25, 2, 4, "2026-07-19 04:41:00"],
    ["2026-07-11", 138696.23, 3, 12, 2315.70, 2, 4, "2026-07-19 04:59:57"],
    ["2026-07-12", 156567.02, 3, 12, 4369.04, 2, 4, "2026-07-19 05:19:02"],
    ["2026-07-13", 183229.83, 3, 13, 4239.96, 2, 4, "2026-07-19 05:40:58"],
    ["2026-07-14", 165194.14, 3, 14, 4405.05, 2, 4, "2026-07-19 05:59:10"],
    ["2026-07-15", 171355.82, 3, 14, 5374.77, 2, 4, "2026-07-19 06:18:44"],
    ["2026-07-16", 211942.11, 3, 16, 5641.04, 2, 4, "2026-07-19 06:38:34"],
].flatMap(([date, waterCost, waterAccounts, waterPlans, ampouleCost, ampouleAccounts, ampoulePlans, sourceUpdatedAt]) => ([
    {
        date: String(date), standardProductName: "水润面膜", qianchuanCostYuan: Number(waterCost),
        advertiserCount: Number(waterAccounts), planCount: Number(waterPlans),
        sourceUpdatedAt: String(sourceUpdatedAt), hasData: true, isComplete: true,
    },
    {
        date: String(date), standardProductName: "深海次抛精华", qianchuanCostYuan: Number(ampouleCost),
        advertiserCount: Number(ampouleAccounts), planCount: Number(ampoulePlans),
        sourceUpdatedAt: String(sourceUpdatedAt), hasData: true, isComplete: true,
    },
]));
exports.FALLBACK_DASHBOARD = {
    generatedAt: "2026-07-17T02:11:13.000Z",
    timezone: "Asia/Shanghai",
    sourceMode: "snapshot",
    trend: calibratedTrend,
    adSpendTrend: calibratedAdSpend,
    todayDoudian: {
        date: "2026-07-17", paidSalesYuan: 27224.23, paidOrderCount: 245, sourceUpdatedAt: "2026-07-17 10:11:13",
        latestWisPayTime: "2026-07-17 09:29:41", freshness: "fresh",
    },
    products: calibratedProducts,
    productTrends: calibratedProductTrends,
    productSpendTrend: calibratedProductSpend,
    productSpendCoverage: [],
    productSalesDate: "2026-07-16",
    productSalesTotalYuan: 772120.37,
    gmvTarget: FALLBACK_GMV_TARGET,
    nextRefresh: { dailyTrendAt: "2026-07-18T07:00:00+08:00", hourlyMetricsAt: "2026-07-17T15:00:00+08:00" },
    workflow: [
        { key: "analyst", label: "指标分析", status: "complete", detail: "有效成交额、订单去重和 WIS 品牌口径已定义" },
        { key: "schema", label: "Schema 探索", status: "complete", detail: "抖音订单宽表与状态字典已核对" },
        { key: "sql", label: "SQL 生成", status: "complete", detail: "4 组抖音生产 SQL 已生成" },
        { key: "review", label: "安全审核", status: "complete", detail: "只读与口径审核通过" },
        { key: "mcp", label: "MCP 执行验证", status: "complete", detail: "历史订单与 SKU 金额已逐日对平" },
    ],
    caveats: ["当前展示已验证快照；最近15个完整自然日将于每天07:00滚动更新。"],
};
