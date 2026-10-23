import type { Request } from 'express';
export declare class DashboardController {
    get(force?: string): Promise<import("../../../shared/dashboard.types").DashboardPayload>;
    cockpit(req: Request, force?: string, prewarmProfile?: string): Promise<import("../../../shared/cockpit.types").CockpitPayload>;
    session(req: Request): import("../../../shared/cockpit.types").CockpitSession;
    operatingTrend(startDate?: string, endDate?: string, force?: string): Promise<import("../../../shared/cockpit.types").OperatingTrendResponse>;
    productTrend(startDate?: string, endDate?: string, force?: string): Promise<import("../../../shared/cockpit.types").ProductTrendResponse>;
    productEconomics(startDate?: string, endDate?: string, force?: string): Promise<import("../../../shared/cockpit.types").ProductEconomicsResponse>;
    promotionSceneTrend(scene: 'live' | 'product', startDate?: string, endDate?: string, force?: string): Promise<import("../../../shared/cockpit.types").PromotionSceneTrendResponse>;
    materialOnlineTrend(startDate?: string, endDate?: string): Promise<import("../../../shared/cockpit.types").MaterialOnlineTrendResponse>;
    materials(req: Request, startDate?: string, endDate?: string, force?: string): Promise<import("../../../shared/cockpit.types").MaterialSnapshot>;
}
