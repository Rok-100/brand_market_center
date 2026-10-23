import type { DataState } from "./cockpit.types";
export type OmniChannelKey = "all" | "douyin" | "wechat" | "koc" | "dabo" | "tmall" | "jd" | "kuaishou" | "pdd" | "vip" | "dewu" | "pupu" | "tmall-super" | "xiaohongshu" | "yunji-pop" | "new-media" | "offline";
export type ChannelCategory = "online" | "offline";
export interface ChannelMeta {
    key: OmniChannelKey;
    label: string;
    category: ChannelCategory;
    dataSource: "mcp" | "postgres" | "feishu" | "pending";
    hasRealData: boolean;
    dedupeKey: string | null;
}
export interface OmniChannelDailyPoint {
    date: string;
    channel: OmniChannelKey;
    gmvYuan: number | null;
    gsvYuan: number | null;
    refundYuan: number | null;
    refundRatePct: number | null;
    closedOrderCount: number | null;
    totalOrderCount: number | null;
    adCostYuan: number | null;
    profitYuan: number | null;
    orderCount: number | null;
    state: DataState;
    sourceUpdatedAt: string | null;
    sourceRecords: number;
}
export interface OmniChannelAggregated {
    gsvYuan: number;
    gmvYuan: number;
    refundYuan: number;
    adCostYuan: number;
    profitYuan: number;
    orderCount: number;
    refundRatePct: number | null;
    adSharePct: number | null;
    profitMarginPct: number | null;
    state: DataState;
    contributingChannels: OmniChannelKey[];
    missingChannels: OmniChannelKey[];
}
export interface OmniChannelTarget {
    period: string;
    targetGsvWan: number | null;
    completedGsvWan: number;
    progressPct: number | null;
    state: DataState;
}
export interface OmniChannelProfitCoverage {
    startDate: string;
    endDate: string;
    coveredDays: number;
    selectedDays: number;
    isComplete: boolean;
}
export interface BrandMarketingMonthlyTrendPoint {
    month: string;
    label: string;
    incomeWan: number | null;
    profitMarginPct: number | null;
    incomeThroughDate: string | null;
    profitThroughDate: string | null;
    sourceMode: "finance-forecast" | "live-channels";
}
export interface OmniChannelRealtimePoint {
    hour: number;
    hourLabel: string;
    todayHourlyYuan: number | null;
    yesterdayHourlyYuan: number | null;
    todayCumulativeYuan: number | null;
    yesterdayCumulativeYuan: number | null;
}
export interface OmniChannelRealtimeSeries {
    key: "douyin" | "wechat";
    label: string;
    metric: "GSV";
    todayDate: string;
    yesterdayDate: string;
    dataThroughHour: number | null;
    comparisonThroughHour: number | null;
    todayTotalYuan: number | null;
    todayComparisonYuan: number | null;
    yesterdaySameTimeYuan: number | null;
    yesterdayTotalYuan: number | null;
    comparisonPct: number | null;
    todaySpendYuan: number | null;
    yesterdaySameTimeSpendYuan: number | null;
    yesterdayTotalSpendYuan: number | null;
    todaySpendRatioPct: number | null;
    yesterdaySameTimeSpendRatioPct: number | null;
    yesterdayTotalSpendRatioPct: number | null;
    spendRatioComparisonPct: number | null;
    spendCoverage: "complete" | "partial" | "missing";
    yesterdaySpendCoverage: "complete" | "partial" | "missing";
    spendBreakdown: Array<{
        key: string;
        label: string;
        valueYuan: number | null;
    }>;
    sourceUpdatedAt: string | null;
    state: DataState;
    unavailableReason: string | null;
    points: OmniChannelRealtimePoint[];
}
export interface OmniChannelRealtimeComparisonResponse {
    generatedAt: string;
    timezone: "Asia/Shanghai";
    channels: OmniChannelRealtimeSeries[];
}
export interface OmniChannelOverviewResponse {
    generatedAt: string;
    timezone: "Asia/Shanghai";
    /** 数据交付状态仅描述加载方式，不改变任何经营指标口径。 */
    deliveryState?: "live" | "fresh-cache" | "stale-cache";
    startDate: string;
    endDate: string;
    kpis: {
        totalGsvYuan: number | null;
        targetGsvWan: number | null;
        targetProgressPct: number | null;
        totalGmvYuan: number | null;
        totalProfitYuan: number | null;
        profitMarginPct: number | null;
        inventoryAmountYuan: number | null;
        inventoryTurnoverDays: number | null;
        gsvMomPct: number | null;
        gsvYoyPct: number | null;
        profitMomPct: number | null;
    };
    channels: Array<{
        key: OmniChannelKey;
        label: string;
        category: ChannelCategory;
        gsvYuan: number | null;
        gmvYuan: number | null;
        profitYuan: number | null;
        profitMarginPct: number | null;
        profitGsvYuan: number | null;
        targetGsvWan: number | null;
        targetProgressPct: number | null;
        state: DataState;
    }>;
    profitCoverage: OmniChannelProfitCoverage | null;
    brandMarketingTrend: BrandMarketingMonthlyTrendPoint[];
    inventory: OmniChannelInventory | null;
    aiInsights: AiInsight[] | null;
    caveats: string[];
}
export interface OmniChannelInventory {
    totalQty: number | null;
    totalAmountYuan: number | null;
    availableQty: number | null;
    inTransitQty: number | null;
    turnoverDays: number | null;
    inventorySalesRatio: number | null;
    outOfStockSkus: number | null;
    lowStockSkus: number | null;
    slowMovingSkus: number | null;
    nearExpiryQty: number | null;
    nearExpiryAmountYuan: number | null;
    state: DataState;
    sourceUpdatedAt: string | null;
}
export type AiInsightPriority = "high" | "medium" | "low";
export interface AiInsight {
    id: string;
    category: "summary" | "target_gap" | "growth" | "profit" | "inventory" | "action";
    title: string;
    description: string;
    priority: AiInsightPriority;
    expectedImpact: string | null;
    basis: string[];
    metrics: Array<{
        name: string;
        value: string;
        period: string;
    }>;
    actions: string[];
}
export interface AiChatMessage {
    id: string;
    role: "user" | "assistant";
    content: string;
    timestamp: string;
    status: "loading" | "done" | "error";
    citations?: Array<{
        metric: string;
        value: string;
        source: string;
    }>;
}
export interface OmniChannelChatRequest {
    question: string;
    startDate: string;
    endDate: string;
    channelFilter: OmniChannelKey[];
    inventoryFilter?: Record<string, string>;
}
export interface OmniChannelTrendResponse {
    items: Array<{
        period: string;
        periodLabel: string;
        gsvYuan: number | null;
        gmvYuan: number | null;
        profitYuan: number | null;
        profitMarginPct: number | null;
        state: DataState;
    }>;
    granularity: "day" | "week" | "month";
    startDate: string;
    endDate: string;
}
