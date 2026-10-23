export interface DashboardHeadlineMetrics {
    todayDate: string;
    todayGmv: number;
    todayGsv: number;
    todayRefundAmount: number;
    todayRefundRate: number;
    todayOrderCount: number;
    todayAdSpend: number | null;
    todayAdqSpend: number | null;
    todayShopPromotionSpend: number | null;
    todayCreatorCommissionSpend: number | null;
    todayWechatBeanSpend: number | null;
    todayAdShare: number | null;
    todaySnapshotTime: string;
    todayAdqSnapshotTime: string;
    todayAdqLatestHour: number | null;
    todayAdqAccountCount: number;
    sourceName: string;
    sourceStatus: 'complete' | 'partial' | 'missing';
}
export interface DashboardPerformanceMetrics {
    gsv15d: number;
    monthGsv: number;
    quarterGsv: number;
    monthAvgDaily: number;
    monthTargetWan: number;
    monthTargetPeriod: string;
    monthTargetCompletedWan: number;
    monthTargetProgressPct: number;
    monthTargetRemainingWan: number;
    quarterTargetWan: number;
    quarterTargetCompletedWan: number;
    quarterTargetProgressPct: number;
    quarterTargetRemainingWan: number;
    quarterProfitTargetWan: number;
    quarterProfitMarginTargetPct: number;
    targetObservedDays: number;
    targetPeriodLabel: string;
    peakDay: string;
    peakValue: number;
    lowestDay: string;
    lowestValue: number;
    volatility: number;
    median: number;
    lastUpdateTime: string;
    peakAlert: {
        date: string;
        value: number;
        message: string;
    } | null;
    sourceName: string;
    sourceStatus: 'complete' | 'partial' | 'missing';
}
export type DashboardMetrics = DashboardHeadlineMetrics & DashboardPerformanceMetrics;
export interface DailyGsvItem {
    date: string;
    value: number;
    gmv: number;
    refundAmount: number;
    refundRate: number;
    orderCount: number;
    sourceUpdatedAt: string;
    isPartial: boolean;
    sourceMode?: 'root' | 'kdocs-calibrated' | 'kdocs-fallback';
    sourceNote?: string;
    /** Uncalibrated next-day root snapshot, retained only for source reconciliation. */
    rawRootValue?: number | null;
}
export interface DailyGsvListResponse {
    items: DailyGsvItem[];
    total: number;
}
export interface DailyAdqItem {
    date: string;
    /** Available channel spend total: ADQ + shop promotion + creator commission + Haitun WeChat Bean. */
    spend: number;
    adqSpend: number | null;
    /** ADQ panel attributed transaction amount; independent from total-store GSV. */
    adqRevenue: number | null;
    /** ADQ spend / ADQ attributed transaction amount. */
    adqSpendRatio: number | null;
    shopPromotionSpend: number | null;
    creatorCommissionSpend: number | null;
    wechatBeanSpend: number | null;
    /** Video-channel GSV used by the channel-wide operating chart. */
    revenue: number;
    /** Available total channel spend / video-channel GSV. */
    spendRatio: number;
    /** Profit amount calculated with the dated WIS WeChat daily-report cost model. */
    profitYuan: number | null;
    /** profitYuan / revenue; null when spend coverage or the monthly cost model is incomplete. */
    profitMarginPct: number | null;
    profitSourceMode?: 'kdocs-cost-model' | 'kdocs-daily-reference';
    isPartial: boolean;
    hasSpendData: boolean;
    costCoverageStatus: 'partial' | 'complete';
    missingCostComponents: Array<'adq' | 'shopPromotion' | 'creatorCommission' | 'wechatBean'>;
    sourceUpdatedAt: string;
    sourceMode?: 'root' | 'kdocs-calibrated' | 'kdocs-fallback';
    sourceNote?: string;
    rawRootSpend?: number | null;
    rawRootSpendRatio?: number | null;
}
export interface DailyAdqListResponse {
    items: DailyAdqItem[];
    total: number;
}
export interface AdqMetrics {
    spend7d: number;
    revenue7d: number;
    avgRatio7d: number;
    spendTrend: number;
    revenueTrend: number;
}
export interface ProductTrendItem {
    productId: string;
    productName: string;
    data: {
        date: string;
        salesAmount: number | null;
    }[];
}
export interface WechatDashboardOverviewResponse {
    headline: DashboardHeadlineMetrics;
    performance: DashboardPerformanceMetrics;
    dailyGsv: DailyGsvListResponse;
    dailyAdq: DailyAdqListResponse;
    adqMetrics: AdqMetrics;
}
export interface ProductTrendListResponse {
    items: ProductTrendItem[];
    dates: string[];
    sourceStatus: 'complete' | 'partial' | 'missing';
    missingDates: string[];
    latestAvailableDate: string | null;
}
