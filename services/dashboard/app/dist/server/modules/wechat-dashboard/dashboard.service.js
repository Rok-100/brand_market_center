"use strict";
var WechatDashboardService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.WechatDashboardService = void 0;
const tslib_1 = require("tslib");
const common_1 = require("@nestjs/common");
// 视频号看板均为固定只读 SQL：优先走数据库直连，未配置时保留 MCP 回退。
const mcp_1 = require("../dashboard/mcp");
const WECHAT_ROOT_DB = 'd_root_project_marketing_db';
const WECHAT_ORDER_ROOT_DB = 'd_root_project_order_db';
const WECHAT_SHOP_DAILY_TABLE = `${WECHAT_ROOT_DB}.wechat_shop_overall_daily_summary`;
const WECHAT_PRODUCT_DAILY_TABLE = `${WECHAT_ROOT_DB}.wechat_shop_product_daily_summary`;
const WECHAT_SHOP_PROMOTION_DAILY_TABLE = `${WECHAT_ROOT_DB}.wechat_shop_promotion_product_daily_performance`;
const HAITUN_LIVE_ACCOUNT_HOURLY_TABLE = `${WECHAT_ROOT_DB}.haitun_zhitou_live_account_hourly_summary`;
const HAITUN_SHORT_VIDEO_ACCOUNT_HOURLY_TABLE = `${WECHAT_ROOT_DB}.haitun_zhitou_short_video_account_hourly_summary`;
const WIS_WECHAT_SHOP_ID = 1179;
// 7/30 起视频号经营快照、订单日表与投放分项已经按同一口径校准。
const WECHAT_VERIFIED_FROM_DATE = '2026-07-30';
// 2026-08-08 verified against Haitun PRODUCT filters: this account carries WIS products;
// the other Haitun platform accounts carry KONO/IRY and 赫系, so they must not enter WIS spend.
const WIS_HAITUN_ACCOUNT_ID = '133536';
const WIS_ADQ_FILTER = "business_alias LIKE '%WIS%'";
const WECHAT_TARGET_MONTH = '2026-08';
const WECHAT_TARGET_MONTH_START = `${WECHAT_TARGET_MONTH}-01`;
const WECHAT_TARGET_MONTH_END = `${WECHAT_TARGET_MONTH}-31`;
const WECHAT_MONTH_TARGET_WAN = 5000;
const WECHAT_Q3_TARGET_WAN = 15000;
const WECHAT_Q3_PROFIT_TARGET_WAN = -400;
const WECHAT_Q3_PROFIT_MARGIN_TARGET_PCT = -8;
/**
 * 《WIS-视频号日报表》“利润额趋势图”里的逐日确认值。
 * 根数据仍是首选；这里仅在根数据缺失，或根数据总渠道费比明显偏离日报时校准。
 * 返回时同时保留 sourceMode/sourceNote/rawRootSpend，禁止静默替换。
 */
const WECHAT_KDOCS_DAILY_REFERENCE = {
    '2026-07-27': { gsvWan: 196, profitWan: -3.5, channelCostRatioPct: 56 },
    '2026-07-28': { gsvWan: 195, profitWan: -7.6, channelCostRatioPct: 58 },
    '2026-07-29': { gsvWan: 229, profitWan: -15.7, channelCostRatioPct: 62 },
    '2026-07-30': { gsvWan: 219, profitWan: -14.8, channelCostRatioPct: 62 },
    '2026-07-31': { gsvWan: 166, profitWan: -10.1, channelCostRatioPct: 60 },
    '2026-08-01': { gsvWan: 194, profitWan: -7.9, channelCostRatioPct: 59 },
    '2026-08-02': { gsvWan: 187, profitWan: -8.3, channelCostRatioPct: 59 },
    '2026-08-03': { gsvWan: 150, profitWan: -7.8, channelCostRatioPct: 59 },
    '2026-08-04': { gsvWan: 181, profitWan: -10.2, channelCostRatioPct: 60 },
    '2026-08-05': { gsvWan: 166, profitWan: -4.9, channelCostRatioPct: 57 },
    '2026-08-06': { gsvWan: 161, profitWan: 3.1, channelCostRatioPct: 52 },
    '2026-08-07': { gsvWan: 191, profitWan: -1.8, channelCostRatioPct: 55 },
    '2026-08-08': { gsvWan: 240, profitWan: -3.9, channelCostRatioPct: 57 },
    '2026-08-09': { gsvWan: 251, profitWan: -3.7, channelCostRatioPct: 56 },
    '2026-08-10': { gsvWan: 157, profitWan: -3.5, channelCostRatioPct: 56 },
    // 8/13–8/26由用户提供的《WIS视频号销售额&利润额&渠道费比（近15天）》
    // 截图逐日确认。营销库日汇总是次日快照，历史退款/取消回写后不会重算；
    // 因此这些日期展示日报确认值，同时保留根数据原值供核查。
    '2026-08-13': { gsvWan: 168, profitWan: -6.9, channelCostRatioPct: 58 },
    '2026-08-14': { gsvWan: 181, profitWan: -7.5, channelCostRatioPct: 59 },
    '2026-08-15': { gsvWan: 152, profitWan: -5.7, channelCostRatioPct: 58 },
    '2026-08-16': { gsvWan: 56, profitWan: -5.1, channelCostRatioPct: 59 },
    '2026-08-17': { gsvWan: 64, profitWan: -4.0, channelCostRatioPct: 57 },
    '2026-08-18': { gsvWan: 74, profitWan: -2.6, channelCostRatioPct: 55 },
    '2026-08-19': { gsvWan: 111, profitWan: -10.5, channelCostRatioPct: 63 },
    '2026-08-20': { gsvWan: 78, profitWan: -7.9, channelCostRatioPct: 62 },
    '2026-08-21': { gsvWan: 72, profitWan: -2.5, channelCostRatioPct: 55 },
    '2026-08-22': { gsvWan: 100, profitWan: -2.0, channelCostRatioPct: 55 },
    '2026-08-23': { gsvWan: 95, profitWan: 0.7, channelCostRatioPct: 52 },
    '2026-08-24': { gsvWan: 84, profitWan: -4.2, channelCostRatioPct: 57 },
    '2026-08-25': { gsvWan: 88, profitWan: 1.3, channelCostRatioPct: 51 },
    '2026-08-26': { gsvWan: 116, profitWan: -2.1, channelCostRatioPct: 55 },
};
const WECHAT_PROFIT_COST_MODEL_BY_MONTH = {
    // 《WIS-视频号日报表》2026年8月口径：变动（除投流）43.67%，
    // 固定（人工+公摊）34,298.07419元/日，渠道素材费用本月为0。
    '2026-08': {
        variableCostRatio: 0.4367,
        fixedDailyCostYuan: 34298.07419,
        channelMaterialDailyCostYuan: 0,
    },
};
const WECHAT_STANDARD_PRODUCT_ORDER = [
    '眼膜',
    '燕窝',
    '水润',
    '微针',
    '喷雾',
    '次抛',
    '美白针',
];
function wechatStandardProductCase(productNameExpression) {
    return `CASE
    WHEN ${productNameExpression} LIKE '%眼膜%'
      OR ${productNameExpression} LIKE '%眼霜%' THEN '眼膜'
    WHEN ${productNameExpression} LIKE '%燕窝%' THEN '燕窝'
    WHEN ${productNameExpression} LIKE '%隐形水润%'
      OR ${productNameExpression} LIKE '%水润面膜%' THEN '水润'
    WHEN ${productNameExpression} LIKE '%黑晶%'
      OR ${productNameExpression} LIKE '%微针%' THEN '微针'
    WHEN ${productNameExpression} LIKE '%喷雾%' THEN '喷雾'
    WHEN ${productNameExpression} LIKE '%次抛%' THEN '次抛'
    WHEN ${productNameExpression} LIKE '%美白%'
      OR ${productNameExpression} LIKE '%光感微珠%' THEN '美白针'
    ELSE NULL
  END`;
}
let WechatDashboardService = WechatDashboardService_1 = class WechatDashboardService {
    logger = new common_1.Logger(WechatDashboardService_1.name);
    shanghaiToday() {
        return new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Shanghai',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).format(new Date());
    }
    verifiedStart(value) {
        return value < WECHAT_VERIFIED_FROM_DATE ? WECHAT_VERIFIED_FROM_DATE : value;
    }
    offsetDate(value, days) {
        const date = new Date(`${value}T00:00:00Z`);
        date.setUTCDate(date.getUTCDate() + days);
        return date.toISOString().slice(0, 10);
    }
    monthStart(value) {
        return `${value.slice(0, 7)}-01`;
    }
    quarterStart(value) {
        const year = Number(value.slice(0, 4));
        const month = Number(value.slice(5, 7));
        const startMonth = Math.floor((month - 1) / 3) * 3 + 1;
        return `${year}-${String(startMonth).padStart(2, '0')}-01`;
    }
    validDate(value, fallback) {
        return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
    }
    number(value) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    calculateWechatProfit(date, revenueYuan, spendYuan, hasCompleteSpend, referenceProfitWan) {
        const model = WECHAT_PROFIT_COST_MODEL_BY_MONTH[date.slice(0, 7)];
        if (revenueYuan <= 0) {
            return { profitYuan: null, profitMarginPct: null };
        }
        if (!model) {
            if (referenceProfitWan === undefined) {
                return { profitYuan: null, profitMarginPct: null };
            }
            const profitYuan = referenceProfitWan * 10000;
            return {
                profitYuan,
                profitMarginPct: profitYuan / revenueYuan * 100,
                profitSourceMode: 'kdocs-daily-reference',
            };
        }
        if (!hasCompleteSpend) {
            return { profitYuan: null, profitMarginPct: null };
        }
        const profitYuan = revenueYuan * (1 - model.variableCostRatio)
            - spendYuan
            - model.fixedDailyCostYuan
            - model.channelMaterialDailyCostYuan;
        return {
            profitYuan,
            profitMarginPct: profitYuan / revenueYuan * 100,
            profitSourceMode: 'kdocs-cost-model',
        };
    }
    isoShanghai(value) {
        if (!value)
            return '';
        if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(value))
            return value;
        return `${value.replace(' ', 'T')}+08:00`;
    }
    dateRange(startDate, endDate) {
        const dates = [];
        for (let date = startDate; date <= endDate; date = this.offsetDate(date, 1)) {
            dates.push(date);
        }
        return dates;
    }
    /**
     * 将缺失日期压缩为连续时间段，避免生成很长的 OR 列表；每段都能使用
     * (shop_id, pay_time) 现有联合索引完成范围扫描。
     */
    buildMissingDatePredicate(column, missingDates) {
        const ranges = [];
        for (const date of missingDates) {
            const last = ranges[ranges.length - 1];
            if (last && this.offsetDate(last.end, 1) === date) {
                last.end = date;
            }
            else {
                ranges.push({ start: date, end: date });
            }
        }
        return ranges
            .map(({ start, end }) => `(${column} >= '${start} 00:00:00' AND ${column} < DATE_ADD('${end}', INTERVAL 1 DAY))`)
            .join(' OR ');
    }
    latestTimestamp(left, right) {
        if (!left)
            return right;
        if (!right)
            return left;
        return left >= right ? left : right;
    }
    async fetchShopDaily(startDate, endDate) {
        const summarySql = `
      SELECT
        stat_date,
        '23:59:59' AS collection_time,
        pay_gmv_yuan,
        pay_refund_gmv_yuan,
        pay_order_cnt,
        updated_at
      FROM ${WECHAT_SHOP_DAILY_TABLE} FORCE INDEX (idx_shop_date)
      WHERE shop_id = ${WIS_WECHAT_SHOP_ID}
        AND stat_date BETWEEN '${startDate}' AND '${endDate}'
      ORDER BY stat_date
    `;
        const summaryResult = await (0, mcp_1.executeCockpitSql)(summarySql, 100);
        const coveredDates = new Set(summaryResult.rows.map((row) => row.stat_date));
        const missingDates = this.dateRange(startDate, endDate).filter((date) => !coveredDates.has(date));
        if (!missingDates.length)
            return summaryResult.rows;
        const missingPredicate = this.buildMissingDatePredicate('pay_time', missingDates);
        const orderSql = `
      SELECT
        DATE(pay_time) AS stat_date,
        '00:00:00' AS collection_time,
        SUM(CASE WHEN order_status <> '250' THEN order_pay_amount ELSE 0 END) / 100.0 AS pay_gmv_yuan,
        SUM(CASE WHEN order_status = '200' THEN order_pay_amount ELSE 0 END) / 100.0 AS pay_refund_gmv_yuan,
        COUNT(CASE WHEN order_status NOT IN ('200', '250') THEN 1 END) AS pay_order_cnt,
        MAX(updated_at) AS updated_at
      FROM ${WECHAT_ORDER_ROOT_DB}.platform_order_item_api_field FORCE INDEX (idx_shop_pay_time)
      WHERE shop_id = ${WIS_WECHAT_SHOP_ID}
        AND (${missingPredicate})
      GROUP BY DATE(pay_time)
      ORDER BY stat_date
    `;
        const orderResult = await (0, mcp_1.executeCockpitSql)(orderSql, 100);
        return [...summaryResult.rows, ...orderResult.rows]
            .sort((left, right) => left.stat_date.localeCompare(right.stat_date));
    }
    async fetchTodayAdq(date) {
        const sql = `
      SELECT
        report_date,
        MAX(report_hour) AS latest_hour,
        COUNT(DISTINCT ad_account_id) AS account_count,
        SUM(cost_yuan) AS spend_yuan,
        SUM(order_net_amount_yuan) AS attributed_net_yuan,
        MAX(updated_at) AS updated_at
      FROM ${WECHAT_ROOT_DB}.adq_account_hourly_databoard
      WHERE report_date = '${date}'
        AND ${WIS_ADQ_FILTER}
      GROUP BY report_date
    `;
        const result = await (0, mcp_1.executeCockpitSql)(sql, 10);
        return result.rows[0] || null;
    }
    async getHeadlineMetrics(prefetchedGsv, prefetchedAdq) {
        try {
            const today = this.shanghaiToday();
            if (prefetchedGsv && prefetchedAdq) {
                const [gsvResponse, adqResponse, adqToday] = await Promise.all([
                    prefetchedGsv,
                    prefetchedAdq,
                    this.fetchTodayAdq(today),
                ]);
                const current = gsvResponse.items.find((item) => item.date === today) ?? null;
                const channelCostPoint = adqResponse.items.find((item) => item.date === today) ?? null;
                if (!current) {
                    return {
                        todayDate: today,
                        todayGmv: 0,
                        todayGsv: 0,
                        todayRefundAmount: 0,
                        todayRefundRate: 0,
                        todayOrderCount: 0,
                        todayAdSpend: null,
                        todayAdqSpend: null,
                        todayShopPromotionSpend: null,
                        todayCreatorCommissionSpend: null,
                        todayWechatBeanSpend: null,
                        todayAdShare: null,
                        todaySnapshotTime: '',
                        todayAdqSnapshotTime: '',
                        todayAdqLatestHour: null,
                        todayAdqAccountCount: 0,
                        sourceName: 'D计划根数据（经营快照 + ADQ + 小店投放 + 达人佣金 + 海豚智投微信豆）',
                        sourceStatus: 'missing',
                    };
                }
                const todayAdSpend = channelCostPoint?.hasSpendData ? channelCostPoint.spend : null;
                return {
                    todayDate: today,
                    todayGmv: current.gmv,
                    todayGsv: current.value,
                    todayRefundAmount: current.refundAmount,
                    todayRefundRate: current.refundRate,
                    todayOrderCount: current.orderCount,
                    todayAdSpend,
                    todayAdqSpend: channelCostPoint?.adqSpend ?? null,
                    todayShopPromotionSpend: channelCostPoint?.shopPromotionSpend ?? null,
                    todayCreatorCommissionSpend: channelCostPoint?.creatorCommissionSpend ?? null,
                    todayWechatBeanSpend: channelCostPoint?.wechatBeanSpend ?? null,
                    todayAdShare: todayAdSpend !== null && current.value > 0 ? todayAdSpend / current.value * 100 : null,
                    todaySnapshotTime: current.sourceUpdatedAt,
                    todayAdqSnapshotTime: adqToday?.updated_at
                        ? this.isoShanghai(adqToday.updated_at)
                        : channelCostPoint?.sourceUpdatedAt ?? '',
                    todayAdqLatestHour: adqToday?.latest_hour == null ? null : this.number(adqToday.latest_hour),
                    todayAdqAccountCount: this.number(adqToday?.account_count),
                    sourceName: 'D计划根数据（经营快照 + ADQ + 小店投放 + 达人佣金 + 海豚智投微信豆）',
                    sourceStatus: 'partial',
                };
            }
            // 首屏卡片只查询当天，避免被季度统计拖住。
            const [todayRows, adqToday, channelCostToday] = await Promise.all([
                this.fetchShopDaily(today, today),
                this.fetchTodayAdq(today),
                this.fetchAdqTrend(today, today),
            ]);
            const currentRow = todayRows.find((row) => row.stat_date === today) ?? null;
            if (!currentRow) {
                return {
                    todayDate: today,
                    todayGmv: 0,
                    todayGsv: 0,
                    todayRefundAmount: 0,
                    todayRefundRate: 0,
                    todayOrderCount: 0,
                    todayAdSpend: null,
                    todayAdqSpend: null,
                    todayShopPromotionSpend: null,
                    todayCreatorCommissionSpend: null,
                    todayWechatBeanSpend: null,
                    todayAdShare: null,
                    todaySnapshotTime: '',
                    todayAdqSnapshotTime: '',
                    todayAdqLatestHour: null,
                    todayAdqAccountCount: 0,
                    sourceName: 'D计划根数据（经营快照 + ADQ + 小店投放 + 达人佣金 + 海豚智投微信豆）',
                    sourceStatus: 'missing',
                };
            }
            const todayGmv = this.number(currentRow.pay_gmv_yuan);
            const todayRefundAmount = this.number(currentRow.pay_refund_gmv_yuan);
            const todayGsv = Math.max(todayGmv - todayRefundAmount, 0);
            const channelCostPoint = channelCostToday.find((item) => item.date === today) ?? null;
            const todayAdSpend = channelCostPoint?.hasSpendData ? channelCostPoint.spend : null;
            return {
                todayDate: today,
                todayGmv,
                todayGsv,
                todayRefundAmount,
                todayRefundRate: todayGmv > 0 ? todayRefundAmount / todayGmv * 100 : 0,
                todayOrderCount: this.number(currentRow.pay_order_cnt),
                todayAdSpend,
                todayAdqSpend: channelCostPoint?.adqSpend ?? null,
                todayShopPromotionSpend: channelCostPoint?.shopPromotionSpend ?? null,
                todayCreatorCommissionSpend: channelCostPoint?.creatorCommissionSpend ?? null,
                todayWechatBeanSpend: channelCostPoint?.wechatBeanSpend ?? null,
                todayAdShare: todayAdSpend !== null && todayGsv > 0 ? todayAdSpend / todayGsv * 100 : null,
                todaySnapshotTime: currentRow.updated_at ? this.isoShanghai(currentRow.updated_at) : '',
                todayAdqSnapshotTime: adqToday?.updated_at ? this.isoShanghai(adqToday.updated_at) : '',
                todayAdqLatestHour: adqToday?.latest_hour == null ? null : this.number(adqToday.latest_hour),
                todayAdqAccountCount: this.number(adqToday?.account_count),
                sourceName: 'D计划根数据（经营快照 + ADQ + 小店投放 + 达人佣金 + 海豚智投微信豆）',
                sourceStatus: 'partial',
            };
        }
        catch (error) {
            this.logger.error(`获取视频号首屏指标失败: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
    async getPerformanceMetrics(prefetchedRows) {
        try {
            const today = this.shanghaiToday();
            const monthTargetWan = WECHAT_MONTH_TARGET_WAN;
            const monthStart = this.monthStart(today);
            const quarterStart = this.quarterStart(today);
            const quarterRows = await (prefetchedRows ?? this.fetchShopDaily(this.verifiedStart(quarterStart), today));
            if (!quarterRows.length) {
                return {
                    gsv15d: 0,
                    monthGsv: 0,
                    quarterGsv: 0,
                    monthAvgDaily: 0,
                    monthTargetWan,
                    monthTargetPeriod: WECHAT_TARGET_MONTH,
                    monthTargetCompletedWan: 0,
                    monthTargetProgressPct: 0,
                    monthTargetRemainingWan: monthTargetWan,
                    quarterTargetWan: WECHAT_Q3_TARGET_WAN,
                    quarterTargetCompletedWan: 0,
                    quarterTargetProgressPct: 0,
                    quarterTargetRemainingWan: WECHAT_Q3_TARGET_WAN,
                    quarterProfitTargetWan: WECHAT_Q3_PROFIT_TARGET_WAN,
                    quarterProfitMarginTargetPct: WECHAT_Q3_PROFIT_MARGIN_TARGET_PCT,
                    targetObservedDays: 0,
                    targetPeriodLabel: '2026年Q3',
                    peakDay: '',
                    peakValue: 0,
                    lowestDay: '',
                    lowestValue: 0,
                    volatility: 0,
                    median: 0,
                    lastUpdateTime: '',
                    peakAlert: null,
                    sourceName: 'D计划根数据（经营快照 + 订单历史）',
                    sourceStatus: 'missing',
                };
            }
            const daily = quarterRows.map((row) => {
                const gmv = this.number(row.pay_gmv_yuan);
                const refund = this.number(row.pay_refund_gmv_yuan);
                const rawRootGsv = Math.max(gmv - refund, 0);
                const reference = WECHAT_KDOCS_DAILY_REFERENCE[row.stat_date];
                return {
                    date: row.stat_date,
                    gmv,
                    refund,
                    gsv: reference ? reference.gsvWan * 10000 : rawRootGsv,
                    orderCount: this.number(row.pay_order_cnt),
                    collectionTime: row.collection_time,
                    updatedAt: row.updated_at,
                };
            });
            const latest = daily[daily.length - 1];
            const monthDaily = daily.filter((row) => row.date >= monthStart);
            const targetMonthDaily = daily.filter((row) => row.date >= WECHAT_TARGET_MONTH_START && row.date <= WECHAT_TARGET_MONTH_END);
            const analysisDaily = monthDaily.length ? monthDaily : daily;
            const latestIsToday = latest.date === today;
            const last15Start = this.offsetDate(today, -14);
            const last15 = daily.filter((row) => row.date >= last15Start);
            const gsv15d = last15.reduce((sum, row) => sum + row.gsv, 0);
            const monthGsv = monthDaily.reduce((sum, row) => sum + row.gsv, 0);
            const quarterGsv = daily.reduce((sum, row) => sum + row.gsv, 0);
            const monthAvgDaily = monthGsv / Math.max(monthDaily.length, 1);
            const values = analysisDaily.map((row) => row.gsv).sort((a, b) => a - b);
            const mid = Math.floor(values.length / 2);
            const median = values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
            const peak = analysisDaily.reduce((best, row) => row.gsv > best.gsv ? row : best, analysisDaily[0]);
            const lowest = analysisDaily.reduce((best, row) => row.gsv < best.gsv ? row : best, analysisDaily[0]);
            const volatility = lowest.gsv > 0 ? peak.gsv / lowest.gsv : 0;
            const monthTargetCompletedWan = targetMonthDaily.reduce((sum, row) => sum + row.gsv, 0) / 10000;
            const quarterTargetCompletedWan = quarterGsv / 10000;
            return {
                gsv15d,
                monthGsv,
                quarterGsv,
                monthAvgDaily,
                monthTargetWan,
                monthTargetPeriod: WECHAT_TARGET_MONTH,
                monthTargetCompletedWan,
                monthTargetProgressPct: monthTargetWan > 0 ? monthTargetCompletedWan / monthTargetWan * 100 : 0,
                monthTargetRemainingWan: Math.max(monthTargetWan - monthTargetCompletedWan, 0),
                quarterTargetWan: WECHAT_Q3_TARGET_WAN,
                quarterTargetCompletedWan,
                quarterTargetProgressPct: WECHAT_Q3_TARGET_WAN > 0 ? quarterTargetCompletedWan / WECHAT_Q3_TARGET_WAN * 100 : 0,
                quarterTargetRemainingWan: Math.max(WECHAT_Q3_TARGET_WAN - quarterTargetCompletedWan, 0),
                quarterProfitTargetWan: WECHAT_Q3_PROFIT_TARGET_WAN,
                quarterProfitMarginTargetPct: WECHAT_Q3_PROFIT_MARGIN_TARGET_PCT,
                targetObservedDays: targetMonthDaily.length,
                targetPeriodLabel: '2026年Q3',
                peakDay: peak.date,
                peakValue: peak.gsv,
                lowestDay: lowest.date,
                lowestValue: lowest.gsv,
                volatility,
                median,
                lastUpdateTime: this.isoShanghai(latest.updatedAt),
                peakAlert: peak.gsv > 1_000_000
                    ? {
                        date: peak.date,
                        value: peak.gsv,
                        message: `单日有效成交额 ${peak.gsv.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}元 为本月峰值，建议复盘当日直播排期与广告投放节奏。`,
                    }
                    : null,
                sourceName: 'D计划根数据（经营快照 + 订单历史）',
                sourceStatus: latestIsToday ? 'partial' : 'complete',
            };
        }
        catch (error) {
            this.logger.error(`获取视频号目标与统计指标失败: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
    async getMetrics() {
        const [headline, performance] = await Promise.all([
            this.getHeadlineMetrics(),
            this.getPerformanceMetrics(),
        ]);
        return { ...headline, ...performance };
    }
    async getDailyGsv(startDate, endDate, prefetchedRows) {
        try {
            const today = this.shanghaiToday();
            const end = this.validDate(endDate, today);
            const start = this.validDate(startDate, this.offsetDate(end, -14));
            if (end < start)
                return { items: [], total: 0 };
            const rootStart = this.verifiedStart(start);
            const rows = end >= rootStart
                ? prefetchedRows
                    ? (await prefetchedRows).filter((row) => row.stat_date >= rootStart && row.stat_date <= end)
                    : await this.fetchShopDaily(rootStart, end)
                : [];
            const rootItems = rows.map((row) => {
                const gmv = this.number(row.pay_gmv_yuan);
                const refundAmount = this.number(row.pay_refund_gmv_yuan);
                const rawRootValue = Math.max(gmv - refundAmount, 0);
                const reference = WECHAT_KDOCS_DAILY_REFERENCE[row.stat_date];
                const value = reference ? reference.gsvWan * 10000 : rawRootValue;
                return {
                    date: row.stat_date,
                    value,
                    gmv,
                    refundAmount,
                    refundRate: gmv > 0 ? refundAmount / gmv * 100 : 0,
                    orderCount: this.number(row.pay_order_cnt),
                    sourceUpdatedAt: this.isoShanghai(row.updated_at),
                    isPartial: row.stat_date === today,
                    sourceMode: reference ? 'kdocs-calibrated' : 'root',
                    sourceNote: reference
                        ? `营销库次日快照为 ${(rawRootValue / 10000).toFixed(1)}万；历史订单状态后续回写未同步重算，展示值按《WIS-视频号日报表》校准为 ${reference.gsvWan}万。`
                        : undefined,
                    rawRootValue,
                };
            });
            const rootByDate = new Map(rootItems.map((item) => [item.date, item]));
            const items = this.dateRange(start, end).flatMap((date) => {
                const rootItem = rootByDate.get(date);
                if (rootItem)
                    return [rootItem];
                const reference = WECHAT_KDOCS_DAILY_REFERENCE[date];
                if (!reference)
                    return [];
                return [{
                        date,
                        value: reference.gsvWan * 10000,
                        gmv: reference.gsvWan * 10000,
                        refundAmount: 0,
                        refundRate: 0,
                        orderCount: 0,
                        sourceUpdatedAt: '',
                        isPartial: false,
                        sourceMode: 'kdocs-fallback',
                        sourceNote: '根数据缺失，使用《WIS-视频号日报表》对应日期GSV；退款与订单数未由日报拆分。',
                        rawRootValue: null,
                    }];
            });
            return { items, total: items.length };
        }
        catch (error) {
            this.logger.error(`获取视频号每日GSV根数据失败: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
    async getHourlyGsv(startDate, endDate) {
        const today = this.shanghaiToday();
        const end = this.validDate(endDate, today);
        const start = this.validDate(startDate, this.offsetDate(end, -1));
        if (end < start)
            return [];
        const sql = `
      SELECT
        DATE(o.pay_time) AS pay_date,
        HOUR(o.pay_time) AS hour_no,
        SUM(CASE WHEN o.order_status NOT IN ('200', '250') THEN o.order_pay_amount ELSE 0 END) / 100.0 AS gsv_yuan,
        MAX(o.updated_at) AS source_updated_at
      FROM ${WECHAT_ORDER_ROOT_DB}.platform_order_item_api_field o FORCE INDEX (idx_shop_pay_time)
      WHERE o.shop_id = ${WIS_WECHAT_SHOP_ID}
        AND o.pay_time >= '${start} 00:00:00'
        AND o.pay_time < DATE_ADD('${end}', INTERVAL 1 DAY)
      GROUP BY DATE(o.pay_time), HOUR(o.pay_time)
      ORDER BY pay_date, hour_no
    `;
        const result = await (0, mcp_1.executeCockpitSql)(sql, 100);
        return result.rows.flatMap((row) => {
            const hour = Number(row.hour_no);
            if (!Number.isInteger(hour) || hour < 0 || hour > 23)
                return [];
            return [{
                    date: String(row.pay_date),
                    hour,
                    gsvYuan: this.number(row.gsv_yuan),
                    sourceUpdatedAt: row.source_updated_at ? this.isoShanghai(String(row.source_updated_at)) : null,
                }];
        });
    }
    async fetchAdqTrend(start, end) {
        // Root MySQL has a per-query inactivity timeout. Keeping five independent,
        // index-friendly aggregates avoids one large CTE plan scanning every source
        // at once and lets a missing component remain explicitly partial.
        const adqSql = `
      SELECT
        report_date AS stat_date,
        SUM(cost_yuan) AS adq_spend_yuan,
        SUM(order_net_amount_yuan) AS attributed_net_yuan,
        MAX(updated_at) AS updated_at
      FROM ${WECHAT_ROOT_DB}.adq_account_daily_databoard
      WHERE report_date BETWEEN '${start}' AND '${end}'
        AND report_date < CURRENT_DATE
        AND ${WIS_ADQ_FILTER}
      GROUP BY report_date
      UNION ALL
      SELECT
        report_date AS stat_date,
        SUM(cost_yuan) AS adq_spend_yuan,
        SUM(order_net_amount_yuan) AS attributed_net_yuan,
        MAX(updated_at) AS updated_at
      FROM ${WECHAT_ROOT_DB}.adq_account_hourly_databoard
      WHERE report_date BETWEEN '${start}' AND '${end}'
        AND report_date = CURRENT_DATE
        AND ${WIS_ADQ_FILTER}
      GROUP BY report_date
    `;
        const shopPromotionSql = `
      SELECT
        stat_date,
        SUM(cost_yuan) AS shop_promotion_spend_yuan,
        MAX(updated_at) AS updated_at
      FROM ${WECHAT_SHOP_PROMOTION_DAILY_TABLE} FORCE INDEX (idx_shop_date)
      WHERE shop_id = ${WIS_WECHAT_SHOP_ID}
        AND stat_date BETWEEN '${start}' AND '${end}'
      GROUP BY stat_date
    `;
        const creatorCommissionSql = `
      SELECT /*+ MAX_EXECUTION_TIME(4000) */
        DATE(pay_time) AS stat_date,
        SUM(COALESCE(promotion_commission_amount, 0)) / 100.0 AS creator_commission_spend_yuan,
        MAX(updated_at) AS updated_at
      FROM ${WECHAT_ORDER_ROOT_DB}.platform_order_item_api_field FORCE INDEX (idx_shop_pay_time)
      WHERE shop_id = ${WIS_WECHAT_SHOP_ID}
        AND pay_time >= '${start} 00:00:00'
        AND pay_time < DATE_ADD('${end}', INTERVAL 1 DAY)
        AND order_status NOT IN ('200', '250')
      GROUP BY DATE(pay_time)
    `;
        const haitunLiveSql = `
      WITH ranked AS (
        SELECT
          stat_date,
          cumulative_cost_yuan,
          updated_at,
          ROW_NUMBER() OVER (
            PARTITION BY stat_date, platform_account_id, live_scene_code
            ORDER BY collection_time DESC, updated_at DESC, id DESC
          ) AS rn
        FROM ${HAITUN_LIVE_ACCOUNT_HOURLY_TABLE}
        WHERE stat_date BETWEEN '${start}' AND '${end}'
          AND platform_account_id = '${WIS_HAITUN_ACCOUNT_ID}'
      )
      SELECT
        stat_date,
        SUM(cumulative_cost_yuan) AS spend_yuan,
        MAX(updated_at) AS updated_at
      FROM ranked
      WHERE rn = 1
      GROUP BY stat_date
    `;
        const haitunShortSql = `
      WITH ranked AS (
        SELECT
          stat_date,
          cumulative_cost_yuan,
          updated_at,
          ROW_NUMBER() OVER (
            PARTITION BY stat_date, platform_account_id, filter_type, filter_id
            ORDER BY collection_time DESC, updated_at DESC, id DESC
          ) AS rn
        FROM ${HAITUN_SHORT_VIDEO_ACCOUNT_HOURLY_TABLE}
        WHERE stat_date BETWEEN '${start}' AND '${end}'
          AND platform_account_id = '${WIS_HAITUN_ACCOUNT_ID}'
          AND filter_type = 'ALL'
      )
      SELECT
        stat_date,
        SUM(cumulative_cost_yuan) AS spend_yuan,
        MAX(updated_at) AS updated_at
      FROM ranked
      WHERE rn = 1
      GROUP BY stat_date
    `;
        const readComponent = async (label, sql) => {
            try {
                return (await (0, mcp_1.executeCockpitSql)(sql, 100)).rows;
            }
            catch (error) {
                this.logger.warn(`${label}根数据暂未返回，按缺失分项展示: ${error instanceof Error ? error.message : String(error)}`);
                return [];
            }
        };
        // Run sequentially: the shared root database is more stable than competing
        // quarter/order/product scans, while each result is cached at the controller.
        const adqRows = await readComponent('视频号ADQ', adqSql);
        const shopPromotionRows = await readComponent('视频号小店投放', shopPromotionSql);
        const creatorCommissionRows = await readComponent('视频号达人佣金', creatorCommissionSql);
        const haitunLiveRows = await readComponent('视频号海豚直播', haitunLiveSql);
        const haitunShortRows = await readComponent('视频号海豚短视频', haitunShortSql);
        const adqByDate = new Map(adqRows.map((row) => [row.stat_date, row]));
        const shopPromotionByDate = new Map(shopPromotionRows.map((row) => [row.stat_date, row]));
        const creatorCommissionByDate = new Map(creatorCommissionRows.map((row) => [row.stat_date, row]));
        const haitunLiveByDate = new Map(haitunLiveRows.map((row) => [row.stat_date, row]));
        const haitunShortByDate = new Map(haitunShortRows.map((row) => [row.stat_date, row]));
        const dates = [...new Set([
                ...adqByDate.keys(),
                ...shopPromotionByDate.keys(),
                ...creatorCommissionByDate.keys(),
                ...haitunLiveByDate.keys(),
                ...haitunShortByDate.keys(),
            ])].sort();
        const channelCostRows = dates.map((statDate) => {
            const adq = adqByDate.get(statDate);
            const shopPromotion = shopPromotionByDate.get(statDate);
            const creatorCommission = creatorCommissionByDate.get(statDate);
            const haitunLive = haitunLiveByDate.get(statDate);
            const haitunShort = haitunShortByDate.get(statDate);
            const hasWechatBeanData = Boolean(haitunLive && haitunShort);
            const wechatBeanSpend = hasWechatBeanData
                ? this.number(haitunLive?.spend_yuan) + this.number(haitunShort?.spend_yuan)
                : null;
            const updatedAt = [
                adq?.updated_at,
                shopPromotion?.updated_at,
                creatorCommission?.updated_at,
                haitunLive?.updated_at,
                haitunShort?.updated_at,
            ].filter((value) => Boolean(value)).sort().at(-1) ?? null;
            return {
                stat_date: statDate,
                adq_spend_yuan: adq?.adq_spend_yuan ?? null,
                shop_promotion_spend_yuan: shopPromotion?.shop_promotion_spend_yuan ?? null,
                creator_commission_spend_yuan: creatorCommission?.creator_commission_spend_yuan ?? null,
                wechat_bean_spend_yuan: wechatBeanSpend,
                spend_yuan: this.number(adq?.adq_spend_yuan)
                    + this.number(shopPromotion?.shop_promotion_spend_yuan)
                    + this.number(creatorCommission?.creator_commission_spend_yuan)
                    + this.number(wechatBeanSpend),
                attributed_net_yuan: adq?.attributed_net_yuan ?? null,
                has_adq_data: adq ? 1 : 0,
                has_shop_promotion_data: shopPromotion ? 1 : 0,
                has_commission_data: creatorCommission ? 1 : 0,
                has_wechat_bean_data: hasWechatBeanData ? 1 : 0,
                updated_at: updatedAt,
            };
        });
        const today = this.shanghaiToday();
        return channelCostRows.map((row) => {
            const hasAdqData = Boolean(this.number(row.has_adq_data));
            const hasShopPromotionData = Boolean(this.number(row.has_shop_promotion_data));
            const hasCommissionData = Boolean(this.number(row.has_commission_data));
            const hasWechatBeanData = Boolean(this.number(row.has_wechat_bean_data));
            const adqSpend = hasAdqData ? this.number(row.adq_spend_yuan) : null;
            const shopPromotionSpend = hasShopPromotionData ? this.number(row.shop_promotion_spend_yuan) : null;
            const creatorCommissionSpend = hasCommissionData ? this.number(row.creator_commission_spend_yuan) : null;
            const wechatBeanSpend = hasWechatBeanData ? this.number(row.wechat_bean_spend_yuan) : null;
            const spend = this.number(row.spend_yuan);
            const attributedRevenue = this.number(row.attributed_net_yuan);
            const hasSpendData = hasAdqData
                || hasShopPromotionData
                || hasCommissionData
                || hasWechatBeanData;
            const missingCostComponents = [];
            if (!hasAdqData)
                missingCostComponents.push('adq');
            if (!hasShopPromotionData)
                missingCostComponents.push('shopPromotion');
            if (!hasCommissionData)
                missingCostComponents.push('creatorCommission');
            if (!hasWechatBeanData)
                missingCostComponents.push('wechatBean');
            return {
                date: row.stat_date,
                spend,
                adqSpend,
                adqRevenue: hasAdqData ? attributedRevenue : null,
                adqSpendRatio: hasAdqData && attributedRevenue > 0 && adqSpend !== null
                    ? adqSpend / attributedRevenue * 100
                    : null,
                shopPromotionSpend,
                creatorCommissionSpend,
                wechatBeanSpend,
                revenue: attributedRevenue,
                spendRatio: attributedRevenue > 0 && adqSpend !== null ? adqSpend / attributedRevenue * 100 : 0,
                profitYuan: null,
                profitMarginPct: null,
                isPartial: row.stat_date === today,
                hasSpendData,
                costCoverageStatus: missingCostComponents.length === 0 ? 'complete' : 'partial',
                missingCostComponents,
                sourceUpdatedAt: this.isoShanghai(row.updated_at),
            };
        });
    }
    async getDailyAdq(startDate, endDate, prefetchedGsv) {
        try {
            const today = this.shanghaiToday();
            const end = this.validDate(endDate, today);
            // 首页经营图按15天展示，需要同步返回同窗口的ADQ消耗；
            // 独立的近7天ADQ图由前端截取最后7个自然日。
            const start = this.validDate(startDate, this.offsetDate(end, -14));
            if (end < start)
                return { items: [], total: 0 };
            const rootStart = this.verifiedStart(start);
            const [costItems, gsvResponse] = await Promise.all([
                end >= rootStart ? this.fetchAdqTrend(rootStart, end) : Promise.resolve([]),
                prefetchedGsv ?? this.getDailyGsv(start, end),
            ]);
            const gsvByDate = new Map(gsvResponse.items.map((item) => [item.date, item.value]));
            const costByDate = new Map(costItems.map((item) => [item.date, item]));
            const items = this.dateRange(start, end).flatMap((date) => {
                const item = costByDate.get(date);
                const gsv = gsvByDate.get(date);
                const reference = WECHAT_KDOCS_DAILY_REFERENCE[date];
                // 成交源缺失时不能把分母补成0，也不能继续计算广告占比或利润。
                if (gsv === undefined)
                    return [];
                if (!item && reference && gsv > 0) {
                    const calibratedSpend = gsv * reference.channelCostRatioPct / 100;
                    const profit = this.calculateWechatProfit(date, gsv, calibratedSpend, true, reference.profitWan);
                    return [{
                            date,
                            spend: calibratedSpend,
                            adqSpend: null,
                            adqRevenue: null,
                            adqSpendRatio: null,
                            shopPromotionSpend: null,
                            creatorCommissionSpend: null,
                            wechatBeanSpend: null,
                            revenue: gsv,
                            spendRatio: reference.channelCostRatioPct,
                            ...profit,
                            isPartial: false,
                            hasSpendData: true,
                            costCoverageStatus: 'partial',
                            missingCostComponents: ['adq', 'shopPromotion', 'creatorCommission', 'wechatBean'],
                            sourceUpdatedAt: '',
                            sourceMode: 'kdocs-fallback',
                            sourceNote: '根数据缺失，按《WIS-视频号日报表》对应日期渠道费比与GSV反算总渠道费用；分项保持待返回。',
                            rawRootSpend: null,
                            rawRootSpendRatio: null,
                        }];
                }
                if (!item)
                    return [];
                const rawRootSpendRatio = gsv > 0 && item.hasSpendData ? item.spend / gsv * 100 : null;
                const shouldCalibrate = Boolean(reference
                    && gsv > 0
                    && rawRootSpendRatio !== null);
                const spend = shouldCalibrate && reference
                    ? gsv * reference.channelCostRatioPct / 100
                    : item.spend;
                const hasCompleteSpend = shouldCalibrate || item.costCoverageStatus === 'complete';
                const profit = this.calculateWechatProfit(date, gsv, spend, hasCompleteSpend, reference?.profitWan);
                return [{
                        ...item,
                        spend,
                        revenue: gsv,
                        spendRatio: shouldCalibrate && reference
                            ? reference.channelCostRatioPct
                            : (rawRootSpendRatio ?? 0),
                        ...profit,
                        sourceMode: shouldCalibrate ? 'kdocs-calibrated' : 'root',
                        sourceNote: shouldCalibrate
                            ? `根数据总消耗对应广告占比 ${rawRootSpendRatio?.toFixed(1)}%；展示值按《WIS-视频号日报表》确认的 ${reference?.channelCostRatioPct}% 校准，根数据分项保留供核查。`
                            : undefined,
                        rawRootSpend: item.spend,
                        rawRootSpendRatio,
                    }];
            });
            return { items, total: items.length };
        }
        catch (error) {
            this.logger.error(`获取视频号ADQ根数据失败: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
    buildAdqMetrics(rows) {
        const current = rows.slice(-7);
        const previous = rows.slice(-14, -7);
        const currentSpend = current.reduce((sum, row) => sum + (row.adqSpend ?? 0), 0);
        const currentRevenue = current.reduce((sum, row) => sum + (row.adqRevenue ?? 0), 0);
        const previousSpend = previous.reduce((sum, row) => sum + (row.adqSpend ?? 0), 0);
        const previousRevenue = previous.reduce((sum, row) => sum + (row.adqRevenue ?? 0), 0);
        return {
            spend7d: currentSpend,
            revenue7d: currentRevenue,
            avgRatio7d: currentRevenue > 0 ? currentSpend / currentRevenue * 100 : 0,
            spendTrend: previousSpend > 0 ? (currentSpend - previousSpend) / previousSpend * 100 : 0,
            revenueTrend: previousRevenue > 0 ? (currentRevenue - previousRevenue) / previousRevenue * 100 : 0,
        };
    }
    async getAdqMetrics() {
        try {
            const today = this.shanghaiToday();
            const rows = (await this.getDailyAdq(this.offsetDate(today, -13), today)).items;
            return this.buildAdqMetrics(rows);
        }
        catch (error) {
            this.logger.error(`获取视频号ADQ汇总根数据失败: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
    async getOverview() {
        const today = this.shanghaiToday();
        const quarterRows = await this.fetchShopDaily(this.verifiedStart(this.quarterStart(today)), today);
        const dailyGsv = await this.getDailyGsv(undefined, undefined, Promise.resolve(quarterRows));
        const dailyAdq = await this.getDailyAdq(undefined, undefined, Promise.resolve(dailyGsv));
        const [headline, performance] = await Promise.all([
            this.getHeadlineMetrics(Promise.resolve(dailyGsv), Promise.resolve(dailyAdq)),
            this.getPerformanceMetrics(Promise.resolve(quarterRows)),
        ]);
        return {
            headline,
            performance,
            dailyGsv,
            dailyAdq,
            adqMetrics: this.buildAdqMetrics(dailyAdq.items),
        };
    }
    async getProductTrends(startDate, endDate) {
        try {
            const today = this.shanghaiToday();
            const end = this.validDate(endDate, today);
            const start = this.verifiedStart(this.validDate(startDate, this.offsetDate(end, -14)));
            if (end < start) {
                return {
                    items: [],
                    dates: [],
                    sourceStatus: 'missing',
                    missingDates: [],
                    latestAvailableDate: null,
                };
            }
            const dates = this.dateRange(start, end);
            const summarySql = `
        WITH categorized AS (
          SELECT
            stat_date,
            ${wechatStandardProductCase('product_name')} AS standard_product,
            GREATEST(
              COALESCE(pay_gmv_yuan, 0) - COALESCE(pay_refund_gmv_yuan, 0),
              0
            ) AS gsv_yuan
          FROM ${WECHAT_PRODUCT_DAILY_TABLE} FORCE INDEX (idx_shop_date)
          WHERE shop_id = ${WIS_WECHAT_SHOP_ID}
            AND stat_date BETWEEN '${start}' AND '${end}'
        )
        SELECT /*+ MAX_EXECUTION_TIME(8000) */
          stat_date,
          CONCAT('standard:', standard_product) AS product_id,
          standard_product AS product_name,
          SUM(gsv_yuan) AS gsv_yuan
        FROM categorized
        WHERE standard_product IS NOT NULL
        GROUP BY stat_date, standard_product
        HAVING SUM(gsv_yuan) > 0
        ORDER BY stat_date, standard_product
      `;
            // 平台存在大量同品不同链接；必须先归并到已确认的七个标准单品，不能按商品ID取前八。
            const summaryResult = await (0, mcp_1.executeCockpitSql)(summarySql, 10_000);
            const coveredDates = new Set(summaryResult.rows.map((row) => row.stat_date));
            const missingDates = dates.filter((date) => !coveredDates.has(date));
            // 单品趋势只接受已归并的商品日汇总。缺失日期保留空值并显式返回，
            // 不再临时扫描订单 JSON：该回退既慢，也会把不同更新时点的口径混在一起。
            const combinedRows = summaryResult.rows;
            const productTotals = new Map();
            for (const row of combinedRows) {
                const current = productTotals.get(row.product_id);
                const productName = row.product_name || `商品 ${row.product_id}`;
                productTotals.set(row.product_id, {
                    productName: current && current.productName > productName ? current.productName : productName,
                    total: (current?.total ?? 0) + this.number(row.gsv_yuan),
                });
            }
            const standardOrder = new Map(WECHAT_STANDARD_PRODUCT_ORDER.map((productName, index) => [productName, index]));
            const topProducts = [...productTotals.entries()]
                .sort((left, right) => ((standardOrder.get(left[1].productName) ?? Number.MAX_SAFE_INTEGER)
                - (standardOrder.get(right[1].productName) ?? Number.MAX_SAFE_INTEGER)));
            const topProductIds = new Set(topProducts.map(([productId]) => productId));
            const filteredRows = combinedRows.filter((row) => topProductIds.has(row.product_id));
            const grouped = new Map();
            for (const [productId, product] of topProducts) {
                grouped.set(productId, {
                    productId,
                    productName: product.productName,
                    data: dates.map((date) => ({ date, salesAmount: null })),
                });
            }
            for (const row of filteredRows) {
                const item = grouped.get(row.product_id);
                const point = item.data.find((entry) => entry.date === row.stat_date);
                if (point)
                    point.salesAmount = this.number(row.gsv_yuan);
            }
            const latestAvailableDate = [...coveredDates].sort().at(-1) ?? null;
            return {
                items: [...grouped.values()],
                dates,
                sourceStatus: coveredDates.size === 0 ? 'missing' : missingDates.length ? 'partial' : 'complete',
                missingDates,
                latestAvailableDate,
            };
        }
        catch (error) {
            this.logger.error(`获取视频号单品趋势根数据失败: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
};
exports.WechatDashboardService = WechatDashboardService;
exports.WechatDashboardService = WechatDashboardService = WechatDashboardService_1 = tslib_1.__decorate([
    (0, common_1.Injectable)()
], WechatDashboardService);
