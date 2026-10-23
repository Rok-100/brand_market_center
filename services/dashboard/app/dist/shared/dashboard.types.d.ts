export type MetricKey = "wis_doudian_effective_rolling_15d" | "wis_doudian_effective_today" | "qianchuan_account_cost_rolling_15d" | "qianchuan_product_cost_rolling_15d_oldest" | "qianchuan_product_cost_rolling_15d_middle" | "qianchuan_product_cost_rolling_15d_latest" | "wis_doudian_product_effective_rolling_15d_oldest" | "wis_doudian_product_effective_rolling_15d_middle" | "wis_doudian_product_effective_rolling_15d_latest" | "wis_doudian_effective_month_to_date" | "wis_doudian_product_effective_daily";
export type AgentStage = {
    key: "analyst" | "schema" | "sql" | "review" | "mcp";
    label: string;
    status: "ready" | "running" | "complete" | "fallback" | "error";
    detail: string;
};
export type TrendPoint = {
    date: string;
    paidSalesYuan: number;
    paidOrderCount: number;
    sourceUpdatedAt: string | null;
    hasData: boolean;
};
export type TodayMetric = {
    date: string;
    paidSalesYuan: number;
    paidOrderCount: number;
    sourceUpdatedAt: string | null;
    latestWisPayTime: string | null;
    freshness: "fresh" | "stale" | "no-data";
};
export type AdSpendPoint = {
    date: string;
    qianchuanCostYuan: number;
    videoCostYuan: number;
    liveCostYuan: number;
    advertiserCount: number;
    completeRowCount: number;
    rowCount: number;
    sourceUpdatedAt: string | null;
    hasData: boolean;
    isComplete: boolean;
};
export type ProductMetric = {
    date: string;
    standardProductName: string;
    paidSalesYuan: number;
    orderCount: number;
    productQuantity: number;
    productLinkCount: number;
    salesSharePct: number;
    sourceUpdatedAt: string | null;
};
export type GmvTargetItem = {
    name: string;
    targetWan: number;
    completedWan: number;
    dailyActualWan: number;
    dailyRequiredWan: number;
    dailyGapWan: number;
    progressPct: number;
};
export type GmvTargetData = {
    monthLabel: string;
    throughDate: string | null;
    brandTotal: GmvTargetItem;
    products: GmvTargetItem[];
    remainingDays: number;
    daysPassed: number;
    daysInMonth: number;
};
export declare const ATTRIBUTED_PRODUCT_NAMES: readonly ["水润面膜", "晶润紧致眼膜", "深海次抛精华", "黑晶光蕴面膜", "燕窝面膜", "美白针", "WIS肌活蛋白喷雾"];
export type AttributedProductName = (typeof ATTRIBUTED_PRODUCT_NAMES)[number];
export type ProductSpendPoint = {
    date: string;
    standardProductName: AttributedProductName;
    qianchuanCostYuan: number;
    advertiserCount: number;
    planCount: number;
    sourceUpdatedAt: string | null;
    hasData: boolean;
    isComplete: boolean;
};
export type ProductSpendCoveragePoint = {
    date: string;
    brandCostYuan: number | null;
    planVisibleCostYuan: number;
    mappedCostYuan: number;
    unmappedVisibleCostYuan: number;
    missingPlanCostYuan: number | null;
    planCoveragePct: number | null;
    mappedSharePct: number | null;
    brandAdvertiserCount: number;
    brandCompleteCount: number;
    brandRowCount: number;
    planAdvertiserCount: number;
    visiblePlanCount: number;
    sourceUpdatedAt: string | null;
    state: "complete" | "partial" | "missing";
};
export type DashboardPayload = {
    generatedAt: string;
    timezone: "Asia/Shanghai";
    sourceMode: "live" | "cache" | "snapshot";
    trend: TrendPoint[];
    adSpendTrend: AdSpendPoint[];
    todayDoudian: TodayMetric;
    products: ProductMetric[];
    productTrends: ProductMetric[];
    productSpendTrend: ProductSpendPoint[];
    productSpendCoverage: ProductSpendCoveragePoint[];
    productSalesDate: string;
    productSalesTotalYuan: number;
    gmvTarget: GmvTargetData;
    nextRefresh: {
        dailyTrendAt: string;
        hourlyMetricsAt: string;
    };
    workflow: AgentStage[];
    caveats: string[];
};
