export declare const BRANDMARKETING_DB = "d_root_project_mid_db_brandmarketing";
export declare const ACCOUNT_HOURLY_TABLE = "d_root_project_mid_db_brandmarketing.qianchuan_account_hourly_cost";
export declare const PLAN_HOURLY_TABLE = "d_root_project_mid_db_brandmarketing.qianchuan_ad_plan_hourly_delivery_cost_detail";
export declare const CHENGFANG_PLAN_HOURLY_TABLE = "d_root_project_mid_db_brandmarketing.qianchuan_chengfang_ad_plan_hourly_delivery_cost_detail";
export declare const MATERIAL_HOURLY_TABLE = "d_root_project_mid_db_brandmarketing.qianchuan_material_hourly_report";
export declare const CHENGFANG_MATERIAL_HOURLY_TABLE = "d_root_project_mid_db_brandmarketing.qianchuan_chengfang_material_hourly_report";
export declare const MATERIAL_ASSET_TABLE = "d_root_project_mid_db_brandmarketing.qianchuan_material_asset_ledger";
/**
 * 已确认不属于品牌营销部统计范围的千川账户。
 * 使用账户 ID 做硬排除，避免名称或上游部门映射尚未修正时继续混入日汇总。
 */
export declare const EXCLUDED_QIANCHUAN_ADVERTISER_IDS: readonly ["1858626354489991", "1847839711283335", "1760231670176782", "1819307429769236", "1874099977003595"];
/** 品牌营销部日汇总验收要求：91 个业绩相关账户须有截至当日 23:45 的累计快照。 */
export declare const QIANCHUAN_EXPECTED_DAY_END_ACCOUNT_COUNT = 91;
/**
 * 《WIS千川在用账户》里已确认的推直播间计划。
 * 计划场景以业务映射优先，不能只依赖 marketing_goal_code：平台迁移后，
 * 已确认的直播计划可能暂时回传 VIDEO_PROM_GOODS，若只按目标码会被误归到推商品。
 */
export declare const LIVE_PROMOTION_PLAN_IDS: readonly ["1870021116462106", "1870616906892567", "1871955152329131", "1866844683602179", "1870291431535736", "1870289794646204"];
export declare const LIVE_PROMOTION_ACCOUNT_IDS: readonly ["1861245440814282", "1871833428793802", "1758788274050062", "1869672250595328"];
export declare function livePromotionPlanCondition(alias: string): string;
/**
 * 直播计划迁入千川乘方后，计划表可能暂时缺行，但账户表仍按场景返回完整消耗。
 * 这些账户与单品的关系来自已确认映射；仅使用账户表的 LIVE_PROM_GOODS 消耗，
 * 不把账户总消耗或 VIDEO_PROM_GOODS 消耗混入单品。深海次抛与黑晶共用同一
 * 直播计划，账户表无法拆分，故不在这里归入任一单品，避免重复计算。
 */
export declare function livePromotionAccountProductCase(alias: string): string;
/**
 * SQL 执行前由 mcp.ts 替换成缓存后的 WIS 千川账户 ID 列表。
 * 使用 ID 过滤可以避免每条大查询都执行 advertiser_name LIKE '%WIS%' 全表扫描。
 */
export declare const WIS_ADVERTISER_IDS_SQL_TOKEN = "__WIS_QIANCHUAN_ADVERTISER_IDS__";
export declare function excludedAdvertiserCondition(alias: string): string;
export declare function wisAdvertiserCondition(alias: string): string;
type MaterialSnapshotOptions = {
    prefix: string;
    startDate: string;
    endDate: string;
    today: string;
};
/**
 * 素材表的唯一键以 stat_time 开头，先按索引定位每个账户的最后完整快照，
 * 再通过唯一键前缀回表。历史日只检查日终 30 分钟，避免扫描全天五分钟快照；
 * 当日保留 3 分钟入库缓冲，防止读到尚未完成的最新批次。
 */
export declare function buildMaterialSnapshotCtes(options: MaterialSnapshotOptions): {
    snapshotTimesCte: string;
    snapshotRowsCte: string;
    sql: string;
};
type DateBounds = {
    startExpression: string;
    endExpression: string;
    endInclusive?: boolean;
};
type AccountLatestOptions = DateBounds & {
    prefix: string;
};
type AccountSnapshotOptions = {
    prefix: string;
    startDate: string;
    endDate: string;
    today: string;
};
/**
 * 账户表在 2026-08-29 当天从“五分钟累计快照”切换为“整点小时增量”：
 * - 8/29 是混合迁移日，先取最后一条累计快照，再加其后的整点小时增量；
 * - 8/30 起若只返回整点小时行，则按账户汇总全部小时，不再把 23:00 单小时当全天。
 */
export declare const ACCOUNT_HOURLY_INCREMENT_TRANSITION_DATE = "2026-08-29";
/**
 * 旧口径取截至当日 23:45 的累计快照（次日 00:00 优先）；迁移日以后
 * 自动把完整整点小时增量汇总为全天值。覆盖不足仍返回小计，但明确标记不完整。
 */
export declare function buildAccountSnapshotCtes(options: AccountSnapshotOptions): {
    normalizedCte: string;
    sql: string;
};
/**
 * 兼容账户表的累计快照、8/29混合迁移和8/30后的小时增量三种形态。
 */
export declare function buildAccountLatestCtes(options: AccountLatestOptions): {
    normalizedCte: string;
    sql: string;
};
type PlanDailyOptions = DateBounds & {
    prefix: string;
    marketingGoalCode?: 'LIVE_PROM_GOODS' | 'VIDEO_PROM_GOODS';
    marketingGoalCodes?: readonly ('LIVE_PROM_GOODS' | 'VIDEO_PROM_GOODS')[];
    forceIndex?: 'idx_qc_plan_material_daily_ad';
    dedupeAcrossSources?: boolean;
};
/**
 * 计划小时表包含两种历史口径：
 * - HOUR：小时增量，需要按天求和；
 * - FIVE_MINUTE：日内累计快照，需要取业务键的最后快照。
 * 同一天同时存在两种口径时优先采用 FIVE_MINUTE，避免迁移期重复计算。
 */
export declare function buildPlanDailyNormalizedCtes(options: PlanDailyOptions): {
    normalizedCte: string;
    sql: string;
};
/**
 * WIS 单品千川归因的唯一公共规则。
 *
 * 精确直播计划优先；推商品只在已映射账户中按标准单品或计划关键词归因。
 * 未命中记录保持 NULL，不按 0 处理，也不分摊给任何单品。
 */
export declare function buildQianchuanProductAttributionCase(alias?: string): string;
export {};
