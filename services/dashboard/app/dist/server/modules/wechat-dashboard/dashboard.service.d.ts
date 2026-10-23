import type { AdqMetrics, DailyAdqListResponse, DailyGsvListResponse, DashboardHeadlineMetrics, DashboardMetrics, DashboardPerformanceMetrics, ProductTrendListResponse, WechatDashboardOverviewResponse } from '@shared/dashboard';
type ShopDailyRow = {
    stat_date: string;
    collection_time: string;
    pay_gmv_yuan: string | number | null;
    pay_refund_gmv_yuan: string | number | null;
    pay_order_cnt: string | number | null;
    updated_at: string | null;
};
export interface WechatHourlyGsvSourcePoint {
    date: string;
    hour: number;
    gsvYuan: number;
    sourceUpdatedAt: string | null;
}
export declare class WechatDashboardService {
    private readonly logger;
    private shanghaiToday;
    private verifiedStart;
    private offsetDate;
    private monthStart;
    private quarterStart;
    private validDate;
    private number;
    private calculateWechatProfit;
    private isoShanghai;
    private dateRange;
    /**
     * 将缺失日期压缩为连续时间段，避免生成很长的 OR 列表；每段都能使用
     * (shop_id, pay_time) 现有联合索引完成范围扫描。
     */
    private buildMissingDatePredicate;
    private latestTimestamp;
    private fetchShopDaily;
    private fetchTodayAdq;
    getHeadlineMetrics(prefetchedGsv?: Promise<DailyGsvListResponse>, prefetchedAdq?: Promise<DailyAdqListResponse>): Promise<DashboardHeadlineMetrics>;
    getPerformanceMetrics(prefetchedRows?: Promise<ShopDailyRow[]>): Promise<DashboardPerformanceMetrics>;
    getMetrics(): Promise<DashboardMetrics>;
    getDailyGsv(startDate?: string, endDate?: string, prefetchedRows?: Promise<ShopDailyRow[]>): Promise<DailyGsvListResponse>;
    getHourlyGsv(startDate?: string, endDate?: string): Promise<WechatHourlyGsvSourcePoint[]>;
    private fetchAdqTrend;
    getDailyAdq(startDate?: string, endDate?: string, prefetchedGsv?: Promise<DailyGsvListResponse>): Promise<DailyAdqListResponse>;
    private buildAdqMetrics;
    getAdqMetrics(): Promise<AdqMetrics>;
    getOverview(): Promise<WechatDashboardOverviewResponse>;
    getProductTrends(startDate?: string, endDate?: string): Promise<ProductTrendListResponse>;
}
export {};
