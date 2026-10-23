"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDashboard = getDashboard;
const cache_1 = require("./cache");
const dashboard_fallback_1 = require("../../../shared/dashboard.fallback");
const dashboard_types_1 = require("../../../shared/dashboard.types");
const metric_sql_1 = require("./metric-sql");
const mcp_1 = require("./mcp");
function shanghaiParts(date = new Date()) {
    const local = new Date(date.getTime() + 8 * 60 * 60 * 1000);
    return { year: local.getUTCFullYear(), month: local.getUTCMonth(), day: local.getUTCDate(), hour: local.getUTCHours() };
}
function boundaryIso(year, month, day, hour) {
    return new Date(Date.UTC(year, month, day, hour - 8, 0, 0)).toISOString();
}
function refreshBoundaries(now = new Date()) {
    const p = shanghaiParts(now);
    const nextHour = new Date(Date.UTC(p.year, p.month, p.day, p.hour + 1));
    const nextDaily = new Date(Date.UTC(p.year, p.month, p.day + (p.hour >= 7 ? 1 : 0), 7));
    return {
        hourly: boundaryIso(nextHour.getUTCFullYear(), nextHour.getUTCMonth(), nextHour.getUTCDate(), nextHour.getUTCHours()),
        daily: boundaryIso(nextDaily.getUTCFullYear(), nextDaily.getUTCMonth(), nextDaily.getUTCDate(), nextDaily.getUTCHours()),
    };
}
const GMV_TARGET_CONFIG = {
    brandTotalWan: 3297,
    products: [
        { name: "眼膜", targetWan: 1700, source: "eyeMaskSalesYuan" },
        { name: "水润面膜", targetWan: 1300, source: "waterMaskSalesYuan" },
        { name: "凝颜", targetWan: 120, source: "ningyanSalesYuan" },
    ],
};
function computeGmvTarget(monthToDate) {
    const [year, month] = monthToDate.monthStart.split("-").map(Number);
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const daysPassed = Math.max(monthToDate.completedDays, 0);
    const remainingDays = Math.max(daysInMonth - daysPassed, 0);
    const monthLabel = `${year}年${month}月`;
    const buildItem = (name, targetWan, completedWan) => {
        const progressPct = Math.min((completedWan / targetWan) * 100, 100);
        const dailyActualWan = completedWan / Math.max(daysPassed, 1);
        const dailyRequiredWan = remainingDays > 0 ? Math.max((targetWan - completedWan) / remainingDays, 0) : 0;
        const dailyGapWan = Math.max(dailyRequiredWan - dailyActualWan, 0);
        return { name, targetWan, completedWan, dailyActualWan, dailyRequiredWan, dailyGapWan, progressPct };
    };
    const productItems = GMV_TARGET_CONFIG.products.map((config) => buildItem(config.name, config.targetWan, monthToDate[config.source] / 10000));
    const brandTotal = buildItem("品牌总目标", GMV_TARGET_CONFIG.brandTotalWan, monthToDate.brandSalesYuan / 10000);
    return { monthLabel, throughDate: monthToDate.throughDate, brandTotal, products: productItems, remainingDays, daysPassed, daysInMonth };
}
function pastCompleteDates(days) {
    const p = shanghaiParts();
    const todayLocal = new Date(Date.UTC(p.year, p.month, p.day));
    return Array.from({ length: days }, (_, index) => {
        const d = new Date(todayLocal);
        d.setUTCDate(d.getUTCDate() - days + index);
        return d.toISOString().slice(0, 10);
    });
}
async function sqlFor(metricKey) {
    const stored = await (0, cache_1.readApprovedSql)(metricKey);
    return {
        sql: stored?.sql_text || metric_sql_1.reviewedSql[metricKey],
        workflow: stored ? JSON.parse(stored.workflow_json) : null,
        source: stored?.source || "reviewed-template",
    };
}
async function fetchTrend(force, expiresAt) {
    const key = "wis_doudian_effective_rolling_15d";
    if (!force) {
        const cached = await (0, cache_1.readCache)(key);
        if (cached)
            return { value: cached.payload, fromCache: true, workflow: null };
    }
    const config = await sqlFor(key);
    const result = await (0, mcp_1.executeSql)(config.sql, 100);
    const byDate = new Map(result.rows.map((row) => [row.pay_date, row]));
    const value = pastCompleteDates(15).map((date) => {
        const row = byDate.get(date);
        return { date, paidSalesYuan: Number(row?.effective_sales_yuan || 0), paidOrderCount: Number(row?.paid_order_count || 0), sourceUpdatedAt: row?.source_updated_at || null, hasData: Boolean(row) };
    });
    await (0, cache_1.writeCache)(key, value, expiresAt, config.source);
    return { value, fromCache: false, workflow: config.workflow };
}
async function fetchToday(force, expiresAt) {
    const key = "wis_doudian_effective_today";
    if (!force) {
        const cached = await (0, cache_1.readCache)(key);
        if (cached)
            return { value: cached.payload, fromCache: true, workflow: null };
    }
    const config = await sqlFor(key);
    const result = await (0, mcp_1.executeSql)(config.sql, 10);
    const row = result.rows[0];
    const today = row?.pay_date || new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const latestDate = row?.latest_wis_pay_time?.slice(0, 10) || null;
    const value = {
        date: today, paidSalesYuan: Number(row?.effective_sales_yuan || 0), paidOrderCount: Number(row?.paid_order_count || 0),
        sourceUpdatedAt: row?.source_updated_at || null, latestWisPayTime: row?.latest_wis_pay_time || null,
        freshness: !latestDate ? "no-data" : latestDate < today ? "stale" : "fresh",
    };
    await (0, cache_1.writeCache)(key, value, expiresAt, config.source);
    return { value, fromCache: false, workflow: config.workflow };
}
async function fetchGmvMonthToDate(force, expiresAt) {
    const key = "wis_doudian_effective_month_to_date";
    if (!force) {
        const cached = await (0, cache_1.readCache)(key);
        if (cached && Number.isFinite(cached.payload.completedDays)) {
            return { value: cached.payload, fromCache: true, workflow: null };
        }
    }
    const config = await sqlFor(key);
    const result = await (0, mcp_1.executeSql)(config.sql, 10);
    const row = result.rows[0];
    if (!row)
        throw new Error("本月累计有效成交额未返回数据");
    const value = {
        monthStart: row.month_start,
        throughDate: row.through_date || null,
        completedDays: Number(row.completed_days || 0),
        brandSalesYuan: Number(row.brand_sales_yuan || 0),
        eyeMaskSalesYuan: Number(row.eye_mask_sales_yuan || 0),
        waterMaskSalesYuan: Number(row.water_mask_sales_yuan || 0),
        ningyanSalesYuan: Number(row.ningyan_sales_yuan || 0),
        sourceUpdatedAt: row.source_updated_at || null,
    };
    await (0, cache_1.writeCache)(key, value, expiresAt, config.source);
    return { value, fromCache: false, workflow: config.workflow };
}
async function fetchAdSpend(force, expiresAt) {
    const key = "qianchuan_account_cost_rolling_15d";
    if (!force) {
        const cached = await (0, cache_1.readCache)(key);
        if (cached)
            return { value: cached.payload, fromCache: true, workflow: null };
    }
    const config = await sqlFor(key);
    const result = await (0, mcp_1.executeSql)(config.sql, 100);
    const byDate = new Map(result.rows.map((row) => [row.report_date, row]));
    const value = pastCompleteDates(15).map((date) => {
        const row = byDate.get(date);
        const rowCount = Number(row?.row_count || 0);
        const completeRowCount = Number(row?.complete_row_count || 0);
        return {
            date,
            qianchuanCostYuan: Number(row?.qianchuan_cost_yuan || 0),
            videoCostYuan: Number(row?.video_cost_yuan || 0),
            liveCostYuan: Number(row?.live_cost_yuan || 0),
            advertiserCount: Number(row?.advertiser_count || 0),
            completeRowCount,
            rowCount,
            sourceUpdatedAt: row?.source_updated_at || null,
            hasData: Boolean(row),
            isComplete: Boolean(row) && rowCount > 0 && completeRowCount === rowCount,
        };
    });
    await (0, cache_1.writeCache)(key, value, expiresAt, config.source);
    return { value, fromCache: false, workflow: config.workflow };
}
async function fetchProducts(metricKey, force, expiresAt) {
    const key = metricKey;
    if (!force) {
        const cached = await (0, cache_1.readCache)(key);
        if (cached)
            return { value: cached.payload, fromCache: true, workflow: null };
    }
    const config = await sqlFor(key);
    const result = await (0, mcp_1.executeSql)(config.sql, 2000);
    const value = result.rows.map((row) => ({
        date: row.pay_date,
        standardProductName: row.standard_product_name,
        paidSalesYuan: Number(row.effective_sales_yuan || 0),
        orderCount: Number(row.order_count || 0),
        productQuantity: Number(row.product_quantity || 0),
        productLinkCount: Number(row.product_link_count || 0),
        salesSharePct: Number(row.sales_share_pct || 0),
        sourceUpdatedAt: row.source_updated_at || null,
    }));
    await (0, cache_1.writeCache)(key, value, expiresAt, config.source);
    return { value, fromCache: false, workflow: config.workflow };
}
async function fetchProductSpend(metricKey, force, expiresAt) {
    const key = metricKey;
    if (!force) {
        const cached = await (0, cache_1.readCache)(key);
        if (cached)
            return { value: cached.payload, fromCache: true, workflow: null };
    }
    const config = await sqlFor(key);
    const result = await (0, mcp_1.executeSql)(config.sql, 50);
    const value = result.rows.map((row) => ({
        date: row.report_date,
        standardProductName: row.standard_product_name,
        qianchuanCostYuan: Number(row.qianchuan_cost_yuan || 0),
        advertiserCount: Number(row.advertiser_count || 0),
        planCount: Number(row.plan_count || 0),
        sourceUpdatedAt: row.source_updated_at || null,
        planVisibleCostYuan: Number(row.plan_visible_cost_yuan || 0),
        mappedCostYuan: Number(row.mapped_cost_yuan || 0),
        unmappedVisibleCostYuan: Number(row.unmapped_visible_cost_yuan || 0),
        brandCostYuan: row.brand_cost_yuan === null ? null : Number(row.brand_cost_yuan || 0),
        brandAdvertiserCount: Number(row.brand_advertiser_count || 0),
        brandCompleteCount: Number(row.brand_complete_count || 0),
        brandRowCount: Number(row.brand_row_count || 0),
        planAdvertiserCount: Number(row.plan_advertiser_count || 0),
        visiblePlanCount: Number(row.visible_plan_count || 0),
    }));
    await (0, cache_1.writeCache)(key, value, expiresAt, config.source);
    return { value, fromCache: false, workflow: config.workflow };
}
async function getDashboard(force = false) {
    const boundaries = refreshBoundaries();
    try {
        const [trend, today, adSpend, dailyProducts, gmvMonthToDate] = await Promise.all([
            fetchTrend(force, boundaries.daily),
            fetchToday(force, boundaries.hourly),
            fetchAdSpend(force, boundaries.daily),
            fetchProducts("wis_doudian_product_effective_daily", force, boundaries.daily),
            fetchGmvMonthToDate(force, boundaries.daily),
        ]);
        // 三段查询都使用互不重叠的日期窗口，可以并行执行，避免把数据库耗时串联到接口总耗时。
        const [productChunks, productSpendChunks] = await Promise.all([
            Promise.all([
                fetchProducts("wis_doudian_product_effective_rolling_15d_oldest", force, boundaries.daily),
                fetchProducts("wis_doudian_product_effective_rolling_15d_middle", force, boundaries.daily),
                fetchProducts("wis_doudian_product_effective_rolling_15d_latest", force, boundaries.daily),
            ]),
            Promise.all([
                fetchProductSpend("qianchuan_product_cost_rolling_15d_oldest", force, boundaries.daily),
                fetchProductSpend("qianchuan_product_cost_rolling_15d_middle", force, boundaries.daily),
                fetchProductSpend("qianchuan_product_cost_rolling_15d_latest", force, boundaries.daily),
            ]),
        ]);
        const productTrends = productChunks.flatMap((chunk) => chunk.value)
            .sort((a, b) => a.date.localeCompare(b.date) || b.paidSalesYuan - a.paidSalesYuan || a.standardProductName.localeCompare(b.standardProductName, "zh-CN"));
        const rawProductSpend = productSpendChunks.flatMap((chunk) => chunk.value);
        const productSpendByKey = new Map(rawProductSpend.map((item) => [`${item.date}|${item.standardProductName}`, item]));
        const rawCoverageByDate = new Map();
        rawProductSpend.forEach((item) => {
            if (!rawCoverageByDate.has(item.date))
                rawCoverageByDate.set(item.date, item);
        });
        const adSpendByDate = new Map(adSpend.value.map((item) => [item.date, item]));
        const productSpendCoverage = pastCompleteDates(15).map((date) => {
            const row = rawCoverageByDate.get(date);
            if (!row || row.brandCostYuan === null) {
                return {
                    date,
                    brandCostYuan: null,
                    planVisibleCostYuan: row?.planVisibleCostYuan || 0,
                    mappedCostYuan: row?.mappedCostYuan || 0,
                    unmappedVisibleCostYuan: row?.unmappedVisibleCostYuan || 0,
                    missingPlanCostYuan: null,
                    planCoveragePct: null,
                    mappedSharePct: null,
                    brandAdvertiserCount: row?.brandAdvertiserCount || 0,
                    brandCompleteCount: row?.brandCompleteCount || 0,
                    brandRowCount: row?.brandRowCount || 0,
                    planAdvertiserCount: row?.planAdvertiserCount || 0,
                    visiblePlanCount: row?.visiblePlanCount || 0,
                    sourceUpdatedAt: row?.sourceUpdatedAt || null,
                    state: "missing",
                };
            }
            const missingPlanCostYuan = Math.max(row.brandCostYuan - row.planVisibleCostYuan, 0);
            const planCoveragePct = row.brandCostYuan > 0 ? row.planVisibleCostYuan / row.brandCostYuan * 100 : null;
            const mappedSharePct = row.brandCostYuan > 0 ? row.mappedCostYuan / row.brandCostYuan * 100 : null;
            const brandComplete = row.brandRowCount > 0 && row.brandCompleteCount === row.brandRowCount;
            const reconciled = Math.abs(row.planVisibleCostYuan - row.mappedCostYuan - row.unmappedVisibleCostYuan) <= 0.02;
            const state = brandComplete && reconciled && (planCoveragePct || 0) >= 99.5 ? "complete" : "partial";
            return {
                date,
                brandCostYuan: row.brandCostYuan,
                planVisibleCostYuan: row.planVisibleCostYuan,
                mappedCostYuan: row.mappedCostYuan,
                unmappedVisibleCostYuan: row.unmappedVisibleCostYuan,
                missingPlanCostYuan,
                planCoveragePct,
                mappedSharePct,
                brandAdvertiserCount: row.brandAdvertiserCount,
                brandCompleteCount: row.brandCompleteCount,
                brandRowCount: row.brandRowCount,
                planAdvertiserCount: row.planAdvertiserCount,
                visiblePlanCount: row.visiblePlanCount,
                sourceUpdatedAt: row.sourceUpdatedAt,
                state,
            };
        });
        const productSpendCoverageByDate = new Map(productSpendCoverage.map((item) => [item.date, item]));
        const productSpendNames = [...dashboard_types_1.ATTRIBUTED_PRODUCT_NAMES];
        const productSpendTrend = pastCompleteDates(15).flatMap((date) => {
            const adDay = adSpendByDate.get(date);
            const coverage = productSpendCoverageByDate.get(date);
            const rows = productSpendNames.map((name) => productSpendByKey.get(`${date}|${name}`));
            const productSourceUpdatedAt = rows
                .map((item) => item?.sourceUpdatedAt)
                .filter((value) => Boolean(value))
                .sort()
                .at(-1) || null;
            const productSourceDate = productSourceUpdatedAt?.slice(0, 10) || null;
            const hasData = Boolean(adDay?.hasData && productSourceDate && productSourceDate > date && coverage?.state !== "missing");
            const isComplete = Boolean(hasData && adDay?.isComplete && coverage?.state === "complete");
            return productSpendNames.map((name, index) => {
                const row = rows[index];
                const qianchuanCostYuan = hasData ? row?.qianchuanCostYuan || 0 : 0;
                return {
                    date,
                    standardProductName: name,
                    qianchuanCostYuan,
                    advertiserCount: hasData ? row?.advertiserCount || 0 : 0,
                    planCount: hasData ? row?.planCount || 0 : 0,
                    sourceUpdatedAt: productSourceUpdatedAt || adDay?.sourceUpdatedAt || null,
                    hasData,
                    isComplete,
                };
            });
        });
        const allCached = trend.fromCache && today.fromCache && adSpend.fromCache && dailyProducts.fromCache && gmvMonthToDate.fromCache
            && productChunks.every((chunk) => chunk.fromCache) && productSpendChunks.every((chunk) => chunk.fromCache);
        const workflow = trend.workflow || today.workflow || adSpend.workflow || dailyProducts.workflow || gmvMonthToDate.workflow
            || productChunks.find((chunk) => chunk.workflow)?.workflow
            || productSpendChunks.find((chunk) => chunk.workflow)?.workflow
            || dashboard_fallback_1.FALLBACK_DASHBOARD.workflow;
        const productSalesDate = pastCompleteDates(1)[0];
        const products = dailyProducts.value
            .filter((item) => item.date === productSalesDate)
            .sort((a, b) => b.paidSalesYuan - a.paidSalesYuan || a.standardProductName.localeCompare(b.standardProductName, "zh-CN"));
        const caveats = [];
        const pendingProductSpendDate = pastCompleteDates(15)
            .slice()
            .reverse()
            .find((date) => productSpendCoverageByDate.get(date)?.state === "missing");
        if (pendingProductSpendDate) {
            caveats.unshift(`${pendingProductSpendDate} 单品千川计划明细尚未完成次日采集，当日仅展示有效成交额，不计算单品广告占比。`);
        }
        const partialProductSpend = productSpendCoverage.slice().reverse().find((item) => item.state === "partial");
        if (partialProductSpend) {
            caveats.unshift(`${partialProductSpend.date} 单品千川归因为部分覆盖：品牌消耗 ${partialProductSpend.brandCostYuan?.toFixed(2)} 元，计划明细 ${partialProductSpend.planVisibleCostYuan.toFixed(2)} 元（${partialProductSpend.planCoveragePct?.toFixed(2)}%），已映射 ${partialProductSpend.mappedCostYuan.toFixed(2)} 元（占品牌 ${partialProductSpend.mappedSharePct?.toFixed(2)}%）；未归因和计划缺口不补零。`);
        }
        const incompleteAdDay = adSpend.value.find((item) => item.hasData && !item.isComplete);
        const missingAdDay = adSpend.value.find((item) => !item.hasData);
        if (incompleteAdDay)
            caveats.unshift(`${incompleteAdDay.date} 千川消耗仅返回 ${incompleteAdDay.completeRowCount}/${incompleteAdDay.rowCount} 条完整账户记录，该日广告占比请谨慎使用。`);
        if (missingAdDay)
            caveats.unshift(`${missingAdDay.date} 千川消耗暂未返回，该日广告占比不展示。`);
        const salesByDate = new Map(trend.value.map((item) => [item.date, item.paidSalesYuan]));
        const overOneHundred = adSpend.value.find((item) => {
            const sales = salesByDate.get(item.date) || 0;
            return item.hasData && sales > 0 && item.qianchuanCostYuan / sales > 1;
        });
        if (overOneHundred) {
            const sales = salesByDate.get(overOneHundred.date) || 0;
            caveats.unshift(`${overOneHundred.date} 千川消耗高于当日有效成交额，广告占比为 ${(overOneHundred.qianchuanCostYuan / sales * 100).toFixed(2)}%；图表按真实值展示，请结合订单回传与消耗归属核查。`);
        }
        if (today.value.freshness !== "fresh")
            caveats.unshift(`抖店 WIS 最近支付数据停留在 ${today.value.latestWisPayTime || "未知"}，今日 0 暂按数据滞后处理。`);
        const gmvTarget = computeGmvTarget(gmvMonthToDate.value);
        return {
            generatedAt: new Date().toISOString(), timezone: "Asia/Shanghai", sourceMode: allCached ? "cache" : "live",
            trend: trend.value, adSpendTrend: adSpend.value, todayDoudian: today.value,
            products,
            productTrends,
            productSpendTrend,
            productSpendCoverage,
            productSalesDate,
            productSalesTotalYuan: products.reduce((sum, item) => sum + item.paidSalesYuan, 0),
            gmvTarget,
            nextRefresh: { dailyTrendAt: boundaries.daily, hourlyMetricsAt: boundaries.hourly }, workflow, caveats,
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "MCP 暂时不可用";
        return { ...dashboard_fallback_1.FALLBACK_DASHBOARD, generatedAt: new Date().toISOString(), sourceMode: "snapshot", caveats: [`实时刷新失败，当前展示最近一次已验证快照：${message}`, ...dashboard_fallback_1.FALLBACK_DASHBOARD.caveats] };
    }
}
