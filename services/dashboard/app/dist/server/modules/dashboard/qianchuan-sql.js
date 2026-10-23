"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ACCOUNT_HOURLY_INCREMENT_TRANSITION_DATE = exports.WIS_ADVERTISER_IDS_SQL_TOKEN = exports.LIVE_PROMOTION_ACCOUNT_IDS = exports.LIVE_PROMOTION_PLAN_IDS = exports.QIANCHUAN_EXPECTED_DAY_END_ACCOUNT_COUNT = exports.EXCLUDED_QIANCHUAN_ADVERTISER_IDS = exports.MATERIAL_ASSET_TABLE = exports.CHENGFANG_MATERIAL_HOURLY_TABLE = exports.MATERIAL_HOURLY_TABLE = exports.CHENGFANG_PLAN_HOURLY_TABLE = exports.PLAN_HOURLY_TABLE = exports.ACCOUNT_HOURLY_TABLE = exports.BRANDMARKETING_DB = void 0;
exports.livePromotionPlanCondition = livePromotionPlanCondition;
exports.livePromotionAccountProductCase = livePromotionAccountProductCase;
exports.excludedAdvertiserCondition = excludedAdvertiserCondition;
exports.wisAdvertiserCondition = wisAdvertiserCondition;
exports.buildMaterialSnapshotCtes = buildMaterialSnapshotCtes;
exports.buildAccountSnapshotCtes = buildAccountSnapshotCtes;
exports.buildAccountLatestCtes = buildAccountLatestCtes;
exports.buildPlanDailyNormalizedCtes = buildPlanDailyNormalizedCtes;
exports.buildQianchuanProductAttributionCase = buildQianchuanProductAttributionCase;
exports.BRANDMARKETING_DB = 'd_root_project_mid_db_brandmarketing';
exports.ACCOUNT_HOURLY_TABLE = `${exports.BRANDMARKETING_DB}.qianchuan_account_hourly_cost`;
exports.PLAN_HOURLY_TABLE = `${exports.BRANDMARKETING_DB}.qianchuan_ad_plan_hourly_delivery_cost_detail`;
exports.CHENGFANG_PLAN_HOURLY_TABLE = `${exports.BRANDMARKETING_DB}.qianchuan_chengfang_ad_plan_hourly_delivery_cost_detail`;
exports.MATERIAL_HOURLY_TABLE = `${exports.BRANDMARKETING_DB}.qianchuan_material_hourly_report`;
exports.CHENGFANG_MATERIAL_HOURLY_TABLE = `${exports.BRANDMARKETING_DB}.qianchuan_chengfang_material_hourly_report`;
exports.MATERIAL_ASSET_TABLE = `${exports.BRANDMARKETING_DB}.qianchuan_material_asset_ledger`;
/**
 * 已确认不属于品牌营销部统计范围的千川账户。
 * 使用账户 ID 做硬排除，避免名称或上游部门映射尚未修正时继续混入日汇总。
 */
exports.EXCLUDED_QIANCHUAN_ADVERTISER_IDS = [
    '1858626354489991', // 电商部达播WIS-仟得-4
    '1847839711283335', // 电商部达播WIS-博采-新户3
    '1760231670176782', // 营销部-剧星04-品牌广告种草通（不计业绩）
    '1819307429769236', // 品创部赫系-引力-海图koc-洗发水（不计业绩）
    '1874099977003595', // 营销部WIS-厚拓-4（不计业绩）
];
/** 品牌营销部日汇总验收要求：91 个业绩相关账户须有截至当日 23:45 的累计快照。 */
exports.QIANCHUAN_EXPECTED_DAY_END_ACCOUNT_COUNT = 91;
/**
 * 《WIS千川在用账户》里已确认的推直播间计划。
 * 计划场景以业务映射优先，不能只依赖 marketing_goal_code：平台迁移后，
 * 已确认的直播计划可能暂时回传 VIDEO_PROM_GOODS，若只按目标码会被误归到推商品。
 */
exports.LIVE_PROMOTION_PLAN_IDS = [
    '1870021116462106',
    '1870616906892567',
    '1871955152329131',
    '1866844683602179',
    '1870291431535736',
    '1870289794646204',
];
exports.LIVE_PROMOTION_ACCOUNT_IDS = [
    '1861245440814282',
    '1871833428793802',
    '1758788274050062',
    '1869672250595328',
];
function livePromotionPlanCondition(alias) {
    return `${alias}.ad_id IN (${exports.LIVE_PROMOTION_PLAN_IDS.map((id) => `'${id}'`).join(', ')})`;
}
/**
 * 直播计划迁入千川乘方后，计划表可能暂时缺行，但账户表仍按场景返回完整消耗。
 * 这些账户与单品的关系来自已确认映射；仅使用账户表的 LIVE_PROM_GOODS 消耗，
 * 不把账户总消耗或 VIDEO_PROM_GOODS 消耗混入单品。深海次抛与黑晶共用同一
 * 直播计划，账户表无法拆分，故不在这里归入任一单品，避免重复计算。
 */
function livePromotionAccountProductCase(alias) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) {
        throw new Error('无效 SQL 别名');
    }
    return `CASE
      WHEN ${alias}.advertiser_id = '1861245440814282'
       AND ${alias}.report_date <= '2026-07-29' THEN '水润面膜'
      WHEN ${alias}.advertiser_id = '1871833428793802'
       AND ${alias}.report_date >= '2026-07-30' THEN '水润面膜'
      WHEN ${alias}.advertiser_id = '1758788274050062' THEN '晶润紧致眼膜'
      -- 《WIS千川在用账户》在 2026-08-26 更新为黑晶专属直播间。
      -- 仅从映射生效日起归入黑晶，避免倒改此前深海次抛与黑晶共播的历史数据。
      WHEN ${alias}.advertiser_id = '1869672250595328'
       AND ${alias}.report_date >= '2026-08-26' THEN '黑晶光蕴面膜'
    END`;
}
/**
 * SQL 执行前由 mcp.ts 替换成缓存后的 WIS 千川账户 ID 列表。
 * 使用 ID 过滤可以避免每条大查询都执行 advertiser_name LIKE '%WIS%' 全表扫描。
 */
exports.WIS_ADVERTISER_IDS_SQL_TOKEN = '__WIS_QIANCHUAN_ADVERTISER_IDS__';
function excludedAdvertiserCondition(alias) {
    return `${alias}.advertiser_id NOT IN (${exports.EXCLUDED_QIANCHUAN_ADVERTISER_IDS.map((id) => `'${id}'`).join(', ')})`;
}
function wisAdvertiserCondition(alias) {
    return `(${alias}.advertiser_id IN (${exports.WIS_ADVERTISER_IDS_SQL_TOKEN}) AND ${excludedAdvertiserCondition(alias)})`;
}
// 乘方专表只保存品牌营销部门的乘方投放，不再重复套用账户白名单，避免新账户尚未进入账户表时被漏算。
const planSources = [
    {
        sourceName: 'standard',
        table: exports.PLAN_HOURLY_TABLE,
        advertiserCondition: wisAdvertiserCondition,
    },
    {
        sourceName: 'chengfang',
        table: exports.CHENGFANG_PLAN_HOURLY_TABLE,
        advertiserCondition: excludedAdvertiserCondition,
    },
];
const materialSources = [
    {
        sourceName: 'standard',
        table: exports.MATERIAL_HOURLY_TABLE,
        advertiserCondition: wisAdvertiserCondition,
    },
    {
        sourceName: 'chengfang',
        table: exports.CHENGFANG_MATERIAL_HOURLY_TABLE,
        advertiserCondition: excludedAdvertiserCondition,
    },
];
function parseIsoDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new Error(`无效日期：${value}`);
    }
    const date = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(date.getTime()) ||
        date.toISOString().slice(0, 10) !== value) {
        throw new Error(`无效日期：${value}`);
    }
    return date;
}
function offsetIsoDate(value, days) {
    const date = parseIsoDate(value);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}
function listIsoDates(startDate, endDate) {
    const start = parseIsoDate(startDate);
    const end = parseIsoDate(endDate);
    if (start > end)
        return [endDate];
    const dates = [];
    for (let date = startDate; date <= endDate; date = offsetIsoDate(date, 1)) {
        dates.push(date);
        if (dates.length > 366)
            throw new Error('素材查询最长支持 366 天');
    }
    return dates;
}
/**
 * 素材表的唯一键以 stat_time 开头，先按索引定位每个账户的最后完整快照，
 * 再通过唯一键前缀回表。历史日只检查日终 30 分钟，避免扫描全天五分钟快照；
 * 当日保留 3 分钟入库缓冲，防止读到尚未完成的最新批次。
 */
function buildMaterialSnapshotCtes(options) {
    const { prefix, startDate, endDate, today } = options;
    parseIsoDate(today);
    const dates = listIsoDates(startDate, endDate);
    const snapshotTimesCte = `${prefix}_snapshot_times`;
    const snapshotRowsCte = `${prefix}_snapshot_rows`;
    const timeQueries = dates.flatMap((date) => {
        const nextDate = offsetIsoDate(date, 1);
        const isToday = date === today;
        const historicalTimes = Array.from({ length: 7 }, (_, index) => {
            const time = parseIsoDate(nextDate);
            time.setUTCMinutes(-30 + index * 5);
            return `'${time.toISOString().slice(0, 19).replace('T', ' ')}'`;
        });
        const shanghaiCutoff = "DATE_SUB(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'), INTERVAL 3 MINUTE)";
        const currentFiveMinuteSlot = `TIMESTAMP(
      DATE(${shanghaiCutoff}),
      MAKETIME(HOUR(${shanghaiCutoff}), FLOOR(MINUTE(${shanghaiCutoff}) / 5) * 5, 0)
    )`;
        const currentTimes = Array.from({ length: 7 }, (_, index) => index === 0
            ? currentFiveMinuteSlot
            : `DATE_SUB(${currentFiveMinuteSlot}, INTERVAL ${index * 5} MINUTE)`);
        const timeCondition = isToday
            ? `m.stat_time IN (${currentTimes.join(', ')})`
            : `m.stat_time IN (${historicalTimes.join(', ')})`;
        return materialSources.map((source) => `SELECT
    '${source.sourceName}' AS source_name,
    DATE('${date}') AS report_date,
    m.advertiser_id,
    MAX(m.stat_time) AS stat_time
  FROM ${source.table} m FORCE INDEX (uk_qc_material_hourly)
  WHERE ${source.advertiserCondition('m')}
    AND ${timeCondition}
    AND m.report_date = DATE('${date}')
  GROUP BY m.advertiser_id`);
    });
    const snapshotRowQueries = materialSources.map((source) => `SELECT
    s.source_name,
    m.report_date,
    m.stat_time,
    m.advertiser_id,
    m.marketing_goal,
    m.platform_material_type,
    m.material_id,
    ${source.sourceName === 'chengfang' ? 'm.material_name' : 'NULL'} AS material_name,
    ${source.sourceName === 'chengfang' ? 'm.material_online_time' : 'NULL'} AS material_online_time,
    m.business_material_type,
    m.content_description,
    m.internal_product_name,
    m.platform_product_ids_json,
    m.stat_cost_for_roi2,
    m.total_pay_order_gmv_for_roi2,
    m.total_pay_order_gmv_include_coupon_for_roi2,
    m.observed_at
  FROM ${snapshotTimesCte} s
  JOIN ${source.table} m FORCE INDEX (uk_qc_material_hourly)
    ON m.stat_time = s.stat_time
   AND m.advertiser_id = s.advertiser_id
  WHERE s.source_name = '${source.sourceName}'
    AND m.report_date = s.report_date`);
    return {
        snapshotTimesCte,
        snapshotRowsCte,
        sql: `${snapshotTimesCte} AS (
  ${timeQueries.join('\n  UNION ALL\n  ')}
),
${snapshotRowsCte} AS (
  ${snapshotRowQueries.join('\n  UNION ALL\n  ')}
)`,
    };
}
/**
 * 账户表在 2026-08-29 当天从“五分钟累计快照”切换为“整点小时增量”：
 * - 8/29 是混合迁移日，先取最后一条累计快照，再加其后的整点小时增量；
 * - 8/30 起若只返回整点小时行，则按账户汇总全部小时，不再把 23:00 单小时当全天。
 */
exports.ACCOUNT_HOURLY_INCREMENT_TRANSITION_DATE = '2026-08-29';
function accountNormalizedValueExpression(field) {
    if (!/^[a-z_][a-z0-9_]*$/i.test(field))
        throw new Error('无效账户指标字段');
    const contributes = `(p.checkpoint_time IS NULL
        OR m.stat_time = p.checkpoint_time
        OR (
          m.stat_time > p.checkpoint_time
          AND m.stat_time < TIMESTAMP(DATE_ADD(m.report_date, INTERVAL 1 DAY))
          AND MINUTE(m.stat_time) = 0
          AND SECOND(m.stat_time) = 0
        ))`;
    return `CASE
      WHEN SUM(CASE WHEN ${contributes} AND m.${field} IS NULL THEN 1 ELSE 0 END) > 0
        THEN NULL
      WHEN p.checkpoint_time IS NULL
        THEN SUM(CASE
          WHEN m.stat_time >= TIMESTAMP(m.report_date)
           AND m.stat_time < TIMESTAMP(DATE_ADD(m.report_date, INTERVAL 1 DAY))
           AND MINUTE(m.stat_time) = 0
           AND SECOND(m.stat_time) = 0
          THEN COALESCE(m.${field}, 0) ELSE 0 END)
      ELSE
        MAX(CASE WHEN m.stat_time = p.checkpoint_time THEN m.${field} END)
        + SUM(CASE
          WHEN m.stat_time > p.checkpoint_time
           AND m.stat_time < TIMESTAMP(DATE_ADD(m.report_date, INTERVAL 1 DAY))
           AND MINUTE(m.stat_time) = 0
           AND SECOND(m.stat_time) = 0
          THEN COALESCE(m.${field}, 0) ELSE 0 END)
    END`;
}
function buildAccountNormalizationCtes(prefix, oldLatestRowsSql, modernSourceRowsSql) {
    const oldRowsCte = `${prefix}_old_rows`;
    const modernRowsCte = `${prefix}_modern_rows`;
    const modernProfileBaseCte = `${prefix}_modern_profile_base`;
    const modernProfileCte = `${prefix}_modern_profile`;
    const modernNormalizedCte = `${prefix}_modern_normalized`;
    const normalizedCte = `${prefix}_normalized`;
    const contributing = `(p.checkpoint_time IS NULL
          OR m.stat_time = p.checkpoint_time
          OR (
            m.stat_time > p.checkpoint_time
            AND m.stat_time < TIMESTAMP(DATE_ADD(m.report_date, INTERVAL 1 DAY))
            AND MINUTE(m.stat_time) = 0
            AND SECOND(m.stat_time) = 0
          ))`;
    const coverageComplete = `(p.checkpoint_time IS NULL
        AND p.hourly_bucket_count = 24
      ) OR (
        p.checkpoint_time IS NOT NULL
        AND (
          p.checkpoint_time = TIMESTAMP(DATE_ADD(p.report_date, INTERVAL 1 DAY))
          OR p.post_checkpoint_hour_count = GREATEST(0, 23 - HOUR(p.checkpoint_time))
        )
      )`;
    const contributingRowsComplete = `MIN(CASE
      WHEN ${contributing} AND COALESCE(m.data_status, '') <> 'COMPLETE' THEN 0
      ELSE 1 END) = 1`;
    return {
        normalizedCte,
        sql: `${oldRowsCte} AS (
  ${oldLatestRowsSql}
),
${modernRowsCte} AS (
  ${modernSourceRowsSql}
),
${modernProfileBaseCte} AS (
  SELECT
    m.report_date,
    m.advertiser_id,
    MAX(m.advertiser_name) AS advertiser_name,
    MAX(m.stat_time) AS latest_stat_time,
    MAX(m.observed_at) AS source_updated_at,
    COUNT(*) AS source_row_count,
    COUNT(DISTINCT CASE
      WHEN m.stat_time >= TIMESTAMP(m.report_date)
       AND m.stat_time < TIMESTAMP(DATE_ADD(m.report_date, INTERVAL 1 DAY))
       AND MINUTE(m.stat_time) = 0
       AND SECOND(m.stat_time) = 0
      THEN m.stat_time END) AS hourly_bucket_count,
    MAX(CASE
      WHEN m.stat_time = TIMESTAMP(DATE_ADD(m.report_date, INTERVAL 1 DAY))
      THEN m.stat_time END) AS midnight_checkpoint_time,
    MAX(CASE
      WHEN m.report_date = DATE('${exports.ACCOUNT_HOURLY_INCREMENT_TRANSITION_DATE}')
       AND (MINUTE(m.stat_time) <> 0 OR SECOND(m.stat_time) <> 0)
      THEN m.stat_time END) AS mixed_checkpoint_time
  FROM ${modernRowsCte} m
  GROUP BY m.report_date, m.advertiser_id
),
${modernProfileCte} AS (
  SELECT
    b.*,
    COALESCE(b.midnight_checkpoint_time, b.mixed_checkpoint_time) AS checkpoint_time,
    (
      SELECT COUNT(DISTINCT h.stat_time)
      FROM ${modernRowsCte} h
      WHERE h.report_date = b.report_date
        AND h.advertiser_id = b.advertiser_id
        AND h.stat_time > COALESCE(b.midnight_checkpoint_time, b.mixed_checkpoint_time)
        AND h.stat_time < TIMESTAMP(DATE_ADD(b.report_date, INTERVAL 1 DAY))
        AND MINUTE(h.stat_time) = 0
        AND SECOND(h.stat_time) = 0
    ) AS post_checkpoint_hour_count
  FROM ${modernProfileBaseCte} b
),
${modernNormalizedCte} AS (
  SELECT
    p.report_date,
    p.latest_stat_time AS stat_time,
    p.advertiser_id,
    p.advertiser_name,
    ${accountNormalizedValueExpression('video_prom_goods_cost_yuan')} AS video_prom_goods_cost_yuan,
    ${accountNormalizedValueExpression('live_prom_goods_cost_yuan')} AS live_prom_goods_cost_yuan,
    ${accountNormalizedValueExpression('total_cost_yuan')} AS total_cost_yuan,
    CASE
      WHEN (${coverageComplete})
       AND ${contributingRowsComplete}
      THEN 'COMPLETE' ELSE 'INCOMPLETE'
    END AS data_status,
    p.source_updated_at AS observed_at,
    CASE WHEN (${coverageComplete}) AND ${contributingRowsComplete} THEN 1 ELSE 0 END AS is_day_end_snapshot,
    CASE WHEN p.checkpoint_time IS NULL THEN 'HOURLY_INCREMENT' ELSE 'MIXED_CUMULATIVE_HOURLY' END AS account_value_mode,
    p.source_row_count,
    p.hourly_bucket_count,
    p.checkpoint_time
  FROM ${modernProfileCte} p
  JOIN ${modernRowsCte} m
    ON m.report_date = p.report_date
   AND m.advertiser_id = p.advertiser_id
  GROUP BY
    p.report_date,
    p.latest_stat_time,
    p.advertiser_id,
    p.advertiser_name,
    p.source_updated_at,
    p.source_row_count,
    p.hourly_bucket_count,
    p.checkpoint_time,
    p.post_checkpoint_hour_count
),
${normalizedCte} AS (
  SELECT
    o.report_date,
    o.stat_time,
    o.advertiser_id,
    o.advertiser_name,
    o.video_prom_goods_cost_yuan,
    o.live_prom_goods_cost_yuan,
    o.total_cost_yuan,
    CASE WHEN o.is_day_end_snapshot = 1 AND o.raw_data_status = 'COMPLETE'
      THEN 'COMPLETE' ELSE 'INCOMPLETE' END AS data_status,
    o.observed_at,
    o.is_day_end_snapshot,
    'CUMULATIVE_SNAPSHOT' AS account_value_mode,
    1 AS source_row_count,
    NULL AS hourly_bucket_count,
    o.stat_time AS checkpoint_time
  FROM ${oldRowsCte} o

  UNION ALL

  SELECT * FROM ${modernNormalizedCte}
)`,
    };
}
/**
 * 旧口径取截至当日 23:45 的累计快照（次日 00:00 优先）；迁移日以后
 * 自动把完整整点小时增量汇总为全天值。覆盖不足仍返回小计，但明确标记不完整。
 */
function buildAccountSnapshotCtes(options) {
    const { prefix, startDate, endDate, today } = options;
    parseIsoDate(today);
    const oldTimeQueries = listIsoDates(startDate, endDate).map((date) => {
        const nextDate = offsetIsoDate(date, 1);
        return `SELECT
    a.report_date,
    a.advertiser_id,
    MAX(a.stat_time) AS stat_time
  FROM ${exports.ACCOUNT_HOURLY_TABLE} a FORCE INDEX (idx_qc_account_daily_advertiser_date)
  WHERE ${wisAdvertiserCondition('a')}
    AND a.report_date = DATE('${date}')
    AND a.report_date < DATE('${exports.ACCOUNT_HOURLY_INCREMENT_TRANSITION_DATE}')
    AND (
      a.report_date < DATE('${today}')
      OR CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00') >= TIMESTAMP('${date} 23:45:00')
    )
    AND (
      a.stat_time = TIMESTAMP('${nextDate} 00:00:00')
      OR (
        a.stat_time >= TIMESTAMP('${date} 00:00:00')
        AND a.stat_time <= TIMESTAMP('${date} 23:45:00')
      )
    )
  GROUP BY a.report_date, a.advertiser_id`;
    });
    const oldLatestRowsSql = `SELECT
    a.report_date,
    a.stat_time,
    a.advertiser_id,
    a.advertiser_name,
    a.video_prom_goods_cost_yuan,
    a.live_prom_goods_cost_yuan,
    a.total_cost_yuan,
    a.data_status AS raw_data_status,
    a.observed_at,
    CASE
      WHEN a.stat_time = TIMESTAMP(DATE_ADD(a.report_date, INTERVAL 1 DAY))
        OR a.stat_time >= TIMESTAMP(a.report_date, '23:45:00')
      THEN 1 ELSE 0 END AS is_day_end_snapshot
  FROM (
    ${oldTimeQueries.join('\n    UNION ALL\n    ')}
  ) t
  JOIN ${exports.ACCOUNT_HOURLY_TABLE} a FORCE INDEX (uk_qc_account_hourly_cost)
    ON a.report_date = t.report_date
   AND a.advertiser_id = t.advertiser_id
   AND a.stat_time = t.stat_time`;
    const modernSourceRowsSql = `SELECT a.*
  FROM ${exports.ACCOUNT_HOURLY_TABLE} a FORCE INDEX (idx_qc_account_daily_advertiser_date)
  WHERE ${wisAdvertiserCondition('a')}
    AND a.report_date BETWEEN DATE('${startDate}') AND DATE('${endDate}')
    AND a.report_date >= DATE('${exports.ACCOUNT_HOURLY_INCREMENT_TRANSITION_DATE}')
    AND (
      a.report_date < DATE('${today}')
      OR CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00') >= TIMESTAMP(a.report_date, '23:45:00')
    )
    AND a.stat_time >= TIMESTAMP(a.report_date)
    AND a.stat_time <= TIMESTAMP(DATE_ADD(a.report_date, INTERVAL 1 DAY))`;
    const normalized = buildAccountNormalizationCtes(prefix, oldLatestRowsSql, modernSourceRowsSql);
    return {
        normalizedCte: normalized.normalizedCte,
        sql: normalized.sql,
    };
}
/**
 * 兼容账户表的累计快照、8/29混合迁移和8/30后的小时增量三种形态。
 */
function buildAccountLatestCtes(options) {
    const { prefix, startExpression, endExpression, endInclusive = false, } = options;
    const endOperator = endInclusive ? '<=' : '<';
    const oldLatestTimeCte = `${prefix}_old_latest_time`;
    const oldLatestRowsSql = `SELECT
    a.report_date,
    a.stat_time,
    a.advertiser_id,
    a.advertiser_name,
    a.video_prom_goods_cost_yuan,
    a.live_prom_goods_cost_yuan,
    a.total_cost_yuan,
    a.data_status AS raw_data_status,
    a.observed_at,
    CASE
      WHEN a.stat_time = TIMESTAMP(DATE_ADD(a.report_date, INTERVAL 1 DAY))
        OR a.stat_time >= TIMESTAMP(a.report_date, '23:45:00')
      THEN 1 ELSE 0 END AS is_day_end_snapshot
  FROM ${oldLatestTimeCte} t
  JOIN ${exports.ACCOUNT_HOURLY_TABLE} a FORCE INDEX (uk_qc_account_hourly_cost)
    ON a.report_date = t.report_date
   AND a.advertiser_id = t.advertiser_id
   AND a.stat_time = t.stat_time`;
    const modernSourceRowsSql = `SELECT a.*
  FROM ${exports.ACCOUNT_HOURLY_TABLE} a FORCE INDEX (idx_qc_account_daily_advertiser_date)
  WHERE ${wisAdvertiserCondition('a')}
    AND a.report_date >= ${startExpression}
    AND a.report_date ${endOperator} ${endExpression}
    AND a.report_date >= DATE('${exports.ACCOUNT_HOURLY_INCREMENT_TRANSITION_DATE}')
    AND (
      a.report_date < DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'))
      OR CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00') >= TIMESTAMP(a.report_date, '23:45:00')
    )
    AND a.stat_time >= TIMESTAMP(a.report_date)
    AND a.stat_time <= TIMESTAMP(DATE_ADD(a.report_date, INTERVAL 1 DAY))`;
    const normalized = buildAccountNormalizationCtes(prefix, oldLatestRowsSql, modernSourceRowsSql);
    return {
        normalizedCte: normalized.normalizedCte,
        sql: `${oldLatestTimeCte} AS (
  SELECT
    a.report_date,
    a.advertiser_id,
    MAX(a.stat_time) AS stat_time
  FROM ${exports.ACCOUNT_HOURLY_TABLE} a FORCE INDEX (idx_qc_account_daily_advertiser_date)
  WHERE ${wisAdvertiserCondition('a')}
    AND a.report_date >= ${startExpression}
    AND a.report_date ${endOperator} ${endExpression}
    AND a.report_date < DATE('${exports.ACCOUNT_HOURLY_INCREMENT_TRANSITION_DATE}')
    AND (
      a.report_date < DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'))
      OR CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00') >= TIMESTAMP(a.report_date, '23:45:00')
    )
    AND (
      a.stat_time = TIMESTAMP(DATE_ADD(a.report_date, INTERVAL 1 DAY))
      OR (
        a.stat_time >= TIMESTAMP(a.report_date)
        AND a.stat_time <= TIMESTAMP(a.report_date, '23:45:00')
      )
    )
  GROUP BY a.report_date, a.advertiser_id
),
${normalized.sql}`,
    };
}
/**
 * 计划小时表包含两种历史口径：
 * - HOUR：小时增量，需要按天求和；
 * - FIVE_MINUTE：日内累计快照，需要取业务键的最后快照。
 * 同一天同时存在两种口径时优先采用 FIVE_MINUTE，避免迁移期重复计算。
 */
function buildPlanDailyNormalizedCtes(options) {
    const { prefix, startExpression, endExpression, endInclusive = false, marketingGoalCode, marketingGoalCodes, forceIndex, dedupeAcrossSources = false, } = options;
    const endOperator = endInclusive ? '<=' : '<';
    const fiveMinuteLatestCte = `${prefix}_five_minute_latest`;
    const hourDailyCte = `${prefix}_hour_daily`;
    const fiveMinuteRowsCte = `${prefix}_five_minute_rows`;
    const normalizedCte = `${prefix}_normalized`;
    const sourceNormalizedCte = dedupeAcrossSources
        ? `${prefix}_source_normalized`
        : normalizedCte;
    const sourceRankedCte = `${prefix}_source_ranked`;
    const goalFilter = marketingGoalCodes?.length
        ? `\n    AND q.marketing_goal_code IN (${marketingGoalCodes.map((code) => `'${code}'`).join(', ')})`
        : marketingGoalCode
            ? `\n    AND q.marketing_goal_code = '${marketingGoalCode}'`
            : '';
    const indexHint = forceIndex ? ` FORCE INDEX (${forceIndex})` : '';
    const fiveMinuteLatestQueries = planSources.map((source) => `SELECT
    '${source.sourceName}' AS source_name,
    q.report_date,
    q.advertiser_id,
    q.marketing_goal_code,
    q.ad_id,
    MAX(q.stat_time) AS stat_time,
    MAX(q.observed_at) AS five_minute_observed_at
  FROM ${source.table} q${indexHint}
  WHERE ${source.advertiserCondition('q')}
    AND q.report_date >= ${startExpression}
    AND q.report_date ${endOperator} ${endExpression}
    AND q.record_grain = 'PLAN'${goalFilter}
    AND q.time_granularity = 'FIVE_MINUTE'
  GROUP BY q.report_date, q.advertiser_id, q.marketing_goal_code, q.ad_id`);
    const hourDailyQueries = planSources.map((source) => `SELECT
    '${source.sourceName}' AS source_name,
    q.report_date,
    q.advertiser_id,
    MAX(q.advertiser_name) AS advertiser_name,
    q.marketing_goal_code,
    q.ad_id,
    MAX(q.ad_name) AS ad_name,
    MAX(CASE WHEN q.internal_product_name NOT IN ('', '待映射') THEN q.internal_product_name END) AS internal_product_name,
    SUM(COALESCE(q.stat_cost, q.plan_total_cost_yuan, 0)) AS cost_yuan,
    SUM(COALESCE(
      q.total_pay_order_gmv_include_coupon_for_roi2,
      q.total_pay_order_gmv_for_roi2
    )) AS attributed_gmv_yuan,
    CASE WHEN COUNT(q.plan_net_pay_order_gmv_yuan) > 0
      THEN SUM(q.plan_net_pay_order_gmv_yuan)
      ELSE NULL END AS net_transaction_yuan,
    MAX(q.observed_at) AS observed_at
  FROM ${source.table} q${indexHint}
  WHERE ${source.advertiserCondition('q')}
    AND q.report_date >= ${startExpression}
    AND q.report_date ${endOperator} ${endExpression}
    AND q.record_grain = 'PLAN'${goalFilter}
    AND q.time_granularity = 'HOUR'
  GROUP BY q.report_date, q.advertiser_id, q.marketing_goal_code, q.ad_id`);
    const fiveMinuteRowQueries = planSources.map((source) => `SELECT
    f.source_name,
    q.report_date,
    q.advertiser_id,
    q.advertiser_name,
    q.marketing_goal_code,
    q.ad_id,
    q.ad_name,
    CASE WHEN q.internal_product_name NOT IN ('', '待映射') THEN q.internal_product_name END AS internal_product_name,
    COALESCE(q.stat_cost, q.plan_total_cost_yuan, 0) AS cost_yuan,
    COALESCE(
      q.total_pay_order_gmv_include_coupon_for_roi2,
      q.total_pay_order_gmv_for_roi2
    ) AS attributed_gmv_yuan,
    q.plan_net_pay_order_gmv_yuan AS net_transaction_yuan,
    CASE
      WHEN h.observed_at IS NULL OR f.five_minute_observed_at >= h.observed_at
        THEN f.five_minute_observed_at
      ELSE h.observed_at
    END AS observed_at
  FROM ${fiveMinuteLatestCte} f
  JOIN ${source.table} q FORCE INDEX (uk_qc_plan_window)
    ON q.report_date = f.report_date
   AND q.time_granularity = 'FIVE_MINUTE'
   AND q.stat_time = f.stat_time
   AND q.advertiser_id = f.advertiser_id
   AND q.marketing_goal_code = f.marketing_goal_code
   AND q.ad_id = f.ad_id
  LEFT JOIN ${hourDailyCte} h
    ON h.source_name = f.source_name
   AND h.report_date = f.report_date
   AND h.advertiser_id = f.advertiser_id
   AND h.marketing_goal_code = f.marketing_goal_code
   AND h.ad_id = f.ad_id
  WHERE f.source_name = '${source.sourceName}'
    AND q.record_grain = 'PLAN'`);
    return {
        normalizedCte,
        sql: `${fiveMinuteLatestCte} AS (
  ${fiveMinuteLatestQueries.join('\n  UNION ALL\n  ')}
),
${hourDailyCte} AS (
  ${hourDailyQueries.join('\n  UNION ALL\n  ')}
),
${fiveMinuteRowsCte} AS (
  ${fiveMinuteRowQueries.join('\n  UNION ALL\n  ')}
),
${sourceNormalizedCte} AS (
  SELECT * FROM ${fiveMinuteRowsCte}

  UNION ALL

  SELECT h.*
  FROM ${hourDailyCte} h
  LEFT JOIN ${fiveMinuteLatestCte} f
    ON f.source_name = h.source_name
   AND f.report_date = h.report_date
   AND f.advertiser_id = h.advertiser_id
   AND f.marketing_goal_code = h.marketing_goal_code
   AND f.ad_id = h.ad_id
  WHERE f.ad_id IS NULL
)${dedupeAcrossSources
            ? `,
${sourceRankedCte} AS (
  SELECT
    s.*,
    ROW_NUMBER() OVER (
      PARTITION BY s.report_date, s.advertiser_id, s.marketing_goal_code, s.ad_id
      ORDER BY
        s.observed_at DESC,
        s.cost_yuan DESC,
        CASE WHEN s.source_name = 'chengfang' THEN 0 ELSE 1 END
    ) AS source_rank
  FROM ${sourceNormalizedCte} s
),
${normalizedCte} AS (
  SELECT
    source_name,
    report_date,
    advertiser_id,
    advertiser_name,
    marketing_goal_code,
    ad_id,
    ad_name,
    internal_product_name,
    cost_yuan,
    attributed_gmv_yuan,
    net_transaction_yuan,
    observed_at
  FROM ${sourceRankedCte}
  WHERE source_rank = 1
)`
            : ''}`,
    };
}
/**
 * WIS 单品千川归因的唯一公共规则。
 *
 * 精确直播计划优先；推商品只在已映射账户中按标准单品或计划关键词归因。
 * 未命中记录保持 NULL，不按 0 处理，也不分摊给任何单品。
 */
function buildQianchuanProductAttributionCase(alias = 'q') {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) {
        throw new Error('无效 SQL 别名');
    }
    const q = alias;
    return `CASE
      -- 水润直播：7 月 30 日从厚拓1切换到厚拓3。
      WHEN ${q}.advertiser_id = '1861245440814282'
       AND ${q}.ad_id IN ('1870021116462106', '1870616906892567')
       AND ${q}.report_date <= '2026-07-29' THEN '水润面膜'
      WHEN ${q}.advertiser_id = '1871833428793802'
       AND ${q}.ad_id = '1871955152329131'
       AND ${q}.report_date >= '2026-07-30' THEN '水润面膜'

      -- 眼膜直播间采用映射表中的精确计划。
      WHEN ${q}.advertiser_id = '1758788274050062'
       AND ${q}.ad_id IN ('1866844683602179', '1870291431535736') THEN '晶润紧致眼膜'

      -- 历史精确商品计划继续保留，保证旧数据不因计划改名而漂移。
      WHEN ${q}.ad_id IN ('1873118806497419', '1872668057859187', '1873486310826106')
        THEN '深海次抛精华'
      WHEN ${q}.ad_id IN ('1872936984345683', '1872853366306823', '1872667818377370')
        THEN '黑晶光蕴面膜'
      -- 映射文档把 1873118877202476 同时列在燕窝和蛋白喷雾下；
      -- 只有计划名或乘方标准单品明确返回“蛋白喷雾”时才归入喷雾，禁止重复归因。
      WHEN ${q}.ad_id = '1873118877202476'
       AND (${q}.internal_product_name LIKE '%蛋白喷雾%' OR ${q}.ad_name LIKE '%蛋白喷雾%')
        THEN 'WIS肌活蛋白喷雾'
      WHEN ${q}.ad_id IN ('1872651726825097', '1873118877202476', '1873487105515722')
        THEN '燕窝面膜'

      -- 账号 1869672250595328 的直播计划 1870289794646204 自 2026-08-26 起只播黑晶。
      -- 直播消耗由账户场景兜底归入黑晶；此前共播历史仍保持未归因。

      -- 乘方专表若已回传标准单品，优先使用该映射。
      WHEN ${q}.source_name = 'chengfang'
       AND ${q}.internal_product_name IN ('水润面膜', '晶润紧致眼膜', '深海次抛精华', '黑晶光蕴面膜', '燕窝面膜', '美白针', 'WIS肌活蛋白喷雾')
        THEN ${q}.internal_product_name

      -- 博观11：账户和计划 ID 在切换千川乘方后保持不变。
      -- 常规表与乘方表先按业务键跨源择优去重，再按单品关键词归因。
      WHEN ${q}.advertiser_id = '1760222277505102'
       AND ${q}.marketing_goal_code = 'VIDEO_PROM_GOODS'
       AND ${q}.ad_name LIKE '%黑晶%' THEN '黑晶光蕴面膜'
      WHEN ${q}.advertiser_id = '1760222277505102'
       AND ${q}.marketing_goal_code = 'VIDEO_PROM_GOODS'
       AND ${q}.ad_name LIKE '%水润%'
       AND ${q}.ad_name NOT LIKE '%黑晶%' THEN '水润面膜'
      WHEN ${q}.advertiser_id = '1760222277505102'
       AND ${q}.marketing_goal_code = 'VIDEO_PROM_GOODS'
       AND (${q}.ad_name LIKE '%深海%' OR ${q}.ad_name LIKE '%次抛%') THEN '深海次抛精华'
      WHEN ${q}.advertiser_id = '1760222277505102'
       AND ${q}.marketing_goal_code = 'VIDEO_PROM_GOODS'
       AND (${q}.ad_name LIKE '%眼膜%' OR ${q}.ad_name LIKE '%晶润%') THEN '晶润紧致眼膜'
      WHEN ${q}.advertiser_id = '1760222277505102'
       AND ${q}.marketing_goal_code = 'VIDEO_PROM_GOODS'
       AND ${q}.ad_name LIKE '%燕窝面膜%' THEN '燕窝面膜'
      WHEN ${q}.advertiser_id = '1760222277505102'
       AND ${q}.marketing_goal_code = 'VIDEO_PROM_GOODS'
       AND (${q}.ad_name LIKE '%美白针%' OR ${q}.ad_name LIKE '%光感微珠%') THEN '美白针'
      WHEN ${q}.advertiser_id = '1760222277505102'
       AND ${q}.marketing_goal_code = 'VIDEO_PROM_GOODS'
       AND ${q}.ad_name LIKE '%蛋白喷雾%' THEN 'WIS肌活蛋白喷雾'

      -- 仟得1全域商品按关键词拆分。
      WHEN ${q}.advertiser_id = '1864619805954196'
       AND ${q}.marketing_goal_code = 'VIDEO_PROM_GOODS'
       AND ${q}.ad_name LIKE '%水润%' THEN '水润面膜'
      WHEN ${q}.advertiser_id = '1864619805954196'
       AND ${q}.marketing_goal_code = 'VIDEO_PROM_GOODS'
       AND (${q}.ad_name LIKE '%眼膜%' OR ${q}.ad_name LIKE '%晶润%') THEN '晶润紧致眼膜'

      -- 佳云主账户仅按计划关键词，不得整账户归入眼膜。
      WHEN ${q}.advertiser_id = '1758788274050062'
       AND ${q}.marketing_goal_code = 'VIDEO_PROM_GOODS'
       AND (${q}.ad_name LIKE '%眼膜%' OR ${q}.ad_name LIKE '%晶润%') THEN '晶润紧致眼膜'
      WHEN ${q}.advertiser_id = '1758788274050062'
       AND ${q}.marketing_goal_code = 'VIDEO_PROM_GOODS'
       AND (${q}.ad_name LIKE '%深海%' OR ${q}.ad_name LIKE '%次抛%') THEN '深海次抛精华'
      WHEN ${q}.advertiser_id = '1758788274050062'
       AND ${q}.marketing_goal_code = 'VIDEO_PROM_GOODS'
       AND ${q}.ad_name LIKE '%黑晶%' THEN '黑晶光蕴面膜'
      WHEN ${q}.advertiser_id = '1758788274050062'
       AND ${q}.marketing_goal_code = 'VIDEO_PROM_GOODS'
       AND ${q}.ad_name LIKE '%燕窝面膜%' THEN '燕窝面膜'
      WHEN ${q}.advertiser_id = '1758788274050062'
       AND ${q}.marketing_goal_code = 'VIDEO_PROM_GOODS'
       AND (${q}.ad_name LIKE '%蛋白喷雾%' OR ${q}.ad_name LIKE '%肌活喷雾%') THEN 'WIS肌活蛋白喷雾'

      -- 仟得2同时投放眼膜、深海次抛、燕窝和蛋白喷雾，必须按计划关键词拆分。
      WHEN ${q}.advertiser_id = '1864699162217866'
       AND ${q}.marketing_goal_code = 'VIDEO_PROM_GOODS'
       AND (${q}.ad_name LIKE '%眼膜%' OR ${q}.ad_name LIKE '%晶润%') THEN '晶润紧致眼膜'
      WHEN ${q}.advertiser_id = '1864699162217866'
       AND ${q}.marketing_goal_code = 'VIDEO_PROM_GOODS'
       AND (${q}.ad_name LIKE '%深海%' OR ${q}.ad_name LIKE '%次抛%') THEN '深海次抛精华'
      WHEN ${q}.advertiser_id = '1864699162217866'
       AND ${q}.marketing_goal_code = 'VIDEO_PROM_GOODS'
       AND ${q}.ad_name LIKE '%燕窝面膜%' THEN '燕窝面膜'
      WHEN ${q}.advertiser_id = '1864699162217866'
       AND ${q}.marketing_goal_code = 'VIDEO_PROM_GOODS'
       AND (${q}.ad_name LIKE '%蛋白喷雾%' OR ${q}.ad_name LIKE '%肌活喷雾%' OR ${q}.ad_name LIKE '%喷雾%') THEN 'WIS肌活蛋白喷雾'

      -- 佳云万合账户同时覆盖眼膜与燕窝，未命中关键词的计划保持未归因。
      WHEN ${q}.advertiser_id = '1850659758537995'
       AND ${q}.marketing_goal_code = 'VIDEO_PROM_GOODS'
       AND (${q}.ad_name LIKE '%眼膜%' OR ${q}.ad_name LIKE '%晶润%') THEN '晶润紧致眼膜'
      WHEN ${q}.advertiser_id = '1850659758537995'
       AND ${q}.marketing_goal_code = 'VIDEO_PROM_GOODS'
       AND ${q}.ad_name LIKE '%燕窝面膜%' THEN '燕窝面膜'
    END`;
}
