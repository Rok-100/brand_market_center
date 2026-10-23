import type { CockpitPayload, CockpitSession, MaterialOnlineTrendResponse, MaterialSnapshot, OperatingTrendResponse, ProductEconomicsResponse, ProductTrendResponse, PromotionSceneTrendResponse } from '@shared/cockpit.types';
export interface SessionIdentity {
    userId?: string;
    userName?: string | null;
    jobTitle?: string | null;
    roles?: unknown[];
}
export declare function resolveSession(identity?: SessionIdentity): CockpitSession;
export declare function profitForPeriod(month: string, throughDay: number, gsvYuan: number, qianchuanCostYuan: number | null): {
    profitYuan: number;
    profitMarginPct: number;
};
export declare function dailyProfit(date: string, gsvYuan: number, qianchuanCostYuan: number | null): {
    profitYuan: number;
    profitMarginPct: number;
};
export declare function buildHourlyOrderRangeSql(startDate: string, endDate: string): string;
export declare function buildHourlyOrderSql(date: string): string;
export declare function buildHourlyAdSql(date: string): string;
export declare function buildPromotionSceneSql(marketingGoalCode: 'LIVE_PROM_GOODS' | 'VIDEO_PROM_GOODS', startDate?: string, endDate?: string): string;
/**
 * 推直播间与推商品趋势。
 * 两个场景的消耗均以账户小时表返回的场景总消耗为准；整体成交金额使用计划
 * 明细的含券成交字段（缺失时回退不含券字段）汇总。计划覆盖不足时保留已返回
 * 的小计并标记 partial，不使用素材成交额或抖店 GSV 代替。
 */
export declare function buildPromotionScenesSql(startDate?: string, endDate?: string): string;
export declare function buildMaterialSql(startDate?: string, endDate?: string, todayValue?: string): string;
export declare function buildMaterialOnlineSql(startDate?: string, endDate?: string): string;
export declare function isRootDataUnavailableError(error: string | null | undefined): boolean;
export declare function warmCockpit(identity?: SessionIdentity): void;
export declare function getCockpit(identity?: SessionIdentity, force?: boolean): Promise<CockpitPayload>;
export declare function getMaterialSnapshot(startDate?: string, endDate?: string, force?: boolean): Promise<MaterialSnapshot>;
export declare function shanghaiTodayStr(): string;
export declare function buildOperatingSql(start: string, end: string): string;
export declare function buildAdDailySql(start: string, end: string): string;
export declare function buildProductTrendSql(start: string, end: string): string;
/**
 * MySQL 直连使用原生 JSON_TABLE 展开 SKU；分类和聚合尾部复用兼容版 SQL，
 * 确保两条路径的单品口径始终一致。MCP 回退仍保留递归序列表达式。
 */
export declare function buildProductTrendDirectSql(start: string, end: string): string;
export declare function buildProductAttributionSql(start: string, end: string): string;
/**
 * 经营趋势使用短缓存承接页面重复加载，并通过 in-flight Promise 合并同一时间范围的并发查询。
 * 今天及最近两个完整自然日仍可能发生订单状态回补，结果缓存2分钟；更早历史缓存30分钟。
 * 用户主动刷新时绕过持久缓存，并使用独立 in-flight 键避免复用旧查询。
 */
export declare function getOperatingTrend(startDate?: string, endDate?: string, force?: boolean): Promise<OperatingTrendResponse>;
export declare function getProductEconomics(startDate?: string, endDate?: string, force?: boolean): Promise<ProductEconomicsResponse>;
/** 单品趋势与经营趋势使用相同的短缓存策略，避免重复展开订单SKU。 */
export declare function getProductTrend(startDate?: string, endDate?: string, force?: boolean): Promise<ProductTrendResponse>;
export declare function getPromotionSceneTrend(scene: 'live' | 'product', startDate?: string, endDate?: string, force?: boolean): Promise<PromotionSceneTrendResponse>;
export declare function getMaterialOnlineTrend(startDate?: string, endDate?: string): Promise<MaterialOnlineTrendResponse>;
