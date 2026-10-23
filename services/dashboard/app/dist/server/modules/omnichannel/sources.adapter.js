"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WechatPostgresAdapter = void 0;
exports.createAdapter = createAdapter;
exports.fetchChannelDaily = fetchChannelDaily;
exports.fetchTodayHourlyDouyin = fetchTodayHourlyDouyin;
exports.fetchHourlyDouyinGsv = fetchHourlyDouyinGsv;
exports.fetchHourlyDouyinSpend = fetchHourlyDouyinSpend;
const tslib_1 = require("tslib");
const common_1 = require("@nestjs/common");
const fullstack_nestjs_core_1 = require("@lark-apaas/fullstack-nestjs-core");
const schema_1 = require("../../database/schema");
const drizzle_orm_1 = require("drizzle-orm");
const mcp_1 = require("../dashboard/mcp");
const cockpit_service_1 = require("../dashboard/cockpit.service");
const dailyFetchRuntime = {
    cache: new Map(),
    inFlight: new Map(),
};
class DouyinSqlAdapter {
    async fetchDaily(startDate, endDate) {
        const dates = [];
        for (let cursor = new Date(`${startDate}T00:00:00Z`); cursor <= new Date(`${endDate}T00:00:00Z`); cursor.setUTCDate(cursor.getUTCDate() + 1)) {
            dates.push(cursor.toISOString().slice(0, 10));
        }
        // 复用抖音经营页已校验的口径，每次只读 15 天，并按区间顺序执行，避免
        // 多段订单扫描并发争抢根库连接。任何一段失败都抛错，绝不把缺失日期
        // 静默汇总为一个看似正常但偏小的渠道金额。
        const points = [];
        for (let index = 0; index < dates.length; index += 15) {
            const chunk = dates.slice(index, index + 15);
            const result = await (0, cockpit_service_1.getOperatingTrend)(chunk[0], chunk.at(-1));
            if (result.granularity !== "day" || result.items.length !== chunk.length) {
                throw new Error(`抖音经营日数据不完整：${chunk[0]}~${chunk.at(-1)}`);
            }
            points.push(...result.items);
        }
        return points.map((point) => {
            return {
                date: point.period,
                channel: "douyin",
                gmvYuan: point.gmvYuan,
                gsvYuan: point.gsvYuan,
                refundYuan: point.refundYuan,
                refundRatePct: point.refundRatePct,
                closedOrderCount: point.closedOrderCount,
                totalOrderCount: point.totalOrderCount,
                adCostYuan: point.qianchuanCostYuan,
                profitYuan: point.profitYuan,
                orderCount: point.orderCount,
                state: point.state,
                sourceUpdatedAt: null,
                sourceRecords: point.orderCount ?? 0,
            };
        });
    }
}
let WechatPostgresAdapter = class WechatPostgresAdapter {
    db;
    constructor(db) {
        this.db = db;
    }
    async fetchDaily(startDate, endDate) {
        const [sales, adqs] = await Promise.all([
            this.db
                .select({
                saleDate: schema_1.wechatDailySaleTable.saleDate,
                gsvAmount: schema_1.wechatDailySaleTable.gsvAmount,
                orderCount: schema_1.wechatDailySaleTable.orderCount,
                isPartial: schema_1.wechatDailySaleTable.isPartial,
                updatedAt: schema_1.wechatDailySaleTable.updatedAt,
            })
                .from(schema_1.wechatDailySaleTable)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.sql) `${schema_1.wechatDailySaleTable.saleDate} >= ${startDate}::date`, (0, drizzle_orm_1.sql) `${schema_1.wechatDailySaleTable.saleDate} <= ${endDate}::date`))
                .orderBy(schema_1.wechatDailySaleTable.saleDate),
            this.db
                .select({
                adqDate: schema_1.wechatDailyAdqTable.adqDate,
                spend: schema_1.wechatDailyAdqTable.spend,
                isPartial: schema_1.wechatDailyAdqTable.isPartial,
                updatedAt: schema_1.wechatDailyAdqTable.updatedAt,
            })
                .from(schema_1.wechatDailyAdqTable)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.sql) `${schema_1.wechatDailyAdqTable.adqDate} >= ${startDate}::date`, (0, drizzle_orm_1.sql) `${schema_1.wechatDailyAdqTable.adqDate} <= ${endDate}::date`)),
        ]);
        const adqByDate = new Map(adqs.map((row) => [String(row.adqDate), row]));
        return sales.map((row) => {
            const date = String(row.saleDate);
            const adq = adqByDate.get(date);
            const gsv = Number(row.gsvAmount || 0);
            const adCost = adq ? Number(adq.spend || 0) : null;
            const state = !adq
                ? "partial"
                : row.isPartial || adq.isPartial
                    ? "partial"
                    : "complete";
            return {
                date,
                channel: "wechat",
                gmvYuan: gsv,
                gsvYuan: gsv,
                refundYuan: null,
                refundRatePct: null,
                closedOrderCount: null,
                totalOrderCount: null,
                adCostYuan: adCost,
                profitYuan: null,
                orderCount: Number(row.orderCount || 0),
                state,
                sourceUpdatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
                sourceRecords: Number(row.orderCount || 0),
            };
        });
    }
};
exports.WechatPostgresAdapter = WechatPostgresAdapter;
exports.WechatPostgresAdapter = WechatPostgresAdapter = tslib_1.__decorate([
    (0, common_1.Injectable)(),
    tslib_1.__param(0, (0, common_1.Inject)(fullstack_nestjs_core_1.DRIZZLE_DATABASE)),
    tslib_1.__metadata("design:paramtypes", [Function])
], WechatPostgresAdapter);
class PendingAdapter {
    channel;
    constructor(channel) {
        this.channel = channel;
    }
    async fetchDaily() {
        return [];
    }
}
function createAdapter(channel, db) {
    switch (channel) {
        case "douyin":
            return new DouyinSqlAdapter();
        case "wechat":
            if (!db)
                throw new Error("DB required for wechat adapter");
            return new WechatPostgresAdapter(db);
        default:
            return new PendingAdapter(channel);
    }
}
/**
 * 总览与趋势可能同时请求完全相同的渠道区间；这里合并并发查询并短暂复用结果。
 * 返回副本，避免总览对“今日部分数据”的补充修改污染缓存或其他请求。
 */
async function fetchChannelDaily(channel, db, startDate, endDate) {
    const cacheKey = `${channel}:${startDate}:${endDate}`;
    const cached = dailyFetchRuntime.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.points.map((point) => ({ ...point }));
    }
    if (cached)
        dailyFetchRuntime.cache.delete(cacheKey);
    let pending = dailyFetchRuntime.inFlight.get(cacheKey);
    if (!pending) {
        pending = createAdapter(channel, db).fetchDaily(startDate, endDate)
            .then((points) => {
            const ttlMs = endDate === (0, cockpit_service_1.shanghaiTodayStr)() ? 30_000 : 30 * 60_000;
            if (dailyFetchRuntime.cache.size >= 100) {
                const oldestKey = dailyFetchRuntime.cache.keys().next().value;
                if (oldestKey)
                    dailyFetchRuntime.cache.delete(oldestKey);
            }
            dailyFetchRuntime.cache.set(cacheKey, { expiresAt: Date.now() + ttlMs, points });
            return points;
        })
            .finally(() => dailyFetchRuntime.inFlight.delete(cacheKey));
        dailyFetchRuntime.inFlight.set(cacheKey, pending);
    }
    const points = await pending;
    return points.map((point) => ({ ...point }));
}
async function fetchTodayHourlyDouyin() {
    const today = (0, cockpit_service_1.shanghaiTodayStr)();
    const [hourOrder, hourAd] = await Promise.allSettled([
        (0, mcp_1.executeCockpitSql)((0, cockpit_service_1.buildHourlyOrderSql)(today)),
        (0, mcp_1.executeCockpitSql)((0, cockpit_service_1.buildHourlyAdSql)(today)),
    ]);
    const orderRows = hourOrder.status === "fulfilled" ? hourOrder.value.rows : [];
    const adRows = hourAd.status === "fulfilled" ? hourAd.value.rows : [];
    return {
        costYuan: adRows.reduce((sum, row) => sum + Number(row.cost_yuan || 0), 0),
        gsvYuan: orderRows.reduce((sum, row) => sum + Number(row.gsv_yuan || 0), 0),
        gmvYuan: orderRows.reduce((sum, row) => sum + Number(row.gmv_yuan || 0), 0),
        orderCount: orderRows.reduce((sum, row) => sum + Number(row.order_count || 0), 0),
        hasData: orderRows.length > 0 || adRows.length > 0,
    };
}
async function fetchHourlyDouyinGsv(startDate, endDate) {
    const result = await (0, mcp_1.executeCockpitSql)((0, cockpit_service_1.buildHourlyOrderRangeSql)(startDate, endDate), 100);
    return result.rows.flatMap((row) => {
        const hour = Number(row.hour_no);
        if (!Number.isInteger(hour) || hour < 0 || hour > 23)
            return [];
        return [{
                date: String(row.pay_date),
                hour,
                gsvYuan: Number(row.gsv_yuan || 0),
                sourceUpdatedAt: row.source_updated_at ? String(row.source_updated_at) : null,
            }];
    });
}
async function fetchHourlyDouyinSpend(startDate, endDate) {
    const dates = [];
    for (let cursor = new Date(`${startDate}T00:00:00Z`); cursor <= new Date(`${endDate}T00:00:00Z`); cursor.setUTCDate(cursor.getUTCDate() + 1)) {
        dates.push(cursor.toISOString().slice(0, 10));
    }
    const results = await Promise.all(dates.map(async (date) => ({
        date,
        result: await (0, mcp_1.executeCockpitSql)((0, cockpit_service_1.buildHourlyAdSql)(date), 50),
    })));
    return results.flatMap(({ date, result }) => (result.rows.flatMap((row) => {
        const hour = Number(row.hour_no);
        if (!Number.isInteger(hour) || hour < 0 || hour > 23)
            return [];
        return [{
                date,
                hour,
                spendYuan: Number(row.cost_yuan || 0),
                sourceUpdatedAt: row.source_updated_at ? String(row.source_updated_at) : null,
            }];
    })));
}
