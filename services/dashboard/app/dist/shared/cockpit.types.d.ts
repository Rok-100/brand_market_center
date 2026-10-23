export type CockpitRole = "viewer" | "manager" | "senior_manager" | "director";
export type DataState = "complete" | "partial" | "missing";
export interface CockpitSession {
    authenticated: boolean;
    userId: string | null;
    role: CockpitRole;
    jobTitle: string | null;
    permissionBasis: "job_title" | "verified_profile" | "role" | "none";
    canViewCriticalWork: boolean;
    canViewProfit: boolean;
    canViewDirectorBriefing: boolean;
    canEditDirectorBriefing: boolean;
}
export interface OperatingPoint {
    date: string;
    gmvYuan: number;
    gsvYuan: number;
    refundYuan: number;
    /** Closed orders divided by all orders, both attributed by order_time. */
    refundRatePct: number | null;
    closedOrderCount: number;
    totalOrderCount: number;
    qianchuanCostYuan: number | null;
    qianchuanCostSource: "daily" | "hourly" | null;
    dayEndAccountCount?: number;
    expectedAccountCount?: number;
    incompleteDayCount?: number;
    roi: number | null;
    adSharePct: number | null;
    profitYuan: number | null;
    profitMarginPct: number | null;
    orderCount: number;
    state: DataState;
}
export type PromotionScene = "live" | "product";
export interface PromotionScenePoint {
    date: string;
    scene: PromotionScene;
    qianchuanCostYuan: number | null;
    qianchuanOverallTransactionYuan: number | null;
    adSharePct: number | null;
    advertiserCount: number;
    recordCount: number;
    planCostCoveragePct?: number | null;
    dayEndAccountCount?: number;
    expectedAccountCount?: number;
    incompleteDayCount?: number;
    state: DataState;
    sourceUpdatedAt: string | null;
}
export interface PromotionSceneSnapshot {
    live: PromotionScenePoint[];
    product: PromotionScenePoint[];
}
export interface HourlyPoint {
    hour: number;
    label: string;
    gmvYuan: number;
    gsvYuan: number;
    refundYuan: number;
    qianchuanCostYuan: number | null;
    roi: number | null;
    adSharePct: number | null;
    orderCount: number;
    state: DataState;
}
export interface MonthlyPoint {
    month: string;
    targetGsvWan: number | null;
    gmvYuan: number | null;
    gsvYuan: number | null;
    gsvSource: "mcp" | "calibration" | "missing";
    refundYuan: number | null;
    refundRatePct: number | null;
    closedOrderCount: number | null;
    totalOrderCount: number | null;
    qianchuanCostYuan: number | null;
    roi: number | null;
    adSharePct: number | null;
    orderState: DataState;
    adState: DataState;
    note: string | null;
}
export interface MaterialRow {
    reportDate: string;
    materialId: string;
    materialName: string;
    materialType: string;
    videoUrl: string | null;
    tags: string[];
    productName: string;
    mappingBasis: "source" | "platform_product" | "keyword" | "account" | "unmapped";
    marketingGoal: string;
    gmvYuan: number;
    costYuan: number;
    roi: number | null;
    isNew: boolean;
}
export interface MaterialProductCount {
    productName: string;
    onlineCount: number;
}
export interface MaterialDailySnapshot {
    date: string;
    onlineTotal: number;
    directOnline: number;
    liveOnline: number;
    mappedOnline: number;
    unmappedOnline: number;
    chatKocOnline: number;
    liveImageOnline: number;
    productOnline: MaterialProductCount[];
}
export interface MaterialSnapshot {
    reportDate: string | null;
    availableFrom: string | null;
    availableTo: string | null;
    requestedTo: string;
    dailyOnline: MaterialDailySnapshot[];
    onlineTotal: number | null;
    directOnline: number | null;
    liveOnline: number | null;
    mappedOnline: number | null;
    unmappedOnline: number | null;
    mappingCoveragePct: number | null;
    chatKocOnline: number | null;
    liveImageOnline: number | null;
    productOnline: MaterialProductCount[];
    bigMaterialCount: number;
    newBreakoutCount: number;
    fastGrowthCount: number | null;
    bigMaterials: MaterialRow[];
    periodMaterials: MaterialRow[];
    newBreakouts: MaterialRow[];
    fastGrowthSignals: MaterialRow[];
    hourlySignalState: DataState;
    onlineMetricNote: string;
}
export interface TargetCard {
    period: "year" | "quarter" | "month";
    label: string;
    targetWan: number | null;
    completedWan: number;
    progressPct: number | null;
    remainingWan: number | null;
    state: DataState;
    profitMarginPct: number | null;
    profitMarginTargetPct: number | null;
    profitMarginVariancePctPoint: number | null;
}
export interface TargetSeriesPoint {
    month: string;
    label: string;
    targetWan: number;
    actualWan: number | null;
    profitMarginTargetPct: number;
    profitMarginPct: number | null;
}
export interface TargetSnapshot {
    metric: "GSV";
    cards: TargetCard[];
    monthly: TargetSeriesPoint[];
    todayTargetWan: number | null;
    todayCompletedWan: number;
    todayRemainingWan: number | null;
    remainingDays: number;
    sourceLabel: string;
}
export interface CriticalWorkItem {
    id: string;
    goal: string;
    direction: string;
    actions: string[];
}
export interface CockpitCoverage {
    orderMinDate: string | null;
    adMinDate: string | null;
    liveHourlyMinDate: string | null;
    materialMinDate: string | null;
    sourceUpdatedAt: string | null;
    notes: string[];
}
export interface OperatingTrendPoint {
    period: string;
    periodLabel: string;
    gmvYuan: number | null;
    gsvYuan: number | null;
    refundYuan: number | null;
    refundRatePct: number | null;
    closedOrderCount: number | null;
    totalOrderCount: number | null;
    qianchuanCostYuan: number | null;
    dayEndAccountCount?: number;
    expectedAccountCount?: number;
    incompleteDayCount?: number;
    adSharePct: number | null;
    profitYuan: number | null;
    profitMarginPct: number | null;
    orderCount: number | null;
    state: DataState;
}
export interface OperatingTrendResponse {
    items: OperatingTrendPoint[];
    granularity: "day" | "week" | "month";
    startDate: string;
    endDate: string;
}
export interface ProductTrendPoint {
    period: string;
    periodLabel: string;
    products: Array<{
        productName: string;
        salesAmount: number;
    }>;
}
export interface ProductTrendResponse {
    items: ProductTrendPoint[];
    granularity: "day" | "week" | "month";
    startDate: string;
    endDate: string;
    productNames: string[];
}
export interface ProductEconomicsProductPoint {
    productName: string;
    gsvYuan: number | null;
    qianchuanCostYuan: number | null;
    advertiserCount: number;
    planCount: number;
    costState: DataState;
    sourceUpdatedAt: string | null;
}
export interface ProductEconomicsDayPoint {
    date: string;
    products: ProductEconomicsProductPoint[];
}
export interface ProductEconomicsResponse {
    items: ProductEconomicsDayPoint[];
    startDate: string;
    endDate: string;
    productNames: string[];
    attributedProductNames: string[];
    sourceUpdatedAt: string | null;
    caveats: string[];
}
export interface PromotionSceneTrendPoint {
    period: string;
    periodLabel: string;
    qianchuanCostYuan: number | null;
    qianchuanOverallTransactionYuan: number | null;
    adSharePct: number | null;
    advertiserCount: number;
    recordCount: number;
    planCostCoveragePct?: number | null;
    dayEndAccountCount?: number;
    expectedAccountCount?: number;
    incompleteDayCount?: number;
    unmappedCostYuan?: number | null;
    unmappedOverallTransactionYuan?: number | null;
    unmappedRecordCount?: number;
    state: DataState;
    sourceUpdatedAt: string | null;
}
export interface PromotionSceneTrendResponse {
    items: PromotionSceneTrendPoint[];
    granularity: "day" | "week" | "month";
    startDate: string;
    endDate: string;
    scene: PromotionScene;
}
export interface MaterialOnlineTrendPoint {
    period: string;
    periodLabel: string;
    onlineTotal: number;
    directOnline: number;
    liveOnline: number;
    mappedOnline: number;
    unmappedOnline: number;
    chatKocOnline: number;
    liveImageOnline: number;
    productOnline: MaterialProductCount[];
    state: DataState;
    sourceUpdatedAt: string | null;
}
export interface MaterialOnlineTrendResponse {
    items: MaterialOnlineTrendPoint[];
    granularity: "day" | "week" | "month";
    startDate: string;
    endDate: string;
    availableFrom: string | null;
    availableTo: string | null;
}
export interface CockpitPayload {
    generatedAt: string;
    timezone: "Asia/Shanghai";
    sourceMode: "live" | "partial";
    session: CockpitSession;
    operatingTrend: OperatingPoint[];
    promotionScenes: PromotionSceneSnapshot;
    hourly: HourlyPoint[];
    monthlyHistory: MonthlyPoint[];
    materials: MaterialSnapshot;
    targets: TargetSnapshot;
    criticalWork: CriticalWorkItem[] | null;
    criticalWorkStatus: "available" | "forbidden" | "awaiting_source";
    coverage: CockpitCoverage;
    caveats: string[];
}
