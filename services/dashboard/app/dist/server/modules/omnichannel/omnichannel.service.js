"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OmnichannelService = void 0;
exports.buildRealtimeSeries = buildRealtimeSeries;
const tslib_1 = require("tslib");
const common_1 = require("@nestjs/common");
const fullstack_nestjs_core_1 = require("@lark-apaas/fullstack-nestjs-core");
const sources_adapter_1 = require("./sources.adapter");
const channel_config_1 = require("./channel-config");
const cockpit_service_1 = require("../dashboard/cockpit.service");
const dashboard_service_1 = require("../wechat-dashboard/dashboard.service");
function offsetDate(value, days) {
    const d = new Date(`${value}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}
function monthKey(date) {
    return date.slice(0, 7);
}
function daysInMonth(month) {
    const [y, m] = month.split("-").map(Number);
    return new Date(y, m, 0).getDate();
}
function safeDivide(numerator, denominator) {
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0)
        return null;
    return numerator / denominator;
}
const EMPTY_REALTIME_SPEND = {
    todaySpendYuan: null,
    comparisonTodaySpendYuan: null,
    yesterdaySameTimeSpendYuan: null,
    yesterdayTotalSpendYuan: null,
    coverage: "missing",
    yesterdayCoverage: "missing",
    breakdown: [],
};
function buildRealtimeSeries(key, label, today, yesterday, rows, unavailableReason = null, spend = EMPTY_REALTIME_SPEND, completeHourLimit) {
    const todayRows = rows.filter((row) => row.date === today);
    const yesterdayRows = rows.filter((row) => row.date === yesterday);
    const dataThroughHour = todayRows.length
        ? Math.max(...todayRows.map((row) => row.hour))
        : null;
    const requestedComparisonHour = completeHourLimit === undefined
        ? dataThroughHour
        : completeHourLimit;
    const comparisonThroughHour = dataThroughHour === null || requestedComparisonHour === null
        ? null
        : Math.min(dataThroughHour, requestedComparisonHour);
    const todayByHour = new Map(todayRows.map((row) => [row.hour, row.gsvYuan]));
    const yesterdayByHour = new Map(yesterdayRows.map((row) => [row.hour, row.gsvYuan]));
    let todayCumulative = 0;
    let yesterdayCumulative = 0;
    const points = Array.from({ length: 24 }, (_, hour) => {
        // 实时卡片保留当前累计值；对比图只展示完整结束的小时，避免用当天半小时对比昨日整小时。
        const todayHourlyYuan = comparisonThroughHour !== null && hour <= comparisonThroughHour
            ? (todayByHour.get(hour) ?? 0)
            : null;
        const yesterdayHourlyYuan = yesterdayRows.length
            ? (yesterdayByHour.get(hour) ?? 0)
            : null;
        if (todayHourlyYuan !== null)
            todayCumulative += todayHourlyYuan;
        if (yesterdayHourlyYuan !== null)
            yesterdayCumulative += yesterdayHourlyYuan;
        return {
            hour,
            hourLabel: `${String(hour).padStart(2, "0")}:00`,
            todayHourlyYuan,
            yesterdayHourlyYuan,
            todayCumulativeYuan: todayHourlyYuan === null ? null : todayCumulative,
            yesterdayCumulativeYuan: yesterdayHourlyYuan === null ? null : yesterdayCumulative,
        };
    });
    const todayTotalYuan = dataThroughHour === null
        ? null
        : todayRows.reduce((sum, row) => sum + row.gsvYuan, 0);
    const todayComparisonYuan = comparisonThroughHour === null
        ? null
        : points[comparisonThroughHour]?.todayCumulativeYuan ?? null;
    const yesterdaySameTimeYuan = comparisonThroughHour === null || !yesterdayRows.length
        ? null
        : points[comparisonThroughHour]?.yesterdayCumulativeYuan ?? null;
    const yesterdayTotalYuan = yesterdayRows.length
        ? points.at(-1)?.yesterdayCumulativeYuan ?? null
        : null;
    const comparisonPct = todayComparisonYuan !== null
        && yesterdaySameTimeYuan !== null
        && yesterdaySameTimeYuan > 0
        ? (todayComparisonYuan - yesterdaySameTimeYuan) / yesterdaySameTimeYuan * 100
        : null;
    const todaySpendRatioPct = todayTotalYuan !== null && todayTotalYuan > 0 && spend.todaySpendYuan !== null
        ? spend.todaySpendYuan / todayTotalYuan * 100
        : null;
    const yesterdaySameTimeSpendRatioPct = yesterdaySameTimeYuan !== null
        && yesterdaySameTimeYuan > 0
        && spend.yesterdaySameTimeSpendYuan !== null
        ? spend.yesterdaySameTimeSpendYuan / yesterdaySameTimeYuan * 100
        : null;
    const yesterdayTotalSpendRatioPct = yesterdayTotalYuan !== null
        && yesterdayTotalYuan > 0
        && spend.yesterdayTotalSpendYuan !== null
        ? spend.yesterdayTotalSpendYuan / yesterdayTotalYuan * 100
        : null;
    const comparisonTodaySpendYuan = spend.comparisonTodaySpendYuan === undefined
        && completeHourLimit === undefined
        ? spend.todaySpendYuan
        : spend.comparisonTodaySpendYuan;
    const comparisonTodaySpendRatioPct = todayComparisonYuan !== null
        && todayComparisonYuan > 0
        && comparisonTodaySpendYuan !== null
        && comparisonTodaySpendYuan !== undefined
        ? comparisonTodaySpendYuan / todayComparisonYuan * 100
        : null;
    const spendRatioComparisonPct = comparisonTodaySpendRatioPct !== null
        && yesterdaySameTimeSpendRatioPct !== null
        && yesterdaySameTimeSpendRatioPct > 0
        ? (comparisonTodaySpendRatioPct - yesterdaySameTimeSpendRatioPct)
            / yesterdaySameTimeSpendRatioPct * 100
        : null;
    const sourceUpdatedAt = rows
        .map((row) => row.sourceUpdatedAt)
        .filter((value) => Boolean(value))
        .sort()
        .at(-1) || null;
    const reason = unavailableReason
        || (!todayRows.length ? "今日根数据尚未返回" : null)
        || (!yesterdayRows.length ? "昨日小时根数据尚未返回" : null);
    return {
        key,
        label,
        metric: "GSV",
        todayDate: today,
        yesterdayDate: yesterday,
        dataThroughHour,
        comparisonThroughHour,
        todayTotalYuan,
        todayComparisonYuan,
        yesterdaySameTimeYuan,
        yesterdayTotalYuan,
        comparisonPct,
        todaySpendYuan: spend.todaySpendYuan,
        yesterdaySameTimeSpendYuan: spend.yesterdaySameTimeSpendYuan,
        yesterdayTotalSpendYuan: spend.yesterdayTotalSpendYuan,
        todaySpendRatioPct,
        yesterdaySameTimeSpendRatioPct,
        yesterdayTotalSpendRatioPct,
        spendRatioComparisonPct,
        spendCoverage: spend.coverage,
        yesterdaySpendCoverage: spend.yesterdayCoverage ?? spend.coverage,
        spendBreakdown: spend.breakdown,
        sourceUpdatedAt,
        state: todayRows.length && yesterdayRows.length ? "partial" : rows.length ? "partial" : "missing",
        unavailableReason: reason,
        points,
    };
}
function sumSpendThroughHour(rows, date, throughHour) {
    if (throughHour === null)
        return null;
    const matches = rows.filter((row) => row.date === date && row.hour <= throughHour);
    return matches.length ? matches.reduce((sum, row) => sum + row.spendYuan, 0) : null;
}
function sumSpendForDate(rows, date) {
    const matches = rows.filter((row) => row.date === date);
    return matches.length ? matches.reduce((sum, row) => sum + row.spendYuan, 0) : null;
}
let OmnichannelService = class OmnichannelService {
    db;
    wechatDashboard;
    constructor(db, wechatDashboard) {
        this.db = db;
        this.wechatDashboard = wechatDashboard;
    }
    async getRealtimeComparison() {
        const today = this.shanghaiToday();
        const yesterday = offsetDate(today, -1);
        const currentHour = this.shanghaiHour();
        const completeHourLimit = currentHour === 0 ? null : currentHour - 1;
        const [douyinResult, wechatResult, douyinSpendResult, wechatSpendResult] = await Promise.allSettled([
            (0, sources_adapter_1.fetchHourlyDouyinGsv)(yesterday, today),
            this.wechatDashboard.getHourlyGsv(yesterday, today),
            (0, sources_adapter_1.fetchHourlyDouyinSpend)(yesterday, today),
            this.wechatDashboard.getDailyAdq(yesterday, today),
        ]);
        const douyinRows = douyinResult.status === "fulfilled" ? douyinResult.value : [];
        const wechatRows = wechatResult.status === "fulfilled" ? wechatResult.value : [];
        const douyinThroughHour = douyinRows.filter((row) => row.date === today).length
            ? Math.max(...douyinRows.filter((row) => row.date === today).map((row) => row.hour))
            : null;
        const douyinSpendRows = douyinSpendResult.status === "fulfilled" ? douyinSpendResult.value : [];
        const douyinTodaySpend = sumSpendThroughHour(douyinSpendRows, today, douyinThroughHour);
        const douyinComparisonSpend = sumSpendThroughHour(douyinSpendRows, today, completeHourLimit);
        const douyinYesterdaySpend = sumSpendForDate(douyinSpendRows, yesterday);
        const douyinSpend = {
            todaySpendYuan: douyinTodaySpend,
            comparisonTodaySpendYuan: douyinComparisonSpend,
            yesterdaySameTimeSpendYuan: sumSpendThroughHour(douyinSpendRows, yesterday, completeHourLimit),
            yesterdayTotalSpendYuan: douyinYesterdaySpend,
            coverage: douyinTodaySpend === null ? "missing" : "complete",
            yesterdayCoverage: douyinYesterdaySpend === null ? "missing" : "complete",
            breakdown: [{ key: "qianchuan", label: "千川", valueYuan: douyinTodaySpend }],
        };
        const wechatSpendItems = wechatSpendResult.status === "fulfilled" ? wechatSpendResult.value.items : [];
        const wechatTodaySpend = wechatSpendItems.find((item) => item.date === today);
        const wechatYesterdaySpend = wechatSpendItems.find((item) => item.date === yesterday);
        const wechatSpend = {
            todaySpendYuan: wechatTodaySpend?.hasSpendData ? wechatTodaySpend.spend : null,
            // 当前视频号投放源仅返回日内累计和历史整日值，没有可靠的昨日同小时切片。
            yesterdaySameTimeSpendYuan: null,
            yesterdayTotalSpendYuan: wechatYesterdaySpend?.hasSpendData ? wechatYesterdaySpend.spend : null,
            coverage: !wechatTodaySpend?.hasSpendData
                ? "missing"
                : wechatTodaySpend.costCoverageStatus === "complete" ? "complete" : "partial",
            yesterdayCoverage: !wechatYesterdaySpend?.hasSpendData
                ? "missing"
                : wechatYesterdaySpend.costCoverageStatus === "complete" ? "complete" : "partial",
            breakdown: [
                { key: "adq", label: "ADQ", valueYuan: wechatTodaySpend?.adqSpend ?? null },
                { key: "haitun", label: "海豚智投", valueYuan: wechatTodaySpend?.wechatBeanSpend ?? null },
                { key: "shop", label: "店铺推广", valueYuan: wechatTodaySpend?.shopPromotionSpend ?? null },
                { key: "commission", label: "达人佣金", valueYuan: wechatTodaySpend?.creatorCommissionSpend ?? null },
            ],
        };
        return {
            generatedAt: new Date().toISOString(),
            timezone: "Asia/Shanghai",
            channels: [
                buildRealtimeSeries("douyin", "抖音", today, yesterday, douyinRows, douyinResult.status === "rejected" ? "抖音小时根数据暂未返回" : null, douyinSpend, completeHourLimit),
                buildRealtimeSeries("wechat", "视频号", today, yesterday, wechatRows, wechatResult.status === "rejected" ? "视频号小时根数据暂未返回" : null, wechatSpend, completeHourLimit),
            ],
        };
    }
    async fetchDaily(channel, startDate, endDate) {
        if (channel !== "wechat") {
            return (0, sources_adapter_1.fetchChannelDaily)(channel, this.db, startDate, endDate);
        }
        // 全渠道页复用视频号经营页已经校准的根数据结果，避免继续读取只覆盖少量日期的本地汇总表。
        const salesPromise = this.wechatDashboard.getDailyGsv(startDate, endDate);
        const [salesResponse, adqResponse] = await Promise.all([
            salesPromise,
            this.wechatDashboard.getDailyAdq(startDate, endDate, salesPromise),
        ]);
        const adqByDate = new Map(adqResponse.items.map((item) => [item.date, item]));
        return salesResponse.items.map((sale) => {
            const adq = adqByDate.get(sale.date);
            const adCostYuan = adq?.hasSpendData ? adq.spend : null;
            const state = sale.isPartial || !adq || adq.isPartial ? "partial" : "complete";
            const updatedCandidates = [sale.sourceUpdatedAt, adq?.sourceUpdatedAt]
                .filter((value) => Boolean(value))
                .sort();
            return {
                date: sale.date,
                channel: "wechat",
                gmvYuan: sale.gmv,
                gsvYuan: sale.value,
                refundYuan: sale.refundAmount,
                refundRatePct: null,
                closedOrderCount: null,
                totalOrderCount: null,
                adCostYuan,
                profitYuan: adq?.profitYuan ?? null,
                orderCount: sale.orderCount,
                state,
                sourceUpdatedAt: updatedCandidates.at(-1) || null,
                sourceRecords: sale.orderCount,
            };
        });
    }
    async fetchChannelResults(startDate, endDate) {
        const activeChannels = channel_config_1.CHANNEL_METADATA.filter((channel) => channel.key !== "all" && channel.hasRealData);
        return Promise.all(activeChannels.map(async (meta) => {
            try {
                const points = await this.fetchDaily(meta.key, startDate, endDate);
                return { key: meta.key, points, error: null };
            }
            catch (error) {
                return {
                    key: meta.key,
                    points: [],
                    error: error instanceof Error ? error.message : "unknown",
                };
            }
        }));
    }
    sliceChannelResults(results, startDate, endDate) {
        return results.map((result) => ({
            ...result,
            points: result.points.filter((point) => point.date >= startDate && point.date <= endDate),
        }));
    }
    async getOverview(startDate, endDate) {
        const today = this.shanghaiToday();
        const end = endDate || today;
        const start = startDate || offsetDate(end, -29);
        const actualStart = start > end ? end : start;
        const actualEnd = end < start ? start : end;
        const periodDays = this.dayCount(actualStart, actualEnd);
        const prevStart = offsetDate(actualStart, -periodDays);
        const prevEnd = offsetDate(actualEnd, -periodDays);
        const augustStart = "2026-08-01";
        const augustEnd = today > "2026-08-31" ? "2026-08-31" : today;
        // 当前周期、环比周期和固定八月趋势高度重叠。一次读取并在内存切片，
        // 避免全渠道首屏重复扫描抖音与视频号根表三遍。
        const unionStart = [prevStart, actualStart, augustStart].sort()[0];
        const unionEnd = [prevEnd, actualEnd, augustEnd].sort().at(-1);
        const unionDays = this.dayCount(unionStart, unionEnd);
        const separateDays = periodDays * 2 + this.dayCount(augustStart, augustEnd);
        const shouldUseUnion = unionDays <= separateDays + 7;
        const [channelResults, previousResults, augustResults] = shouldUseUnion
            ? await this.fetchChannelResults(unionStart, unionEnd).then((unionResults) => [
                this.sliceChannelResults(unionResults, actualStart, actualEnd),
                this.sliceChannelResults(unionResults, prevStart, prevEnd),
                this.sliceChannelResults(unionResults, augustStart, augustEnd),
            ])
            : await Promise.all([
                this.fetchChannelResults(actualStart, actualEnd),
                this.fetchChannelResults(prevStart, prevEnd),
                this.fetchChannelResults(augustStart, augustEnd),
            ]);
        const activeChannels = channel_config_1.CHANNEL_METADATA.filter((c) => c.key !== "all" && c.hasRealData);
        if (actualEnd === today) {
            const douyinResult = channelResults.find((r) => r.key === "douyin");
            if (douyinResult && douyinResult.points.length > 0) {
                const lastPoint = douyinResult.points[douyinResult.points.length - 1];
                if (lastPoint.date === today && lastPoint.adCostYuan === null) {
                    try {
                        const hourly = await (0, sources_adapter_1.fetchTodayHourlyDouyin)();
                        if (hourly.hasData) {
                            lastPoint.adCostYuan = hourly.costYuan;
                            if (lastPoint.gsvYuan !== null) {
                                lastPoint.profitYuan = (0, cockpit_service_1.dailyProfit)(today, lastPoint.gsvYuan, hourly.costYuan).profitYuan;
                            }
                            lastPoint.state = "partial";
                        }
                    }
                    catch {
                        // ignore hourly fallback failure
                    }
                }
            }
        }
        const commonProfitDates = this.commonProfitDates(channelResults);
        const profitCoverage = this.buildProfitCoverage(commonProfitDates, actualStart, actualEnd);
        const channelSummaries = activeChannels.map((meta) => {
            const result = channelResults.find((r) => r.key === meta.key);
            const points = result.points;
            const gsv = points.reduce((sum, p) => sum + (p.gsvYuan || 0), 0);
            const gmv = points.reduce((sum, p) => sum + (p.gmvYuan || 0), 0);
            const adCost = points.reduce((sum, p) => sum + (p.adCostYuan || 0), 0);
            const hasAdData = points.some((p) => p.adCostYuan !== null);
            const orders = points.reduce((sum, p) => sum + (p.orderCount || 0), 0);
            const profit = this.aggregateProfit(points, commonProfitDates);
            const state = this.aggregateState(points, meta.hasRealData);
            const month = monthKey(actualEnd);
            const monthlyTarget = channel_config_1.OMNICHANNEL_TARGET_GSV_WAN[month] || null;
            const channelTarget = monthlyTarget ? this.channelTargetShare(meta.key, monthlyTarget) : null;
            const progress = channelTarget && gsv > 0 ? (gsv / 10000) / channelTarget * 100 : null;
            return {
                key: meta.key,
                label: meta.label,
                category: meta.category,
                gsvYuan: points.length > 0 ? gsv : null,
                gmvYuan: points.length > 0 ? gmv : null,
                profitYuan: profit.profitYuan,
                profitMarginPct: profit.profitMarginPct,
                profitGsvYuan: profit.coveredGsvYuan,
                targetGsvWan: channelTarget,
                targetProgressPct: progress,
                state,
            };
        });
        const aggregated = this.aggregateAll(channelSummaries, actualStart, actualEnd);
        const brandMarketingTrend = this.buildBrandMarketingTrend(augustResults, augustEnd);
        const prevAggregated = this.aggregatePeriod(previousResults);
        const gsvMom = prevAggregated.gsvYuan && aggregated.gsvYuan && prevAggregated.gsvYuan > 100000
            ? (aggregated.gsvYuan - prevAggregated.gsvYuan) / prevAggregated.gsvYuan * 100
            : null;
        const profitMom = prevAggregated.profitYuan !== null && aggregated.profitYuan !== null && Math.abs(prevAggregated.profitYuan) > 10000
            ? (aggregated.profitYuan - prevAggregated.profitYuan) / Math.abs(prevAggregated.profitYuan) * 100
            : null;
        const aiInsights = this.buildAiInsights(channelSummaries, aggregated, profitCoverage);
        const caveats = this.buildCaveats(channelResults, actualStart, actualEnd, profitCoverage);
        return {
            generatedAt: new Date().toISOString(),
            timezone: "Asia/Shanghai",
            startDate: actualStart,
            endDate: actualEnd,
            kpis: {
                totalGsvYuan: aggregated.gsvYuan,
                targetGsvWan: aggregated.targetGsvWan,
                targetProgressPct: aggregated.targetProgressPct,
                totalGmvYuan: aggregated.gmvYuan,
                totalProfitYuan: aggregated.profitYuan,
                profitMarginPct: aggregated.profitMarginPct,
                inventoryAmountYuan: null,
                inventoryTurnoverDays: null,
                gsvMomPct: gsvMom,
                gsvYoyPct: null,
                profitMomPct: profitMom,
            },
            channels: channelSummaries,
            profitCoverage,
            brandMarketingTrend,
            inventory: null,
            aiInsights,
            caveats,
        };
    }
    async getTrend(startDate, endDate, granularity) {
        const today = this.shanghaiToday();
        const end = endDate || today;
        const start = startDate || offsetDate(end, -29);
        const actualStart = start > end ? end : start;
        const actualEnd = end < start ? start : end;
        const gran = granularity || (this.dayCount(actualStart, actualEnd) > 60 ? "month" : this.dayCount(actualStart, actualEnd) > 14 ? "week" : "day");
        const activeChannels = channel_config_1.CHANNEL_METADATA.filter((c) => c.key !== "all" && c.hasRealData);
        const channelPoints = await Promise.all(activeChannels.map(async (meta) => {
            try {
                return await this.fetchDaily(meta.key, actualStart, actualEnd);
            }
            catch {
                return [];
            }
        }));
        const allPoints = channelPoints.flat();
        const byDate = new Map();
        for (const point of allPoints) {
            const existing = byDate.get(point.date) || {
                gsv: 0,
                gmv: 0,
                profit: 0,
                profitComplete: true,
                channels: new Set(),
                states: [],
            };
            existing.gsv += point.gsvYuan || 0;
            existing.gmv += point.gmvYuan || 0;
            if (point.profitYuan !== null) {
                existing.profit += point.profitYuan;
            }
            else {
                existing.profitComplete = false;
            }
            existing.channels.add(point.channel);
            existing.states.push(point.state);
            byDate.set(point.date, existing);
        }
        const dates = [...byDate.keys()].sort();
        const items = dates.map((date) => {
            const d = byDate.get(date);
            const states = d.states;
            const hasAllChannels = d.channels.size === activeChannels.length;
            const hasCompleteProfit = hasAllChannels && d.profitComplete;
            const state = hasAllChannels && states.every((s) => s === "complete")
                ? "complete"
                : states.some((s) => s === "complete" || s === "partial")
                    ? "partial"
                    : "missing";
            return {
                period: date,
                periodLabel: date.slice(5).replace("-", "/"),
                gsvYuan: d.gsv,
                gmvYuan: d.gmv,
                profitYuan: hasCompleteProfit ? d.profit : null,
                profitMarginPct: hasCompleteProfit && d.gsv > 0 ? d.profit / d.gsv * 100 : null,
                state,
            };
        });
        return {
            items,
            granularity: gran,
            startDate: actualStart,
            endDate: actualEnd,
        };
    }
    aggregatePeriod(channelResults) {
        let totalGsv = 0;
        let totalProfit = 0;
        let hasAny = false;
        const commonProfitDates = this.commonProfitDates(channelResults);
        let hasCompleteProfit = commonProfitDates.size > 0;
        for (const { points } of channelResults) {
            if (points.length > 0) {
                hasAny = true;
                totalGsv += points.reduce((sum, p) => sum + (p.gsvYuan || 0), 0);
                const profit = this.aggregateProfit(points, commonProfitDates);
                if (profit.profitYuan !== null) {
                    totalProfit += profit.profitYuan;
                }
                else {
                    hasCompleteProfit = false;
                }
            }
            else {
                hasCompleteProfit = false;
            }
        }
        return {
            gsvYuan: hasAny ? totalGsv : null,
            profitYuan: hasAny && hasCompleteProfit ? totalProfit : null,
        };
    }
    commonProfitDates(results) {
        if (results.length === 0)
            return new Set();
        const dateSets = results.map((result) => new Set(result.points
            .filter((point) => point.profitYuan !== null && point.gsvYuan !== null && point.gsvYuan > 0)
            .map((point) => point.date)));
        if (dateSets.some((dates) => dates.size === 0))
            return new Set();
        return new Set([...dateSets[0]].filter((date) => dateSets.every((dates) => dates.has(date))));
    }
    buildProfitCoverage(dates, startDate, endDate) {
        const sortedDates = [...dates].sort();
        if (sortedDates.length === 0)
            return null;
        return {
            startDate: sortedDates[0],
            endDate: sortedDates.at(-1),
            coveredDays: sortedDates.length,
            selectedDays: this.dayCount(startDate, endDate),
            isComplete: sortedDates.length === this.dayCount(startDate, endDate),
        };
    }
    aggregateProfit(points, allowedDates) {
        const profitPoints = points.filter((point) => (point.profitYuan !== null
            && point.gsvYuan !== null
            && point.gsvYuan > 0
            && (!allowedDates || allowedDates.has(point.date))));
        if (profitPoints.length === 0) {
            return { profitYuan: null, profitMarginPct: null, coveredGsvYuan: null, coveredDays: 0 };
        }
        const totalProfit = profitPoints.reduce((sum, point) => sum + point.profitYuan, 0);
        const totalGsv = profitPoints.reduce((sum, point) => sum + point.gsvYuan, 0);
        return {
            profitYuan: totalProfit,
            profitMarginPct: totalGsv > 0 ? totalProfit / totalGsv * 100 : null,
            coveredGsvYuan: totalGsv,
            coveredDays: profitPoints.length,
        };
    }
    aggregateState(points, hasRealData) {
        if (!hasRealData || points.length === 0)
            return "missing";
        if (points.every((p) => p.state === "complete"))
            return "complete";
        if (points.some((p) => p.state === "complete" || p.state === "partial"))
            return "partial";
        return "missing";
    }
    aggregateAll(channels, start, end) {
        const active = channels.filter((c) => c.state !== "missing");
        const gsv = active.reduce((sum, c) => sum + (c.gsvYuan || 0), 0);
        const gmv = active.reduce((sum, c) => sum + (c.gmvYuan || 0), 0);
        const hasProfit = active.length > 0 && active.every((channel) => channel.profitYuan !== null);
        const profit = hasProfit
            ? active.reduce((sum, channel) => sum + channel.profitYuan, 0)
            : null;
        const profitGsv = hasProfit
            ? active.reduce((sum, channel) => sum + (channel.profitGsvYuan || 0), 0)
            : null;
        const month = monthKey(end);
        const monthlyTarget = channel_config_1.OMNICHANNEL_TARGET_GSV_WAN[month] || null;
        let targetGsvWan = null;
        let targetProgressPct = null;
        if (monthlyTarget) {
            const startMonth = monthKey(start);
            const sameMonth = startMonth === month;
            if (sameMonth) {
                targetGsvWan = monthlyTarget;
            }
            else {
                targetGsvWan = null;
            }
            targetProgressPct = targetGsvWan && gsv > 0 ? (gsv / 10000) / targetGsvWan * 100 : null;
        }
        const state = active.length === 0
            ? "missing"
            : active.every((c) => c.state === "complete")
                ? "complete"
                : "partial";
        return {
            gsvYuan: active.length > 0 ? gsv : null,
            gmvYuan: active.length > 0 ? gmv : null,
            profitYuan: profit,
            profitMarginPct: profit !== null && profitGsv !== null && profitGsv > 0 ? profit / profitGsv * 100 : null,
            targetGsvWan,
            targetProgressPct,
            state,
            contributingChannels: active.map((c) => c.key),
            missingChannels: channels.filter((c) => c.state === "missing").map((c) => c.key),
        };
    }
    buildBrandMarketingTrend(augustResults, augustEnd) {
        const staticPoints = channel_config_1.BRAND_MARKETING_FINANCE_TREND_2026.map((point) => ({
            ...point,
            incomeThroughDate: `${point.month}-${String(daysInMonth(point.month)).padStart(2, "0")}`,
            profitThroughDate: `${point.month}-${String(daysInMonth(point.month)).padStart(2, "0")}`,
            sourceMode: "finance-forecast",
        }));
        const incomePoints = augustResults.flatMap((result) => result.points)
            .filter((point) => point.gsvYuan !== null);
        const incomeYuan = incomePoints.reduce((sum, point) => sum + point.gsvYuan, 0);
        const incomeDates = incomePoints.map((point) => point.date).sort();
        const commonDates = this.commonProfitDates(augustResults);
        const channelProfits = augustResults.map((result) => this.aggregateProfit(result.points, commonDates));
        const hasProfit = channelProfits.length > 0
            && channelProfits.every((item) => item.profitYuan !== null && item.coveredGsvYuan !== null);
        const totalProfit = hasProfit
            ? channelProfits.reduce((sum, item) => sum + item.profitYuan, 0)
            : null;
        const totalProfitGsv = hasProfit
            ? channelProfits.reduce((sum, item) => sum + item.coveredGsvYuan, 0)
            : null;
        const profitDates = [...commonDates].sort();
        return [
            ...staticPoints,
            {
                month: "2026-08",
                label: "8月",
                incomeWan: incomePoints.length > 0 ? incomeYuan / 10000 : null,
                profitMarginPct: totalProfit !== null && totalProfitGsv !== null && totalProfitGsv > 0
                    ? totalProfit / totalProfitGsv * 100
                    : null,
                incomeThroughDate: incomeDates.at(-1) || augustEnd || null,
                profitThroughDate: profitDates.at(-1) || null,
                sourceMode: "live-channels",
            },
        ];
    }
    channelTargetShare(channel, totalTargetWan) {
        const shares = {
            douyin: 0.45,
            wechat: 0.15,
        };
        const share = shares[channel];
        return share ? Number((totalTargetWan * share).toFixed(1)) : null;
    }
    buildAiInsights(channels, aggregated, profitCoverage) {
        const insights = [];
        const activeChannels = channels.filter((c) => c.state !== "missing");
        const activeNames = activeChannels.map((channel) => channel.label).join("、");
        insights.push({
            id: "summary-1",
            category: "summary",
            title: "已接入渠道经营摘要",
            description: activeChannels.length > 0
                ? `当前分析范围为${activeNames}，GSV合计 ${aggregated.gsvYuan !== null ? (aggregated.gsvYuan / 10000).toFixed(1) + "万元" : "数据不可用"}；没有返回的指标不补 0。`
                : "当前抖音与视频号均未返回可用数据，经营汇总暂不可用。",
            priority: "medium",
            expectedImpact: null,
            basis: activeChannels.length > 0
                ? activeChannels.map((channel) => `${channel.label}已返回经营数据`)
                : ["抖音与视频号未返回可用数据"],
            metrics: aggregated.gsvYuan !== null
                ? [{ name: "已接入渠道GSV", value: `${(aggregated.gsvYuan / 10000).toFixed(1)}万元`, period: "所选区间" }]
                : [],
            actions: activeChannels.length > 0
                ? ["分别复盘抖音与视频号的流量、转化和投放效率", "统一两渠道GSV与利润口径的日常对账"]
                : ["核验抖音与视频号数据源状态", "数据恢复前不根据空值作经营判断"],
        });
        const rankedByGsv = activeChannels
            .filter((channel) => channel.gsvYuan !== null)
            .sort((a, b) => b.gsvYuan - a.gsvYuan);
        if (rankedByGsv.length > 0) {
            const leader = rankedByGsv[0];
            const follower = rankedByGsv[1];
            insights.push({
                id: "growth-1",
                category: "growth",
                title: "已接入渠道业绩对比",
                description: follower
                    ? `${leader.label}当前GSV高于${follower.label}，建议拆解领先渠道的有效动作，并结合另一渠道自身流量结构验证可复制性。`
                    : `${leader.label}当前已返回GSV，另一已接入渠道数据不足，暂不做横向排名。`,
                priority: "medium",
                expectedImpact: null,
                basis: rankedByGsv.map((channel) => `${channel.label} GSV ${(channel.gsvYuan / 10000).toFixed(1)}万元`),
                metrics: rankedByGsv.map((channel) => ({ name: `${channel.label}GSV`, value: `${(channel.gsvYuan / 10000).toFixed(1)}万元`, period: "所选区间" })),
                actions: [
                    `复盘${leader.label}的有效流量与转化动作`,
                    follower ? `定位${follower.label}与领先渠道的结构性差异` : "等待另一渠道返回完整数据后再做对比",
                ],
            });
        }
        if (aggregated.targetProgressPct !== null) {
            insights.push({
                id: "target-1",
                category: "target_gap",
                title: aggregated.targetProgressPct < 100 ? "GSV目标存在缺口" : "GSV目标达成",
                description: `当前全渠道GSV目标完成率 ${aggregated.targetProgressPct.toFixed(1)}%。${aggregated.targetProgressPct < 100 ? "需关注增长动力不足的渠道。" : "经营表现良好，保持当前节奏。"}`,
                priority: aggregated.targetProgressPct < 80 ? "high" : "medium",
                expectedImpact: null,
                basis: [`目标完成率 ${aggregated.targetProgressPct.toFixed(1)}%`],
                metrics: [{ name: "目标完成率", value: `${aggregated.targetProgressPct.toFixed(1)}%`, period: "所选区间" }],
                actions: aggregated.targetProgressPct < 100
                    ? ["分别分析抖音与视频号的目标缺口", "仅在ROI和利润数据完整时调整投入", "优先优化已确认的低利润环节"]
                    : ["维持两渠道当前有效动作", "持续复核GSV和利润口径"],
            });
        }
        const profitAvailable = activeChannels.filter((c) => c.profitYuan !== null && c.profitMarginPct !== null);
        const profitable = profitAvailable.filter((c) => c.profitMarginPct > 0);
        const lossMaking = profitAvailable.filter((c) => c.profitMarginPct < 0);
        const breakEven = profitAvailable.filter((c) => c.profitMarginPct === 0);
        const profitPeriod = profitCoverage
            ? `${profitCoverage.startDate}至${profitCoverage.endDate}共同覆盖日期`
            : "已返回利润日期";
        if (profitAvailable.length > 0) {
            insights.push({
                id: "profit-1",
                category: "profit",
                title: "渠道利润结构分析",
                description: profitable.length > 0
                    ? `高利润渠道：${profitable.map((c) => c.label).join("、")}。亏损渠道：${lossMaking.length > 0 ? lossMaking.map((c) => c.label).join("、") : "无"}。`
                    : lossMaking.length > 0
                        ? `当前亏损渠道：${lossMaking.map((c) => c.label).join("、")}；利润依据两渠道共同完整返回的日期汇总，缺失日未补 0。`
                        : `当前盈亏平衡渠道：${breakEven.map((c) => c.label).join("、")}。`,
                priority: "medium",
                expectedImpact: null,
                basis: profitAvailable.map((c) => `${c.label}利润额 ${(c.profitYuan / 10000).toFixed(1)}万元、利润率 ${c.profitMarginPct.toFixed(1)}%`),
                metrics: profitAvailable.map((c) => ({ name: `${c.label}利润率`, value: `${c.profitMarginPct.toFixed(1)}%`, period: profitPeriod })),
                actions: [
                    "复盘利润率较高渠道的流量与成本结构",
                    "分析亏损渠道的实际投放及履约成本",
                    "仅依据已完整返回的利润数据调整资源",
                ],
            });
        }
        return insights;
    }
    buildCaveats(results, start, end, profitCoverage = null) {
        const caveats = [];
        const failed = results.filter((r) => r.error !== null);
        if (failed.length > 0) {
            caveats.push(`以下渠道数据查询失败，未计入汇总：${failed.map((r) => r.key).join("、")}。`);
        }
        const partial = results.filter((r) => r.points.some((p) => p.state === "partial"));
        if (partial.length > 0) {
            caveats.push(`以下渠道存在部分日期数据不完整：${partial.map((r) => r.key).join("、")}。`);
        }
        caveats.push("当前页面仅展示已接入经营数据的渠道：抖音、视频号；缺失、未返回或映射不明确的数据不按 0 处理。");
        caveats.push("范围定义：WIS品牌=全部平台+全部渠道；品牌营销部=抖音+视频号+KOC。");
        caveats.push(`统计区间：${start} 至 ${end}（北京时间，自然日闭区间）。`);
        if (profitCoverage) {
            caveats.push(`利润额与利润率仅汇总抖音、视频号共同返回利润的日期：${profitCoverage.startDate} 至 ${profitCoverage.endDate}，共 ${profitCoverage.coveredDays} 天；其他日期不补 0。`);
        }
        caveats.push("利润率为共同利润覆盖日期的利润总额 / 同期GSV总额，非各渠道利润率的算术平均。");
        return caveats;
    }
    dayCount(start, end) {
        const s = new Date(`${start}T00:00:00Z`).getTime();
        const e = new Date(`${end}T00:00:00Z`).getTime();
        return Math.round((e - s) / 86400000) + 1;
    }
    shanghaiToday() {
        return new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Shanghai",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        }).format(new Date());
    }
    shanghaiHour() {
        return Number(new Intl.DateTimeFormat("en-GB", {
            timeZone: "Asia/Shanghai",
            hour: "2-digit",
            hourCycle: "h23",
        }).format(new Date()));
    }
};
exports.OmnichannelService = OmnichannelService;
exports.OmnichannelService = OmnichannelService = tslib_1.__decorate([
    (0, common_1.Injectable)(),
    tslib_1.__param(0, (0, common_1.Inject)(fullstack_nestjs_core_1.DRIZZLE_DATABASE)),
    tslib_1.__metadata("design:paramtypes", [Function, dashboard_service_1.WechatDashboardService])
], OmnichannelService);
