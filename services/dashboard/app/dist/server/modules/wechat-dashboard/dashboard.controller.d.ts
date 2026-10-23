import { WechatDashboardService } from './dashboard.service';
import type { ProductTrendListResponse, WechatDashboardOverviewResponse } from '@shared/dashboard';
export declare class WechatDashboardController {
    private readonly dashboardService;
    constructor(dashboardService: WechatDashboardService);
    private refreshOverview;
    getOverview(force?: string): Promise<WechatDashboardOverviewResponse>;
    getMetrics(): Promise<import("@shared/dashboard").DashboardMetrics>;
    getHeadlineMetrics(): Promise<import("@shared/dashboard").DashboardHeadlineMetrics>;
    getPerformanceMetrics(): Promise<import("@shared/dashboard").DashboardPerformanceMetrics>;
    getDailyGsv(startDate?: string, endDate?: string): Promise<import("@shared/dashboard").DailyGsvListResponse>;
    getDailyAdq(startDate?: string, endDate?: string): Promise<import("@shared/dashboard").DailyAdqListResponse>;
    getAdqMetrics(): Promise<import("@shared/dashboard").AdqMetrics>;
    getProductTrends(startDate?: string, endDate?: string, force?: string): Promise<ProductTrendListResponse>;
}
