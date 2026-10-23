"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reviewedSql = exports.metricSpecs = void 0;
const qianchuan_sql_1 = require("./qianchuan-sql");
const ORDER_TABLE = 'd_root_project_mid_db_brandmarketing.platform_order_item_api_field';
exports.metricSpecs = {
    wis_doudian_effective_rolling_15d: {
        title: '最近15个完整自然日 WIS 抖店有效成交额',
        requirement: '按北京时间与支付时间统计截至昨天的最近15个完整自然日 WIS 抖音小店。部门库已限定品牌营销数据且订单同步表保存最新版本；剔除 order_status=4 的已取消订单，再汇总订单级实付金额。金额由分转换为元。',
        tables: [ORDER_TABLE],
        refreshPolicy: '每天 07:00 后刷新；加入昨天并移除最早一天，始终保留15天',
    },
    wis_doudian_effective_today: {
        title: 'WIS 抖店当日有效成交额',
        requirement: '按北京时间与支付时间统计今天 WIS 抖音小店，直接读取部门库订单最新版本，剔除 order_status=4 的已取消订单，汇总有效成交额与有效订单数，并返回最近一笔 WIS 抖店支付时间以判断数据是否滞后。',
        tables: [ORDER_TABLE],
        refreshPolicy: '每个整点刷新',
    },
    qianchuan_account_cost_rolling_15d: {
        title: '最近15个完整自然日千川账户消耗',
        requirement: '按北京时间统计截至昨天的最近15个完整自然日，仅汇总账户名称包含 WIS 的千川账户商品投放与直播投放消耗；保留账户数、完整记录数和源数据更新时间，用于与同日 WIS 抖店有效成交额计算广告占比。',
        tables: [qianchuan_sql_1.ACCOUNT_HOURLY_TABLE],
        refreshPolicy: '每天 07:00 后刷新；与有效成交额使用相同的15天滚动窗口',
    },
    qianchuan_product_cost_rolling_15d_oldest: {
        title: '千川已映射单品归因消耗（最早5天）',
        requirement: '按《WIS千川在用账户》最新对照规则，将常规与乘方计划级千川消耗归因到水润面膜、晶润紧致眼膜、深海次抛精华、黑晶光蕴面膜、燕窝面膜、美白针与WIS肌活蛋白喷雾；直播计划迁移期间仅对单品归属唯一的账户使用账户表直播场景消耗兜底，黑晶直播间自2026-08-26起只播黑晶并归入黑晶，此前共播历史保持未归因；FIVE_MINUTE累计快照取每天最后一条，历史HOUR增量按天求和；映射表未列出的账户和计划不归因，并返回品牌总消耗、明细覆盖和未归因金额用于守恒校验。返回最近15天中的最早5天。',
        tables: [
            qianchuan_sql_1.PLAN_HOURLY_TABLE,
            qianchuan_sql_1.CHENGFANG_PLAN_HOURLY_TABLE,
            qianchuan_sql_1.ACCOUNT_HOURLY_TABLE,
        ],
        refreshPolicy: '每天 07:00 后刷新；仅展示账户级千川日报已完整返回的日期',
    },
    qianchuan_product_cost_rolling_15d_middle: {
        title: '千川已映射单品归因消耗（中间5天）',
        requirement: '按《WIS千川在用账户》最新对照规则，将常规与乘方计划级千川消耗归因到水润面膜、晶润紧致眼膜、深海次抛精华、黑晶光蕴面膜、燕窝面膜、美白针与WIS肌活蛋白喷雾；直播计划迁移期间仅对单品归属唯一的账户使用账户表直播场景消耗兜底，黑晶直播间自2026-08-26起只播黑晶并归入黑晶，此前共播历史保持未归因；FIVE_MINUTE累计快照取每天最后一条，历史HOUR增量按天求和；映射表未列出的账户和计划不归因，并返回品牌总消耗、明细覆盖和未归因金额用于守恒校验。返回最近15天中的中间5天。',
        tables: [
            qianchuan_sql_1.PLAN_HOURLY_TABLE,
            qianchuan_sql_1.CHENGFANG_PLAN_HOURLY_TABLE,
            qianchuan_sql_1.ACCOUNT_HOURLY_TABLE,
        ],
        refreshPolicy: '每天 07:00 后刷新；仅展示账户级千川日报已完整返回的日期',
    },
    qianchuan_product_cost_rolling_15d_latest: {
        title: '千川已映射单品归因消耗（最近5天）',
        requirement: '按《WIS千川在用账户》最新对照规则，将常规与乘方计划级千川消耗归因到水润面膜、晶润紧致眼膜、深海次抛精华、黑晶光蕴面膜、燕窝面膜、美白针与WIS肌活蛋白喷雾；直播计划迁移期间仅对单品归属唯一的账户使用账户表直播场景消耗兜底，黑晶直播间自2026-08-26起只播黑晶并归入黑晶，此前共播历史保持未归因；FIVE_MINUTE累计快照取每天最后一条，历史HOUR增量按天求和；映射表未列出的账户和计划不归因，并返回品牌总消耗、明细覆盖和未归因金额用于守恒校验。返回最近15天中的最近5天。',
        tables: [
            qianchuan_sql_1.PLAN_HOURLY_TABLE,
            qianchuan_sql_1.CHENGFANG_PLAN_HOURLY_TABLE,
            qianchuan_sql_1.ACCOUNT_HOURLY_TABLE,
        ],
        refreshPolicy: '每天 07:00 后刷新；仅展示账户级千川日报已完整返回的日期',
    },
    wis_doudian_product_effective_rolling_15d_oldest: {
        title: 'WIS 抖店滚动15天标准单品有效成交额（最早5天）',
        requirement: '按北京时间统计最近15个完整自然日中最早5天的 WIS 抖店有效订单 SKU 实付金额。部门库订单表保存最新版本，查询剔除取消单并按核心单品名归并。',
        tables: [ORDER_TABLE],
        refreshPolicy: '每天 07:00 后滚动刷新',
    },
    wis_doudian_product_effective_rolling_15d_middle: {
        title: 'WIS 抖店滚动15天标准单品有效成交额（中间5天）',
        requirement: '按北京时间统计最近15个完整自然日中中间5天的 WIS 抖店有效订单 SKU 实付金额。部门库订单表保存最新版本，查询剔除取消单并按核心单品名归并。',
        tables: [ORDER_TABLE],
        refreshPolicy: '每天 07:00 后滚动刷新',
    },
    wis_doudian_product_effective_rolling_15d_latest: {
        title: 'WIS 抖店滚动15天标准单品有效成交额（最近5天）',
        requirement: '按北京时间统计最近15个完整自然日中最近5天的 WIS 抖店有效订单 SKU 实付金额。部门库订单表保存最新版本，查询剔除取消单并按核心单品名归并。',
        tables: [ORDER_TABLE],
        refreshPolicy: '每天 07:00 后滚动刷新',
    },
    wis_doudian_effective_month_to_date: {
        title: 'WIS 抖店本月累计有效成交额与目标单品累计',
        requirement: '按北京时间统计本月1日至昨天的 WIS 抖店有效成交额。部门库订单表保存最新版本，查询剔除 order_status=4 的取消单；品牌完成额使用订单级实付金额，眼膜、水润面膜、凝颜使用 SKU 实付金额按目标单品口径归并。',
        tables: [ORDER_TABLE],
        refreshPolicy: '每天 07:00 后刷新；始终累计至上一完整自然日',
    },
    wis_doudian_product_effective_daily: {
        title: 'WIS 抖店上一完整自然日标准单品有效成交额',
        requirement: '按北京时间统计上一完整自然日 WIS 抖店有效订单的 SKU 实付金额。部门库订单表保存最新版本，查询剔除 order_status=4 的已取消订单；将不同商品链接按核心单品名归并并返回单品榜单。',
        tables: [ORDER_TABLE],
        refreshPolicy: '每天 07:00 后刷新上一完整自然日',
    },
};
const trendSql = `WITH params AS (
  SELECT DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')) AS today
),
effective_orders AS (
  SELECT
    o.pay_time,
    o.order_pay_amount,
    o.updated_at
  FROM ${ORDER_TABLE} o FORCE INDEX (idx_shop_pay_time)
  CROSS JOIN params p
  WHERE o.shop_id IN (1099, 1100)
    AND o.pay_time >= DATE_SUB(p.today, INTERVAL 15 DAY)
    AND o.pay_time < p.today
    AND o.order_status <> '4'
)
SELECT
  DATE(o.pay_time) AS pay_date,
  ROUND(SUM(o.order_pay_amount) / 100, 2) AS effective_sales_yuan,
  COUNT(*) AS paid_order_count,
  MAX(o.updated_at) AS source_updated_at
FROM effective_orders o
GROUP BY DATE(o.pay_time)
ORDER BY pay_date`;
const todaySql = `WITH params AS (
  SELECT DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')) AS today
),
filtered_orders AS (
  SELECT
    o.order_status,
    o.order_pay_amount,
    o.updated_at,
    o.pay_time
  FROM ${ORDER_TABLE} o FORCE INDEX (idx_shop_pay_time)
  CROSS JOIN params p
  WHERE o.shop_id IN (1099, 1100)
    AND o.pay_time >= p.today
    AND o.pay_time < DATE_ADD(p.today, INTERVAL 1 DAY)
)
SELECT
  p.today AS pay_date,
  COALESCE(ROUND(SUM(CASE WHEN o.order_status <> '4' THEN o.order_pay_amount ELSE 0 END) / 100, 2), 0) AS effective_sales_yuan,
  SUM(CASE WHEN o.order_status <> '4' THEN 1 ELSE 0 END) AS paid_order_count,
  MAX(o.updated_at) AS source_updated_at,
  MAX(o.pay_time) AS latest_wis_pay_time
FROM params p
LEFT JOIN filtered_orders o ON 1 = 1
GROUP BY p.today`;
const qianchuanAccountCostCtes = (0, qianchuan_sql_1.buildAccountLatestCtes)({
    prefix: 'account_cost',
    startExpression: "DATE_SUB(DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')), INTERVAL 15 DAY)",
    endExpression: "DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'))",
});
const qianchuanCostSql = `WITH ${qianchuanAccountCostCtes.sql}
SELECT
  q.report_date,
  ROUND(SUM(COALESCE(q.total_cost_yuan, 0)), 2) AS qianchuan_cost_yuan,
  ROUND(SUM(COALESCE(q.video_prom_goods_cost_yuan, 0)), 2) AS video_cost_yuan,
  ROUND(SUM(COALESCE(q.live_prom_goods_cost_yuan, 0)), 2) AS live_cost_yuan,
  COUNT(DISTINCT q.advertiser_id) AS advertiser_count,
  SUM(CASE WHEN q.data_status = 'COMPLETE' THEN 1 ELSE 0 END) AS complete_row_count,
  COUNT(*) AS row_count,
  MAX(q.observed_at) AS source_updated_at
FROM ${qianchuanAccountCostCtes.normalizedCte} q
GROUP BY q.report_date
ORDER BY q.report_date`;
const shanghaiTodayExpression = "DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'))";
function buildQianchuanProductSpendSql(startDays, endDays) {
    const endExpression = endDays === 0
        ? shanghaiTodayExpression
        : `DATE_SUB(${shanghaiTodayExpression}, INTERVAL ${endDays} DAY)`;
    const startExpression = `DATE_SUB(${shanghaiTodayExpression}, INTERVAL ${startDays} DAY)`;
    const planCtes = (0, qianchuan_sql_1.buildPlanDailyNormalizedCtes)({
        prefix: `product_plan_${startDays}_${endDays}`,
        startExpression,
        endExpression,
        forceIndex: 'idx_qc_plan_material_daily_ad',
        dedupeAcrossSources: true,
    });
    const accountCtes = (0, qianchuan_sql_1.buildAccountLatestCtes)({
        prefix: `product_account_${startDays}_${endDays}`,
        startExpression,
        endExpression,
    });
    return `WITH ${planCtes.sql},
${accountCtes.sql},
plan_attributed AS (
  SELECT
    q.source_name,
    q.report_date,
    q.advertiser_id,
    q.marketing_goal_code,
    q.ad_id,
    q.ad_name,
    q.cost_yuan AS attributed_cost_yuan,
    q.observed_at,
    ${(0, qianchuan_sql_1.buildQianchuanProductAttributionCase)('q')} AS standard_product_name
  FROM ${planCtes.normalizedCte} q
  WHERE q.cost_yuan > 0
    AND NOT (${(0, qianchuan_sql_1.livePromotionPlanCondition)('q')})
),
live_account_attributed AS (
  -- 直播计划切换千川乘方后，计划专表会暂时断行；账户场景消耗仍连续且完整。
  -- 已确认的直播专用账户只取 live_prom_goods_cost_yuan，不把推商品或账户总消耗混入。
  SELECT
    'account_live' AS source_name,
    q.report_date,
    q.advertiser_id,
    'LIVE_PROM_GOODS' AS marketing_goal_code,
    'ACCOUNT_LIVE' AS ad_id,
    q.advertiser_name AS ad_name,
    q.live_prom_goods_cost_yuan AS attributed_cost_yuan,
    q.observed_at,
    ${(0, qianchuan_sql_1.livePromotionAccountProductCase)('q')} AS standard_product_name
  FROM ${accountCtes.normalizedCte} q
  WHERE COALESCE(q.live_prom_goods_cost_yuan, 0) > 0
    AND ${(0, qianchuan_sql_1.livePromotionAccountProductCase)('q')} IS NOT NULL
),
attributed AS (
  SELECT * FROM plan_attributed
  UNION ALL
  SELECT * FROM live_account_attributed
),
daily_product AS (
  -- 同一单品汇总规则命中的全部账户和计划，不按账户抽样或分摊未映射消耗。
  SELECT
    report_date,
    standard_product_name,
    ROUND(SUM(attributed_cost_yuan), 2) AS qianchuan_cost_yuan,
    COUNT(DISTINCT CONCAT(source_name, ':', advertiser_id)) AS advertiser_count,
    COUNT(DISTINCT CONCAT(source_name, ':', advertiser_id, ':', ad_id)) AS plan_count,
    MAX(observed_at) AS source_updated_at
  FROM attributed
  WHERE standard_product_name IS NOT NULL
  GROUP BY report_date, standard_product_name
),
daily_summary AS (
  SELECT
    report_date,
    ROUND(SUM(attributed_cost_yuan), 2) AS plan_visible_cost_yuan,
    ROUND(SUM(CASE WHEN standard_product_name IS NOT NULL THEN attributed_cost_yuan ELSE 0 END), 2) AS mapped_cost_yuan,
    ROUND(SUM(CASE WHEN standard_product_name IS NULL THEN attributed_cost_yuan ELSE 0 END), 2) AS unmapped_visible_cost_yuan,
    COUNT(DISTINCT CONCAT(source_name, ':', advertiser_id)) AS plan_advertiser_count,
    COUNT(DISTINCT CONCAT(source_name, ':', advertiser_id, ':', marketing_goal_code, ':', ad_id)) AS visible_plan_count,
    MAX(observed_at) AS plan_source_updated_at
  FROM attributed
  GROUP BY report_date
),
brand_daily AS (
  SELECT
    report_date,
    ROUND(SUM(COALESCE(total_cost_yuan, 0)), 2) AS brand_cost_yuan,
    COUNT(DISTINCT advertiser_id) AS brand_advertiser_count,
    SUM(CASE WHEN data_status = 'COMPLETE' THEN 1 ELSE 0 END) AS brand_complete_count,
    COUNT(*) AS brand_row_count,
    MAX(observed_at) AS brand_source_updated_at
  FROM ${accountCtes.normalizedCte}
  GROUP BY report_date
)
SELECT
  p.report_date,
  p.standard_product_name,
  p.qianchuan_cost_yuan,
  p.advertiser_count,
  p.plan_count,
  GREATEST(
    COALESCE(p.source_updated_at, '1970-01-01 00:00:00'),
    COALESCE(s.plan_source_updated_at, '1970-01-01 00:00:00'),
    COALESCE(b.brand_source_updated_at, '1970-01-01 00:00:00')
  ) AS source_updated_at,
  s.plan_visible_cost_yuan,
  s.mapped_cost_yuan,
  s.unmapped_visible_cost_yuan,
  s.plan_advertiser_count,
  s.visible_plan_count,
  b.brand_cost_yuan,
  b.brand_advertiser_count,
  b.brand_complete_count,
  b.brand_row_count
FROM daily_product p
JOIN daily_summary s ON s.report_date = p.report_date
LEFT JOIN brand_daily b ON b.report_date = p.report_date
ORDER BY p.report_date, p.qianchuan_cost_yuan DESC`;
}
const qianchuanProductSpendOldestSql = buildQianchuanProductSpendSql(15, 10);
const qianchuanProductSpendMiddleSql = buildQianchuanProductSpendSql(10, 5);
const qianchuanProductSpendLatestSql = buildQianchuanProductSpendSql(5, 0);
const monthToDateSql = `WITH RECURSIVE params AS (
  SELECT
    DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')) AS today,
    DATE_FORMAT(DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')), '%Y-%m-01') AS month_start
),
effective_orders AS (
  SELECT
    o.order_pay_amount,
    o.sku_items,
    o.updated_at
  FROM ${ORDER_TABLE} o FORCE INDEX (idx_shop_pay_time)
  CROSS JOIN params p
  WHERE o.shop_id IN (1099, 1100)
    AND o.pay_time >= p.month_start
    AND o.pay_time < p.today
    AND order_status <> '4'
),
seq AS (
  SELECT 0 AS n
  UNION ALL
  SELECT n + 1 FROM seq WHERE n < 49
),
sku_lines AS (
  SELECT
    JSON_UNQUOTE(JSON_EXTRACT(o.sku_items, CONCAT('$[', seq.n, '].product_id'))) AS product_id,
    JSON_UNQUOTE(JSON_EXTRACT(o.sku_items, CONCAT('$[', seq.n, '].product_name'))) AS product_name,
    CAST(JSON_UNQUOTE(JSON_EXTRACT(o.sku_items, CONCAT('$[', seq.n, '].sku_pay_amount'))) AS UNSIGNED) AS sku_pay_amount
  FROM effective_orders o
  JOIN seq ON seq.n < JSON_LENGTH(o.sku_items)
),
product_totals AS (
  SELECT
    ROUND(SUM(CASE WHEN product_name REGEXP '晶润紧致眼|眼膜' THEN sku_pay_amount ELSE 0 END) / 100, 2) AS eye_mask_sales_yuan,
    ROUND(SUM(CASE WHEN product_name LIKE '%水润%'
      AND product_name LIKE '%面膜%'
      AND product_name NOT LIKE '%乳糖酸%'
      AND product_name NOT LIKE '%黑晶%'
      AND COALESCE(product_id, '') NOT IN ('3832934099933331762', '3832385407056740745')
      THEN sku_pay_amount ELSE 0 END) / 100, 2) AS water_mask_sales_yuan,
    ROUND(SUM(CASE WHEN product_name REGEXP '凝颜|舒缓紧致弹嫩乳' THEN sku_pay_amount ELSE 0 END) / 100, 2) AS ningyan_sales_yuan
  FROM sku_lines
  WHERE sku_pay_amount > 0
)
SELECT
  p.month_start,
  CASE WHEN DAY(p.today) > 1 THEN DATE_SUB(p.today, INTERVAL 1 DAY) ELSE NULL END AS through_date,
  GREATEST(DAY(p.today) - 1, 0) AS completed_days,
  COALESCE((SELECT ROUND(SUM(order_pay_amount) / 100, 2) FROM effective_orders), 0) AS brand_sales_yuan,
  COALESCE(pt.eye_mask_sales_yuan, 0) AS eye_mask_sales_yuan,
  COALESCE(pt.water_mask_sales_yuan, 0) AS water_mask_sales_yuan,
  COALESCE(pt.ningyan_sales_yuan, 0) AS ningyan_sales_yuan,
  (SELECT MAX(updated_at) FROM effective_orders) AS source_updated_at
FROM params p
CROSS JOIN product_totals pt`;
const productTrendSql = `WITH RECURSIVE params AS (
  SELECT DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00')) AS today
),
effective_orders AS (
  SELECT
    o.pay_time,
    o.platform_order_no,
    o.sku_items,
    o.updated_at
  FROM ${ORDER_TABLE} o FORCE INDEX (idx_shop_pay_time)
  CROSS JOIN params p
  WHERE o.shop_id IN (1099, 1100)
    AND o.pay_time >= DATE_SUB(p.today, INTERVAL 15 DAY)
    AND o.pay_time < p.today
    AND order_status <> '4'
),
seq AS (
  SELECT 0 AS n
  UNION ALL
  SELECT n + 1 FROM seq WHERE n < 49
),
sku_lines AS (
  SELECT
    DATE(o.pay_time) AS pay_date,
    o.platform_order_no,
    JSON_UNQUOTE(JSON_EXTRACT(o.sku_items, CONCAT('$[', seq.n, '].product_id'))) AS product_id,
    JSON_UNQUOTE(JSON_EXTRACT(o.sku_items, CONCAT('$[', seq.n, '].product_name'))) AS product_name,
    CAST(JSON_UNQUOTE(JSON_EXTRACT(o.sku_items, CONCAT('$[', seq.n, '].sku_pay_amount'))) AS UNSIGNED) AS sku_pay_amount,
    CAST(JSON_UNQUOTE(JSON_EXTRACT(o.sku_items, CONCAT('$[', seq.n, '].product_quantity'))) AS UNSIGNED) AS product_quantity,
    o.updated_at
  FROM effective_orders o
  JOIN seq ON seq.n < JSON_LENGTH(o.sku_items)
),
categorized AS (
  SELECT
    pay_date, platform_order_no, product_id, sku_pay_amount, product_quantity, updated_at,
    CASE
      WHEN product_name LIKE '%水润%'
       AND product_name LIKE '%面膜%'
       AND product_name NOT LIKE '%乳糖酸%'
       AND product_name NOT LIKE '%黑晶%'
       AND COALESCE(product_id, '') NOT IN ('3832934099933331762', '3832385407056740745')
        THEN '水润面膜'
      WHEN product_name REGEXP '晶润紧致眼|眼膜' THEN '晶润紧致眼膜'
      WHEN product_name LIKE '%乳糖酸%' THEN '乳糖酸多效面膜'
      WHEN product_name REGEXP '玻尿酸.*面膜' THEN '玻尿酸极润面膜'
      WHEN product_name LIKE '%黑晶%' THEN '黑晶光蕴面膜'
      WHEN product_name LIKE '%痘肌修护面膜%' THEN '痘肌修护面膜'
      WHEN product_name LIKE '%胜肽菁妍蕴能面膜%' THEN '胜肽菁妍蕴能面膜'
      WHEN product_name LIKE '%燕窝%' AND product_name LIKE '%面膜%' THEN '燕窝面膜'
      WHEN product_name LIKE '%美白针%' OR product_name LIKE '%光感微珠%' THEN '美白针'
      WHEN product_name LIKE '%蛋白喷雾%' THEN 'WIS肌活蛋白喷雾'
      WHEN product_name REGEXP '凝颜.*洁面' THEN '凝颜洁面乳'
      WHEN product_name REGEXP '凝颜.*精粹水' THEN '凝颜精粹水'
      WHEN product_name REGEXP '凝颜.*弹嫩乳|舒缓紧致弹嫩乳' THEN '凝颜紧致弹嫩乳'
      WHEN product_name REGEXP '凝颜.*精粹霜' THEN '凝颜精粹霜'
      WHEN product_name LIKE '%抗老套装%' THEN '抗老护肤套装'
      WHEN product_name LIKE '%凝颜%' THEN '凝颜护肤套装'
      WHEN product_name REGEXP '极润紧肤|极润保湿套装|极润.*水乳|保湿紧肤水' THEN '极润紧肤护肤套装'
      WHEN product_name REGEXP '时光精粹水乳|护肤时光精粹' THEN '时光精粹护肤套装'
      WHEN product_name LIKE '%奢研时光精粹水%' THEN '时光精粹水'
      WHEN product_name LIKE '%深海精粹弹嫩精华%' THEN '深海精粹弹嫩次抛'
      WHEN product_name LIKE '%温润洁面泡沫%' THEN '温润洁面泡沫'
      WHEN product_name LIKE '%温和净透洁面乳%' THEN '温和净透洁面乳'
      WHEN product_name REGEXP '净澈.*黑泥膜' THEN '净澈洁颜黑泥膜'
      WHEN product_name LIKE '%男士清爽洁面乳%' THEN '男士清爽洁面乳'
      WHEN product_name LIKE '%男士劲能畅通套装%' THEN '男士劲能畅通套装'
      WHEN product_name LIKE '%日夜次抛精华%' THEN '日夜次抛精华'
      WHEN product_name LIKE '%重组胶原蛋白次抛精华%' THEN '重组胶原蛋白次抛精华'
      WHEN product_name LIKE '%亲肤润唇膏%' THEN '亲肤润唇膏'
      WHEN product_name LIKE '%柔润奢养抗皱颈膜%' THEN '柔润奢养抗皱颈膜'
      ELSE CONCAT('其他：', product_name)
    END AS standard_product_name
  FROM sku_lines
  WHERE sku_pay_amount > 0
),
family_sales AS (
  SELECT
    pay_date,
    standard_product_name,
    ROUND(SUM(sku_pay_amount) / 100, 2) AS effective_sales_yuan,
    COUNT(DISTINCT platform_order_no) AS order_count,
    SUM(product_quantity) AS product_quantity,
    COUNT(DISTINCT product_id) AS product_link_count,
    MAX(updated_at) AS source_updated_at
  FROM categorized
  GROUP BY pay_date, standard_product_name
)
SELECT
  pay_date,
  standard_product_name,
  effective_sales_yuan,
  order_count,
  product_quantity,
  product_link_count,
  ROUND(effective_sales_yuan / SUM(effective_sales_yuan) OVER (PARTITION BY pay_date) * 100, 2) AS sales_share_pct,
  source_updated_at
FROM family_sales
ORDER BY pay_date, effective_sales_yuan DESC, standard_product_name`;
const productOldestFiveSql = productTrendSql.replace('o.pay_time < p.today', 'o.pay_time < DATE_SUB(p.today, INTERVAL 10 DAY)');
const productMiddleFiveSql = productTrendSql
    .replace('o.pay_time >= DATE_SUB(p.today, INTERVAL 15 DAY)', 'o.pay_time >= DATE_SUB(p.today, INTERVAL 10 DAY)')
    .replace('o.pay_time < p.today', 'o.pay_time < DATE_SUB(p.today, INTERVAL 5 DAY)');
const productLatestFiveSql = productTrendSql.replace('o.pay_time >= DATE_SUB(p.today, INTERVAL 15 DAY)', 'o.pay_time >= DATE_SUB(p.today, INTERVAL 5 DAY)');
const productDailySql = productTrendSql.replace('o.pay_time >= DATE_SUB(p.today, INTERVAL 15 DAY)', 'o.pay_time >= DATE_SUB(p.today, INTERVAL 1 DAY)');
exports.reviewedSql = {
    wis_doudian_effective_rolling_15d: trendSql,
    wis_doudian_effective_today: todaySql,
    qianchuan_account_cost_rolling_15d: qianchuanCostSql,
    qianchuan_product_cost_rolling_15d_oldest: qianchuanProductSpendOldestSql,
    qianchuan_product_cost_rolling_15d_middle: qianchuanProductSpendMiddleSql,
    qianchuan_product_cost_rolling_15d_latest: qianchuanProductSpendLatestSql,
    wis_doudian_product_effective_rolling_15d_oldest: productOldestFiveSql,
    wis_doudian_product_effective_rolling_15d_middle: productMiddleFiveSql,
    wis_doudian_product_effective_rolling_15d_latest: productLatestFiveSql,
    wis_doudian_effective_month_to_date: monthToDateSql,
    wis_doudian_product_effective_daily: productDailySql,
};
