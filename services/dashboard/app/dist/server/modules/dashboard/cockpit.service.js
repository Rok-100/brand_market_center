"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveSession = resolveSession;
exports.profitForPeriod = profitForPeriod;
exports.dailyProfit = dailyProfit;
exports.buildHourlyOrderRangeSql = buildHourlyOrderRangeSql;
exports.buildHourlyOrderSql = buildHourlyOrderSql;
exports.buildHourlyAdSql = buildHourlyAdSql;
exports.buildPromotionSceneSql = buildPromotionSceneSql;
exports.buildPromotionScenesSql = buildPromotionScenesSql;
exports.buildMaterialSql = buildMaterialSql;
exports.buildMaterialOnlineSql = buildMaterialOnlineSql;
exports.isRootDataUnavailableError = isRootDataUnavailableError;
exports.warmCockpit = warmCockpit;
exports.getCockpit = getCockpit;
exports.getMaterialSnapshot = getMaterialSnapshot;
exports.shanghaiTodayStr = shanghaiTodayStr;
exports.buildOperatingSql = buildOperatingSql;
exports.buildAdDailySql = buildAdDailySql;
exports.buildProductTrendSql = buildProductTrendSql;
exports.buildProductTrendDirectSql = buildProductTrendDirectSql;
exports.buildProductAttributionSql = buildProductAttributionSql;
exports.getOperatingTrend = getOperatingTrend;
exports.getProductEconomics = getProductEconomics;
exports.getProductTrend = getProductTrend;
exports.getPromotionSceneTrend = getPromotionSceneTrend;
exports.getMaterialOnlineTrend = getMaterialOnlineTrend;
const mcp_1 = require("./mcp");
const cache_1 = require("./cache");
const mysql_1 = require("./mysql");
const qianchuan_sql_1 = require("./qianchuan-sql");
const ORDER_TABLE = 'd_root_project_mid_db_brandmarketing.platform_order_item_api_field';
// 线上联合索引与看板的店铺、支付时间过滤顺序一致，避免按全公司支付时间或订单时间扫描。
const ORDER_QUERY_INDEX = 'idx_shop_pay_time';
const ORDER_TIME_QUERY_INDEX = 'idx_shop_order_time';
const ATTRIBUTED_PRODUCT_NAMES = [
    '水润面膜',
    '晶润紧致眼膜',
    '深海次抛精华',
    '黑晶光蕴面膜',
    '燕窝面膜',
    '美白针',
    'WIS肌活蛋白喷雾',
];
const shanghaiToday = "DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+08:00'))";
/**
 * 生产数据已确认 WIS 抖店由这两个店铺 ID 构成。允许通过环境变量覆盖，
 * 避免重新使用无法命中普通索引的 shop_name 模糊匹配。
 */
function configuredWisDouyinShopIds() {
    const configured = process.env.WIS_DOUYIN_SHOP_IDS || '1099,1100';
    const ids = [
        ...new Set(configured
            .split(',')
            .map((value) => value.trim())
            .filter((value) => /^\d+$/.test(value))),
    ];
    return ids.length ? ids : ['1099', '1100'];
}
const wisDouyinShopIdsSql = configuredWisDouyinShopIds().join(',');
// 两个店铺 ID 的全历史数据均只属于抖音小店，按 ID 过滤即可，避免重复读取平台名称列。
const wisOrderFilter = `o.shop_id IN (${wisDouyinShopIdsSql})`;
// 经营规划图（战略2.0）中的月度GSV目标。H2月度值按图中逐月口径展示。
const GSV_TARGET_WAN = {
    '2026-01': 2464,
    '2026-02': 2464,
    '2026-03': 5914,
    '2026-04': 2526,
    '2026-05': 3750,
    '2026-06': 3500,
    '2026-07': 3297,
    '2026-08': 4396,
    '2026-09': 4390,
    '2026-10': 5456,
    '2026-11': 3868,
    '2026-12': 3423,
};
// 用户提供的经营规划截图中1–6月实际完成额；仅用于校准GSV，不反推GMV或千川消耗。
const CALIBRATED_GSV_WAN = {
    '2026-01': 1813,
    '2026-02': 1664,
    '2026-03': 4154,
    '2026-04': 2361,
    '2026-05': 2473,
    '2026-06': 3983,
};
const YEAR_GSV_TARGET_WAN = 45452;
const PROFIT_MARGIN_TARGET_PCT = {
    '2026-01': -25.97,
    '2026-02': -16.37,
    '2026-03': -13.62,
    '2026-04': -13.54,
    '2026-05': -16.42,
    '2026-06': -14,
    '2026-07': -12.1,
    '2026-08': -13.8,
    '2026-09': -13,
    '2026-10': -5,
    '2026-11': -8,
    '2026-12': -9,
};
// 《WIS品牌营销2026 H1复盘总结》确认的1–6月整店实际净利率。
// 历史值直接按财报口径展示，不使用7月费用模型反推。
const CALIBRATED_PROFIT_MARGIN_PCT = {
    '2026-01': -27.09,
    '2026-02': -34.09,
    '2026-03': -6.2,
    '2026-04': -21.33,
    '2026-05': -18.08,
    '2026-06': -7.83,
};
// 2026-07已由用户逐项确认。后续月份未单独确认前沿用比例与固定费用口径；
// 大额星图/信息流素材费只记在实际发生日，不跨月沿用。
const PROFIT_CONFIG = {
    effectiveFrom: '2026-07',
    productCostRate: 0.161,
    brandBaseMonthlyYuan: 103_323,
    laborMonthlyYuan: 2_914_000,
    taxRate: 0.07,
    shippingRate: 0.0403,
    platformRate: 0.038,
    sharedMonthlyYuan: 930_930,
    financeOtherRate: 0.0074,
    prepaidBrandRate: 0.1266,
};
// 7月已确认的大额品牌费用；小额拍摄费由月度基数按自然日平摊。
const JULY_BRAND_EXTRA_YUAN = {
    '2026-07-01': 15_015,
    '2026-07-02': 6_670,
    '2026-07-03': 7_599,
    '2026-07-04': 8_793,
    '2026-07-05': 6_966,
    '2026-07-06': 1_437,
    '2026-07-07': 197,
};
// 由用户在2026-07-21提供的飞书个人资料截图核验。运行时可取到职务后，将优先使用实时字段。
const VERIFIED_JOB_TITLES = {
    '1820839385642100': '营销高级经理',
    ou_a76f91f526feca2b0aa7c17a754af2bd: '营销高级经理',
};
const VERIFIED_MANAGER_NAMES = new Set(['杨雯']);
const VERIFIED_DIRECTOR_NAMES = new Set(['赵佳乐']);
const VERIFIED_DIRECTOR_USER_IDS = new Set([
    'ou_e9b3c1713cbb8dc65232dad5d2f2c704',
]);
const DIRECTOR_BRIEFING_VIEWER_NAMES = new Set(['舒豪', '丁小恬']);
const DIRECTOR_BRIEFING_VIEWER_USER_IDS = new Set([
    '1820839385642100',
    'ou_193a8b0e08742fd0784a6f599798f08c',
    'ou_3508339d4876238c52486072b1c00717',
]);
const CRITICAL_WORK_VIEWER_USER_IDS = new Set([
    'ou_89a2f095b0d9a637643c1353d4554696', // 钱含韵，仅关键工作只读
]);
const JULY_CRITICAL_WORK = [
    {
        id: 'okr-1-1',
        goal: '二创团队OD人效提升，赋能项目业绩增长',
        direction: '优化小组阵的执行，加强培训和激励，加快二创人才培养',
        actions: [
            '组长加强日常带教和复盘，中心内保持小组排名和业绩公示的激励动作',
            '定期监控组会开展情况，保证培养速率',
        ],
    },
    {
        id: 'okr-1-2',
        goal: '二创团队OD人效提升，赋能项目业绩增长',
        direction: '维稳二创人才培养，加强培训和激励，加快新人业绩产出速度',
        actions: [
            '小组内定期进行分析和复盘会议',
            '中心内保持小组排名、周度激励动作',
        ],
    },
    {
        id: 'okr-1-3',
        goal: '二创团队OD人效提升，赋能项目业绩增长',
        direction: '梳理现有流程，建立SOP，加快新人培养进度',
        actions: ['监控组内培养情况，保持中心素材会召开', '梳理现有流程，建立SOP'],
    },
    {
        id: 'okr-2-1',
        goal: '一创团队阵的优化，促进单品业绩上限突破和抖店新品打爆',
        direction: 'AI创意内容突破',
        actions: [
            '引入文案创作同事，补足创意内容来源',
            '推进剧情信息流向、曝光向AI素材产出，评估质量和效率',
            '持续优化既有AI素材产出流程，推进规模化和自动化',
        ],
    },
    {
        id: 'okr-2-2',
        goal: '一创团队阵的优化，促进单品业绩上限突破和抖店新品打爆',
        direction: 'KOC项目重点突破',
        actions: [
            '加快加强招聘节奏，应对项目经理离职和7月发布增量的压力',
            '根据时事热点和竞对趋势持续产出模板脚本，保障内容更新',
            '推进1名10万元KOL和1位明星的约档发布，放大曝光种草效益',
        ],
    },
    {
        id: 'okr-3-1',
        goal: '新品打品规划与方向校准，保证新品的打爆成功概率',
        direction: '燕窝面膜7月ADQ端GSV达到100万，ROI≥1.4',
        actions: [
            '第1–2周围绕‘燕窝精华+’产出不少于100条测试素材，覆盖明星背书、成分科普、素人种草',
            '持续复用抖店和视频号已验证素材结构，第1周完成首轮50条/天测试，保留有效率≥60%的方向',
            '第3–4周对ROI≥1.4的素材当天裂变，每日保持≥50条新素材上传测试',
        ],
    },
    {
        id: 'okr-3-2',
        goal: '新品打品规划与方向校准，保证新品的打爆成功概率',
        direction: '微信豆新品团队扩招至9人，分3组赛马，新品月GSV冲刺300万',
        actions: [
            '每周按新品素材产出量、新品GMV、ROI三维度排名激励，每两周进行一次组间素材结构交流',
            '微信豆跑通的有效结构当天同步ADQ团队，形成‘微信豆测结构、ADQ放量’组合打法',
            '黑晶面膜优先放量；供应链断货时切换黄金面膜；次抛提升至每日40条测试量',
        ],
    },
    {
        id: 'okr-3-3',
        goal: '新品打品规划与方向校准，保证新品的打爆成功概率',
        direction: '新品测品工作，测出5万+素材',
        actions: [
            '对美容针、黄金、次抛等新品粗剪原生实拍素材，围绕高光片段A/B测试100条',
            '基于验证结果拆解10个素材公式模板',
            '锁定前10%的种子素材并扩量1000条，批量更换人脸、字幕、音乐和钩子文案',
        ],
    },
    {
        id: 'okr-4-1',
        goal: '直播间主播团队效益提升',
        direction: '提升中心人效比与活力值',
        actions: [
            '启动直播助理轮转体系和主播教练预排名分配，逐步完善中心团队阵型',
            '根据业务情况优化直播间数量和高级主播配置',
        ],
    },
    {
        id: 'okr-4-2',
        goal: '直播间主播团队效益提升',
        direction: '推进AI数字人主播测试',
        actions: [
            '推进数字人制作拍摄，在淘宝、视频号、抖店以不同形式持续测试2周以上',
            '根据测试数据及成交情况，确认与供应商的合作方式',
        ],
    },
];
function number(value) {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
}
function nullableNumber(value) {
    if (value === null || value === undefined || value === '')
        return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}
function dayEndCoverage(row) {
    const expectedAccountCount = number(row.expected_account_count) ||
        qianchuan_sql_1.QIANCHUAN_EXPECTED_DAY_END_ACCOUNT_COUNT;
    const hasExplicitCount = row.day_end_account_count !== undefined;
    const dayEndAccountCount = hasExplicitCount
        ? number(row.day_end_account_count)
        : row.reached_day_end !== undefined
            ? number(row.reached_day_end) === 1
                ? expectedAccountCount
                : 0
            : expectedAccountCount;
    return {
        dayEndAccountCount,
        expectedAccountCount,
        complete: dayEndAccountCount === expectedAccountCount,
    };
}
function csvEnv(name) {
    return new Set((process.env[name] || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean));
}
function roleText(roles = []) {
    return roles
        .map((role) => {
        if (typeof role === 'string')
            return role;
        if (role && typeof role === 'object') {
            const record = role;
            return String(record.name || record.label || record.roleName || '');
        }
        return '';
    })
        .filter(Boolean)
        .join(' ');
}
function resolveSession(identity = {}) {
    const id = identity.userId || null;
    const centralHighest = identity.authority === 'central_authority' && identity.highestBusinessAccess === true;
    const runtimeTitle = identity.jobTitle?.trim() || '';
    const verifiedTitle = id ? VERIFIED_JOB_TITLES[id] || '' : '';
    const verifiedNameTitle = identity.userName && VERIFIED_MANAGER_NAMES.has(identity.userName.trim())
        ? '营销高级经理'
        : '';
    const isVerifiedDirector = Boolean((identity.userName &&
        VERIFIED_DIRECTOR_NAMES.has(identity.userName.trim())) ||
        (id && VERIFIED_DIRECTOR_USER_IDS.has(id)));
    const isVerifiedBriefingViewer = Boolean((identity.userName &&
        DIRECTOR_BRIEFING_VIEWER_NAMES.has(identity.userName.trim())) ||
        (id && DIRECTOR_BRIEFING_VIEWER_USER_IDS.has(id)));
    const isVerifiedCriticalWorkViewer = Boolean(id && CRITICAL_WORK_VIEWER_USER_IDS.has(id));
    const roleNames = roleText(identity.roles);
    const permissionText = [
        runtimeTitle,
        roleNames,
        verifiedTitle,
        verifiedNameTitle,
    ]
        .filter(Boolean)
        .join(' ');
    const isDirector = permissionText.includes('总监');
    const isSeniorManager = permissionText.includes('高级经理');
    const isManager = !isSeniorManager && permissionText.includes('经理');
    let role = 'viewer';
    if (centralHighest || isDirector ||
        isVerifiedDirector ||
        (id && csvEnv('WIS_COCKPIT_DIRECTOR_USER_IDS').has(id)))
        role = 'director';
    else if (isSeniorManager ||
        (id && csvEnv('WIS_COCKPIT_SENIOR_MANAGER_USER_IDS').has(id)))
        role = 'senior_manager';
    else if (isManager || (id && csvEnv('WIS_COCKPIT_MANAGER_USER_IDS').has(id)))
        role = 'manager';
    const permissionBasis = centralHighest ? 'central_authority' : isVerifiedCriticalWorkViewer
        ? 'verified_profile'
        : runtimeTitle
            ? 'job_title'
            : roleNames
                ? 'role'
                : verifiedTitle || verifiedNameTitle
                    ? 'verified_profile'
                    : 'none';
    return {
        authenticated: Boolean(id),
        userId: id,
        userName: identity.userName || null,
        role,
        jobTitle: (centralHighest ? '中枢最高权限' : runtimeTitle) ||
            verifiedTitle ||
            verifiedNameTitle ||
            (isVerifiedDirector ? '总监' : null),
        permissionBasis,
        canViewCriticalWork: role === 'director' ||
            role === 'senior_manager' ||
            isVerifiedCriticalWorkViewer,
        canViewProfit: Boolean(id),
        canViewDirectorBriefing: centralHighest || isVerifiedDirector || isVerifiedBriefingViewer,
        canEditDirectorBriefing: centralHighest || isVerifiedDirector,
    };
}
function daysInMonth(month) {
    const [year, monthNumber] = month.split('-').map(Number);
    return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
}
function profitForPeriod(month, throughDay, gsvYuan, qianchuanCostYuan) {
    if (month < PROFIT_CONFIG.effectiveFrom ||
        gsvYuan <= 0 ||
        qianchuanCostYuan === null) {
        return { profitYuan: null, profitMarginPct: null };
    }
    const naturalDays = daysInMonth(month);
    const accruedDays = Math.max(1, Math.min(throughDay, naturalDays));
    const brandBaseYuan = (PROFIT_CONFIG.brandBaseMonthlyYuan / naturalDays) * accruedDays;
    const brandExtraYuan = Object.entries(JULY_BRAND_EXTRA_YUAN)
        .filter(([date]) => date.startsWith(`${month}-`) && Number(date.slice(-2)) <= accruedDays)
        .reduce((sum, [, amount]) => sum + amount, 0);
    const fixedYuan = brandBaseYuan +
        brandExtraYuan +
        (PROFIT_CONFIG.laborMonthlyYuan / naturalDays) * accruedDays +
        (PROFIT_CONFIG.sharedMonthlyYuan / naturalDays) * accruedDays;
    const variableYuan = gsvYuan *
        (PROFIT_CONFIG.productCostRate +
            PROFIT_CONFIG.taxRate +
            PROFIT_CONFIG.shippingRate +
            PROFIT_CONFIG.platformRate +
            PROFIT_CONFIG.financeOtherRate +
            PROFIT_CONFIG.prepaidBrandRate);
    const profitYuan = gsvYuan - qianchuanCostYuan - fixedYuan - variableYuan;
    return { profitYuan, profitMarginPct: (profitYuan / gsvYuan) * 100 };
}
function dailyProfit(date, gsvYuan, qianchuanCostYuan) {
    const month = date.slice(0, 7);
    if (month < PROFIT_CONFIG.effectiveFrom ||
        gsvYuan <= 0 ||
        qianchuanCostYuan === null) {
        return { profitYuan: null, profitMarginPct: null };
    }
    const naturalDays = daysInMonth(month);
    const fixedYuan = PROFIT_CONFIG.brandBaseMonthlyYuan / naturalDays +
        (JULY_BRAND_EXTRA_YUAN[date] || 0) +
        PROFIT_CONFIG.laborMonthlyYuan / naturalDays +
        PROFIT_CONFIG.sharedMonthlyYuan / naturalDays;
    const variableYuan = gsvYuan *
        (PROFIT_CONFIG.productCostRate +
            PROFIT_CONFIG.taxRate +
            PROFIT_CONFIG.shippingRate +
            PROFIT_CONFIG.platformRate +
            PROFIT_CONFIG.financeOtherRate +
            PROFIT_CONFIG.prepaidBrandRate);
    const profitYuan = gsvYuan - qianchuanCostYuan - fixedYuan - variableYuan;
    return { profitYuan, profitMarginPct: (profitYuan / gsvYuan) * 100 };
}
// GMV/GSV按支付时间归属；退款率按业务定义使用下单时间，并按主订单号计数。
const operatingSql = `WITH paid_orders AS (
  SELECT
    DATE(o.pay_time) AS pay_date,
    ROUND(SUM(o.order_pay_amount) / 100, 2) AS gmv_yuan,
    ROUND(SUM(CASE WHEN o.order_status <> '4' THEN o.order_pay_amount ELSE 0 END) / 100, 2) AS gsv_yuan,
    ROUND(SUM(CASE WHEN o.order_status = '4' THEN o.order_pay_amount ELSE 0 END) / 100, 2) AS refund_yuan,
    COUNT(*) AS order_count,
    MAX(o.updated_at) AS pay_source_updated_at
  FROM ${ORDER_TABLE} o FORCE INDEX (${ORDER_QUERY_INDEX})
  WHERE ${wisOrderFilter}
    AND o.pay_time >= DATE_SUB(${shanghaiToday}, INTERVAL 14 DAY)
    AND o.pay_time < DATE_ADD(${shanghaiToday}, INTERVAL 1 DAY)
  GROUP BY DATE(o.pay_time)
), placed_orders AS (
  SELECT
    DATE(o.order_time) AS order_date,
    COUNT(DISTINCT o.platform_order_no) AS total_order_count,
    COUNT(DISTINCT CASE WHEN o.order_status = '4' THEN o.platform_order_no END) AS closed_order_count,
    MAX(o.updated_at) AS order_source_updated_at
  FROM ${ORDER_TABLE} o FORCE INDEX (${ORDER_TIME_QUERY_INDEX})
  WHERE ${wisOrderFilter}
    AND o.order_time >= DATE_SUB(${shanghaiToday}, INTERVAL 14 DAY)
    AND o.order_time < DATE_ADD(${shanghaiToday}, INTERVAL 1 DAY)
  GROUP BY DATE(o.order_time)
)
SELECT
  p.pay_date,
  p.gmv_yuan,
  p.gsv_yuan,
  p.refund_yuan,
  p.order_count,
  q.total_order_count,
  q.closed_order_count,
  COALESCE(GREATEST(p.pay_source_updated_at, q.order_source_updated_at), p.pay_source_updated_at, q.order_source_updated_at) AS source_updated_at
FROM paid_orders p
LEFT JOIN placed_orders q ON q.order_date = p.pay_date
ORDER BY p.pay_date`;
const adDailyCtes = (0, qianchuan_sql_1.buildAccountLatestCtes)({
    prefix: 'cockpit_ad_daily',
    startExpression: `DATE_SUB(${shanghaiToday}, INTERVAL 14 DAY)`,
    endExpression: `DATE_ADD(${shanghaiToday}, INTERVAL 1 DAY)`,
});
const adDailySql = `WITH ${adDailyCtes.sql}
SELECT
  report_date,
  ROUND(SUM(COALESCE(total_cost_yuan, 0)), 2) AS cost_yuan,
  SUM(CASE WHEN data_status = 'COMPLETE' THEN 1 ELSE 0 END) AS complete_rows,
  COUNT(DISTINCT CASE WHEN is_day_end_snapshot = 1 THEN advertiser_id END) AS day_end_account_count,
  ${qianchuan_sql_1.QIANCHUAN_EXPECTED_DAY_END_ACCOUNT_COUNT} AS expected_account_count,
  CASE
    WHEN COUNT(DISTINCT CASE WHEN is_day_end_snapshot = 1 THEN advertiser_id END) = ${qianchuan_sql_1.QIANCHUAN_EXPECTED_DAY_END_ACCOUNT_COUNT}
    THEN 1 ELSE 0
  END AS reached_day_end,
  COUNT(*) AS row_count,
  MAX(observed_at) AS source_updated_at
FROM ${adDailyCtes.normalizedCte}
GROUP BY report_date
ORDER BY report_date`;
const monthlyOrderSql = `WITH paid_monthly AS (
  SELECT
    DATE_FORMAT(o.pay_time, '%Y-%m') AS month_key,
    ROUND(SUM(o.order_pay_amount) / 100, 2) AS gmv_yuan,
    ROUND(SUM(CASE WHEN o.order_status <> '4' THEN o.order_pay_amount ELSE 0 END) / 100, 2) AS gsv_yuan,
    ROUND(SUM(CASE WHEN o.order_status = '4' THEN o.order_pay_amount ELSE 0 END) / 100, 2) AS refund_yuan,
    MIN(o.pay_time) AS min_pay_time,
    MAX(o.pay_time) AS max_pay_time,
    MAX(o.updated_at) AS source_updated_at
  FROM ${ORDER_TABLE} o FORCE INDEX (${ORDER_QUERY_INDEX})
  WHERE ${wisOrderFilter}
    -- 1–6月GSV使用已确认校准值，订单明细只需从实时接管的7月开始扫描。
    AND o.pay_time >= '2026-07-01'
    AND o.pay_time < DATE_ADD(${shanghaiToday}, INTERVAL 1 DAY)
  GROUP BY DATE_FORMAT(o.pay_time, '%Y-%m')
), placed_monthly AS (
  SELECT
    DATE_FORMAT(o.order_time, '%Y-%m') AS month_key,
    COUNT(DISTINCT o.platform_order_no) AS total_order_count,
    COUNT(DISTINCT CASE WHEN o.order_status = '4' THEN o.platform_order_no END) AS closed_order_count
  FROM ${ORDER_TABLE} o FORCE INDEX (${ORDER_TIME_QUERY_INDEX})
  WHERE ${wisOrderFilter}
    AND o.order_time >= '2026-07-01'
    AND o.order_time < DATE_ADD(${shanghaiToday}, INTERVAL 1 DAY)
  GROUP BY DATE_FORMAT(o.order_time, '%Y-%m')
)
SELECT p.*, q.total_order_count, q.closed_order_count
FROM paid_monthly p
LEFT JOIN placed_monthly q ON q.month_key = p.month_key
ORDER BY p.month_key`;
const monthlyAdCtes = (0, qianchuan_sql_1.buildAccountLatestCtes)({
    prefix: 'cockpit_monthly_ad',
    startExpression: "'2026-01-01'",
    endExpression: `DATE_ADD(${shanghaiToday}, INTERVAL 1 DAY)`,
});
const monthlyAdSql = `WITH ${monthlyAdCtes.sql}
SELECT
  DATE_FORMAT(report_date, '%Y-%m') AS month_key,
  ROUND(SUM(COALESCE(total_cost_yuan, 0)), 2) AS cost_yuan,
  MIN(report_date) AS min_report_date,
  MAX(report_date) AS max_report_date,
  COUNT(DISTINCT report_date) AS day_count,
  MAX(observed_at) AS source_updated_at
FROM ${monthlyAdCtes.normalizedCte}
GROUP BY DATE_FORMAT(report_date, '%Y-%m')
ORDER BY month_key`;
const hourlyOrderSql = `
SELECT
  HOUR(o.pay_time) AS hour_no,
  ROUND(SUM(o.order_pay_amount) / 100, 2) AS gmv_yuan,
  ROUND(SUM(CASE WHEN o.order_status <> '4' THEN o.order_pay_amount ELSE 0 END) / 100, 2) AS gsv_yuan,
  ROUND(SUM(CASE WHEN o.order_status = '4' THEN o.order_pay_amount ELSE 0 END) / 100, 2) AS refund_yuan,
  COUNT(*) AS order_count,
  MAX(o.updated_at) AS source_updated_at
FROM ${ORDER_TABLE} o FORCE INDEX (${ORDER_QUERY_INDEX})
WHERE ${wisOrderFilter}
  AND o.pay_time >= ${shanghaiToday}
  AND o.pay_time < DATE_ADD(${shanghaiToday}, INTERVAL 1 DAY)
GROUP BY HOUR(o.pay_time)
ORDER BY hour_no`;
function buildHourlyOrderRangeSql(startDate, endDate) {
    return `
SELECT
  DATE(o.pay_time) AS pay_date,
  HOUR(o.pay_time) AS hour_no,
  ROUND(SUM(o.order_pay_amount) / 100, 2) AS gmv_yuan,
  ROUND(SUM(CASE WHEN o.order_status <> '4' THEN o.order_pay_amount ELSE 0 END) / 100, 2) AS gsv_yuan,
  ROUND(SUM(CASE WHEN o.order_status = '4' THEN o.order_pay_amount ELSE 0 END) / 100, 2) AS refund_yuan,
  COUNT(*) AS order_count,
  MAX(o.updated_at) AS source_updated_at
FROM ${ORDER_TABLE} o FORCE INDEX (${ORDER_QUERY_INDEX})
WHERE ${wisOrderFilter}
  AND o.pay_time >= '${startDate}'
  AND o.pay_time < DATE_ADD('${endDate}', INTERVAL 1 DAY)
GROUP BY DATE(o.pay_time), HOUR(o.pay_time)
ORDER BY pay_date, hour_no`;
}
function buildHourlyOrderSql(date) {
    return buildHourlyOrderRangeSql(date, date);
}
function buildHourlyAdSqlForExpression(dateExpression) {
    const sourceRows = [
        {
            sourceName: 'standard',
            table: qianchuan_sql_1.PLAN_HOURLY_TABLE,
            advertiserFilter: (0, qianchuan_sql_1.wisAdvertiserCondition)('q'),
        },
        {
            sourceName: 'chengfang',
            table: qianchuan_sql_1.CHENGFANG_PLAN_HOURLY_TABLE,
            advertiserFilter: '1 = 1',
        },
    ]
        .map((source) => `SELECT
    '${source.sourceName}' AS source_name,
    q.id,
    q.report_date,
    q.stat_time,
    q.advertiser_id,
    q.marketing_goal_code,
    q.ad_id,
    q.time_granularity,
    q.stat_cost,
    q.plan_total_cost_yuan,
    q.observed_at
  FROM ${source.table} q FORCE INDEX (idx_qc_plan_material_daily_ad)
  WHERE q.report_date = ${dateExpression}
    AND q.record_grain = 'PLAN'
    AND ${source.advertiserFilter}`)
        .join('\n  UNION ALL\n  ');
    return `WITH plan_rows AS (
  ${sourceRows}
), ranked AS (
  SELECT
    q.source_name,
    q.report_date,
    q.stat_time,
    q.advertiser_id,
    q.marketing_goal_code,
    q.ad_id,
    q.time_granularity,
    COALESCE(q.stat_cost, q.plan_total_cost_yuan, 0) AS cost_yuan,
    q.observed_at,
    ROW_NUMBER() OVER (
      PARTITION BY
        q.source_name,
        q.report_date,
        q.stat_time,
        q.advertiser_id,
        q.marketing_goal_code,
        q.ad_id,
        q.time_granularity
      ORDER BY q.observed_at DESC, q.id DESC
    ) AS snapshot_rank
  FROM plan_rows q
),
deduplicated AS (
  SELECT * FROM ranked WHERE snapshot_rank = 1
),
first_five_minute AS (
  SELECT
    source_name,
    report_date,
    advertiser_id,
    marketing_goal_code,
    ad_id,
    MIN(stat_time) AS first_stat_time
  FROM deduplicated
  WHERE time_granularity = 'FIVE_MINUTE'
  GROUP BY source_name, report_date, advertiser_id, marketing_goal_code, ad_id
),
hour_before_snapshot AS (
  SELECT
    h.source_name,
    h.report_date,
    h.advertiser_id,
    h.marketing_goal_code,
    h.ad_id,
    SUM(h.cost_yuan) AS cost_yuan
  FROM deduplicated h
  JOIN first_five_minute f
    ON f.source_name = h.source_name
   AND f.report_date = h.report_date
   AND f.advertiser_id = h.advertiser_id
   AND f.marketing_goal_code = h.marketing_goal_code
   AND f.ad_id = h.ad_id
  WHERE h.time_granularity = 'HOUR'
    AND h.stat_time < f.first_stat_time
  GROUP BY h.source_name, h.report_date, h.advertiser_id, h.marketing_goal_code, h.ad_id
),
hour_increments AS (
  SELECT h.report_date, h.stat_time, h.cost_yuan, h.observed_at
  FROM deduplicated h
  LEFT JOIN first_five_minute f
    ON f.source_name = h.source_name
   AND f.report_date = h.report_date
   AND f.advertiser_id = h.advertiser_id
   AND f.marketing_goal_code = h.marketing_goal_code
   AND f.ad_id = h.ad_id
  WHERE h.time_granularity = 'HOUR'
    AND (f.first_stat_time IS NULL OR h.stat_time < f.first_stat_time)
),
five_minute_sequence AS (
  SELECT
    d.*,
    LAG(d.cost_yuan) OVER (
      PARTITION BY d.source_name, d.report_date, d.advertiser_id, d.marketing_goal_code, d.ad_id
      ORDER BY d.stat_time
    ) AS previous_cost_yuan
  FROM deduplicated d
  WHERE d.time_granularity = 'FIVE_MINUTE'
),
five_minute_increments AS (
  SELECT
    f.report_date,
    f.stat_time,
    CASE
      WHEN f.previous_cost_yuan IS NULL
        THEN f.cost_yuan - COALESCE(h.cost_yuan, 0)
      ELSE f.cost_yuan - f.previous_cost_yuan
    END AS cost_yuan,
    f.observed_at
  FROM five_minute_sequence f
  LEFT JOIN hour_before_snapshot h
    ON h.source_name = f.source_name
   AND h.report_date = f.report_date
   AND h.advertiser_id = f.advertiser_id
   AND h.marketing_goal_code = f.marketing_goal_code
   AND h.ad_id = f.ad_id
),
increments AS (
  SELECT * FROM hour_increments
  UNION ALL
  SELECT * FROM five_minute_increments
),
bucketed AS (
  SELECT
    CASE
      WHEN stat_time >= DATE_ADD(report_date, INTERVAL 1 DAY) THEN 23
      ELSE HOUR(stat_time)
    END AS hour_no,
    cost_yuan,
    observed_at
  FROM increments
)
SELECT
  hour_no,
  ROUND(SUM(cost_yuan), 2) AS cost_yuan,
  MAX(observed_at) AS source_updated_at
FROM bucketed
GROUP BY hour_no
ORDER BY hour_no`;
}
const hourlyAdSql = buildHourlyAdSqlForExpression(shanghaiToday);
function buildHourlyAdSql(date) {
    return buildHourlyAdSqlForExpression(`'${date}'`);
}
function buildPromotionSceneSql(marketingGoalCode, startDate, endDate) {
    const start = startDate
        ? `DATE_SUB('${startDate}', INTERVAL 0 DAY)`
        : `DATE_SUB(${shanghaiToday}, INTERVAL 14 DAY)`;
    const end = endDate
        ? `DATE_ADD('${endDate}', INTERVAL 1 DAY)`
        : `DATE_ADD(${shanghaiToday}, INTERVAL 1 DAY)`;
    const planCtes = (0, qianchuan_sql_1.buildPlanDailyNormalizedCtes)({
        prefix: `promotion_${marketingGoalCode.toLowerCase()}`,
        startExpression: start,
        endExpression: end,
        marketingGoalCode,
        forceIndex: 'idx_qc_plan_material_daily_ad',
    });
    return `WITH ${planCtes.sql}
SELECT
  report_date,
  marketing_goal_code,
  ROUND(SUM(cost_yuan), 2) AS cost_yuan,
  CASE WHEN COUNT(attributed_gmv_yuan) > 0
    THEN ROUND(SUM(attributed_gmv_yuan), 2)
    ELSE NULL END AS overall_transaction_yuan,
  COUNT(*) AS record_count,
  COUNT(DISTINCT advertiser_id) AS advertiser_count,
  SUM(CASE WHEN attributed_gmv_yuan IS NULL THEN 1 ELSE 0 END) AS overall_transaction_null_rows,
  MAX(observed_at) AS source_updated_at
FROM ${planCtes.normalizedCte}
GROUP BY report_date, marketing_goal_code
ORDER BY report_date`;
}
/**
 * 推直播间与推商品趋势。
 * 两个场景的消耗均以账户小时表返回的场景总消耗为准；整体成交金额使用计划
 * 明细的含券成交字段（缺失时回退不含券字段）汇总。计划覆盖不足时保留已返回
 * 的小计并标记 partial，不使用素材成交额或抖店 GSV 代替。
 */
function buildPromotionScenesSql(startDate, endDate) {
    const today = shanghaiTodayStr();
    const actualEnd = validDateStr(endDate, today);
    const actualStart = validDateStr(startDate, offsetDateStr(actualEnd, -14));
    const start = `DATE('${actualStart}')`;
    const end = `DATE_ADD(DATE('${actualEnd}'), INTERVAL 1 DAY)`;
    const planCtes = (0, qianchuan_sql_1.buildPlanDailyNormalizedCtes)({
        prefix: 'promotion_combined',
        startExpression: start,
        endExpression: end,
        forceIndex: 'idx_qc_plan_material_daily_ad',
        dedupeAcrossSources: true,
    });
    const accountCtes = (0, qianchuan_sql_1.buildAccountSnapshotCtes)({
        prefix: 'promotion_account',
        startDate: actualStart,
        endDate: actualEnd,
        today,
    });
    return `WITH ${planCtes.sql},
${accountCtes.sql},
promotion_combined_classified AS (
  SELECT
    p.*,
    CASE
      WHEN ${(0, qianchuan_sql_1.livePromotionPlanCondition)('p')} THEN 'LIVE_PROM_GOODS'
      WHEN p.marketing_goal_code = 'LIVE_PROM_GOODS' THEN 'LIVE_PROM_GOODS'
      WHEN p.marketing_goal_code = 'VIDEO_PROM_GOODS' THEN 'VIDEO_PROM_GOODS'
      ELSE 'UNMAPPED'
    END AS resolved_scene_code
  FROM ${planCtes.normalizedCte} p
),
plan_scene_account AS (
  SELECT
    report_date,
    advertiser_id,
    resolved_scene_code,
    ROUND(SUM(cost_yuan), 2) AS visible_cost_yuan,
    CASE WHEN COUNT(attributed_gmv_yuan) > 0
      THEN ROUND(SUM(attributed_gmv_yuan), 2)
      ELSE NULL END AS overall_transaction_yuan,
    SUM(CASE WHEN attributed_gmv_yuan IS NULL THEN 1 ELSE 0 END) AS overall_transaction_null_rows,
    COUNT(*) AS record_count,
    MAX(observed_at) AS source_updated_at
  FROM promotion_combined_classified
  GROUP BY report_date, advertiser_id, resolved_scene_code
),
plan_scene_daily AS (
  SELECT
    report_date,
    resolved_scene_code AS marketing_goal_code,
    ROUND(SUM(visible_cost_yuan), 2) AS plan_visible_cost_yuan,
    CASE WHEN COUNT(overall_transaction_yuan) > 0
      THEN ROUND(SUM(overall_transaction_yuan), 2)
      ELSE NULL END AS overall_transaction_yuan,
    SUM(overall_transaction_null_rows) AS overall_transaction_null_rows,
    SUM(record_count) AS record_count,
    COUNT(DISTINCT advertiser_id) AS plan_advertiser_count,
    MAX(source_updated_at) AS source_updated_at
  FROM plan_scene_account
  GROUP BY report_date, resolved_scene_code
),
account_scene_daily AS (
  SELECT
    report_date,
    'LIVE_PROM_GOODS' AS marketing_goal_code,
    CASE WHEN COUNT(live_prom_goods_cost_yuan) > 0
      THEN ROUND(SUM(live_prom_goods_cost_yuan), 2)
      ELSE NULL END AS cost_yuan,
    SUM(CASE WHEN live_prom_goods_cost_yuan IS NULL THEN 1 ELSE 0 END) AS account_cost_null_rows,
    COUNT(DISTINCT CASE WHEN live_prom_goods_cost_yuan IS NOT NULL THEN advertiser_id END) AS advertiser_count,
    COUNT(DISTINCT CASE WHEN is_day_end_snapshot = 1 THEN advertiser_id END) AS day_end_account_count,
    ${qianchuan_sql_1.QIANCHUAN_EXPECTED_DAY_END_ACCOUNT_COUNT} AS expected_account_count,
    MAX(observed_at) AS source_updated_at
  FROM ${accountCtes.normalizedCte}
  GROUP BY report_date

  UNION ALL

  SELECT
    report_date,
    'VIDEO_PROM_GOODS' AS marketing_goal_code,
    CASE WHEN COUNT(video_prom_goods_cost_yuan) > 0
      THEN ROUND(SUM(video_prom_goods_cost_yuan), 2)
      ELSE NULL END AS cost_yuan,
    SUM(CASE WHEN video_prom_goods_cost_yuan IS NULL THEN 1 ELSE 0 END) AS account_cost_null_rows,
    COUNT(DISTINCT CASE WHEN video_prom_goods_cost_yuan IS NOT NULL THEN advertiser_id END) AS advertiser_count,
    COUNT(DISTINCT CASE WHEN is_day_end_snapshot = 1 THEN advertiser_id END) AS day_end_account_count,
    ${qianchuan_sql_1.QIANCHUAN_EXPECTED_DAY_END_ACCOUNT_COUNT} AS expected_account_count,
    MAX(observed_at) AS source_updated_at
  FROM ${accountCtes.normalizedCte}
  GROUP BY report_date
),
scene_dates AS (
  SELECT report_date, marketing_goal_code FROM account_scene_daily
  UNION
  SELECT report_date, marketing_goal_code FROM plan_scene_daily
  WHERE marketing_goal_code IN ('LIVE_PROM_GOODS', 'VIDEO_PROM_GOODS')
),
scene_daily AS (
  SELECT
    d.report_date,
    d.marketing_goal_code,
    a.cost_yuan,
    p.overall_transaction_yuan,
    COALESCE(p.record_count, 0) AS record_count,
    COALESCE(a.advertiser_count, 0) AS advertiser_count,
    COALESCE(a.day_end_account_count, 0) AS day_end_account_count,
    COALESCE(a.expected_account_count, ${qianchuan_sql_1.QIANCHUAN_EXPECTED_DAY_END_ACCOUNT_COUNT}) AS expected_account_count,
    COALESCE(p.overall_transaction_null_rows, 1) AS overall_transaction_null_rows,
    COALESCE(a.account_cost_null_rows, 1) AS account_cost_null_rows,
    p.plan_visible_cost_yuan,
    CASE WHEN a.cost_yuan > 0 AND p.plan_visible_cost_yuan IS NOT NULL
      THEN ROUND(p.plan_visible_cost_yuan / a.cost_yuan * 100, 2)
      ELSE NULL END AS plan_cost_coverage_pct,
    GREATEST(
      COALESCE(a.source_updated_at, '1970-01-01 00:00:00'),
      COALESCE(p.source_updated_at, '1970-01-01 00:00:00')
    ) AS source_updated_at
  FROM scene_dates d
  LEFT JOIN account_scene_daily a
    ON a.report_date = d.report_date
   AND a.marketing_goal_code = d.marketing_goal_code
  LEFT JOIN plan_scene_daily p
    ON p.report_date = d.report_date
   AND p.marketing_goal_code = d.marketing_goal_code
),
unmapped_daily AS (
  SELECT
    report_date,
    marketing_goal_code,
    plan_visible_cost_yuan AS cost_yuan,
    overall_transaction_yuan,
    record_count,
    plan_advertiser_count AS advertiser_count,
    NULL AS day_end_account_count,
    ${qianchuan_sql_1.QIANCHUAN_EXPECTED_DAY_END_ACCOUNT_COUNT} AS expected_account_count,
    overall_transaction_null_rows,
    0 AS account_cost_null_rows,
    plan_visible_cost_yuan,
    NULL AS plan_cost_coverage_pct,
    source_updated_at
  FROM plan_scene_daily
  WHERE marketing_goal_code = 'UNMAPPED'
)
SELECT
  report_date, marketing_goal_code, cost_yuan, overall_transaction_yuan,
  record_count, advertiser_count, day_end_account_count, expected_account_count,
  overall_transaction_null_rows,
  account_cost_null_rows, plan_visible_cost_yuan, plan_cost_coverage_pct,
  source_updated_at
FROM scene_daily
UNION ALL
SELECT
  report_date, marketing_goal_code, cost_yuan, overall_transaction_yuan,
  record_count, advertiser_count, day_end_account_count, expected_account_count,
  overall_transaction_null_rows,
  account_cost_null_rows, plan_visible_cost_yuan, plan_cost_coverage_pct,
  source_updated_at
FROM unmapped_daily
ORDER BY report_date, marketing_goal_code`;
}
function materialProductCase(sourceProduct, platformSignal, creativeSignal, eyeVideoFlag) {
    return `CASE
    WHEN ${sourceProduct} IS NOT NULL THEN ${sourceProduct}
    WHEN ${platformSignal} LIKE '%眼膜%' OR ${platformSignal} LIKE '%晶润紧致眼%' THEN '晶润紧致眼膜'
    WHEN ${platformSignal} LIKE '%水润面膜%' OR ${platformSignal} LIKE '%隐形水润%' THEN '水润面膜'
    WHEN ${platformSignal} LIKE '%乳糖酸%' THEN '乳糖酸多效面膜'
    WHEN ${platformSignal} LIKE '%玻尿酸%' AND ${platformSignal} LIKE '%面膜%' THEN '玻尿酸极润面膜'
    WHEN ${platformSignal} LIKE '%黑晶%' THEN '黑晶光蕴面膜'
    WHEN ${platformSignal} LIKE '%痘肌修护%' THEN '痘肌修护面膜'
    WHEN ${platformSignal} LIKE '%燕窝%' AND ${platformSignal} LIKE '%面膜%' THEN '燕窝面膜'
    WHEN ${platformSignal} LIKE '%美白针%' OR ${platformSignal} LIKE '%光感微珠%' THEN '美白针'
    WHEN ${platformSignal} LIKE '%蛋白喷雾%' THEN 'WIS肌活蛋白喷雾'
    WHEN ${platformSignal} LIKE '%极润%' THEN '极润紧肤护肤套装'
    WHEN ${platformSignal} LIKE '%深海%' OR ${platformSignal} LIKE '%次抛%' THEN '深海次抛精华'
    WHEN ${platformSignal} LIKE '%凝颜%' THEN '凝颜护肤系列'
    WHEN ${platformSignal} LIKE '%时光精粹%' THEN '时光精粹护肤套装'
    WHEN ${platformSignal} LIKE '%水杨酸%' THEN '水杨酸控油净颜泥膜'
    WHEN ${creativeSignal} LIKE '%眼膜%' OR ${creativeSignal} LIKE '%晶润紧致眼%' THEN '晶润紧致眼膜'
    WHEN ${creativeSignal} LIKE '%水润面膜%' OR ${creativeSignal} LIKE '%隐形水润%' THEN '水润面膜'
    WHEN ${creativeSignal} LIKE '%乳糖酸%' THEN '乳糖酸多效面膜'
    WHEN ${creativeSignal} LIKE '%黑晶%' THEN '黑晶光蕴面膜'
    WHEN ${creativeSignal} LIKE '%燕窝%' AND ${creativeSignal} LIKE '%面膜%' THEN '燕窝面膜'
    WHEN ${creativeSignal} LIKE '%美白针%' OR ${creativeSignal} LIKE '%光感微珠%' THEN '美白针'
    WHEN ${creativeSignal} LIKE '%蛋白喷雾%' THEN 'WIS肌活蛋白喷雾'
    WHEN ${creativeSignal} LIKE '%极润%' THEN '极润紧肤护肤套装'
    WHEN ${creativeSignal} LIKE '%深海%' OR ${creativeSignal} LIKE '%次抛%' THEN '深海次抛精华'
    WHEN ${creativeSignal} LIKE '%凝颜%' THEN '凝颜护肤系列'
    WHEN ${creativeSignal} LIKE '%时光精粹%' THEN '时光精粹护肤套装'
    WHEN ${creativeSignal} LIKE '%水杨酸%' THEN '水杨酸控油净颜泥膜'
    WHEN ${eyeVideoFlag} = 1 THEN '晶润紧致眼膜'
    ELSE '待映射'
  END`;
}
function materialMappingBasisCase(sourceProduct, platformSignal, creativeSignal, eyeVideoFlag) {
    const productKeywords = '眼膜|晶润紧致眼|水润面膜|隐形水润|乳糖酸|玻尿酸|黑晶|痘肌修护|燕窝|美白针|光感微珠|蛋白喷雾|极润|深海|次抛|凝颜|时光精粹|水杨酸';
    return `CASE
    WHEN ${sourceProduct} IS NOT NULL THEN 'source'
    WHEN ${platformSignal} REGEXP '${productKeywords}' THEN 'platform_product'
    WHEN ${creativeSignal} REGEXP '${productKeywords}' THEN 'keyword'
    WHEN ${eyeVideoFlag} = 1 THEN 'account'
    ELSE 'unmapped'
  END`;
}
function buildMaterialSql(startDate, endDate, todayValue = shanghaiTodayStr()) {
    const defaultEnd = offsetDateStr(todayValue, -1);
    const end = validDateStr(endDate, defaultEnd);
    const start = validDateStr(startDate, `${end.slice(0, 7)}-01`);
    const actualStart = start > end ? end : start;
    const actualEnd = end < start ? start : end;
    const snapshots = (0, qianchuan_sql_1.buildMaterialSnapshotCtes)({
        prefix: 'material_performance',
        startDate: actualStart,
        endDate: actualEnd,
        today: todayValue,
    });
    const sourceProduct = "COALESCE(CASE WHEN m.internal_product_name NOT IN ('', '待映射') THEN m.internal_product_name END, a.source_product)";
    const classifiedProduct = materialProductCase(sourceProduct, 'a.platform_product_signal', 'a.creative_signal', 'm.eye_video_flag');
    const classifiedBasis = materialMappingBasisCase(sourceProduct, 'a.platform_product_signal', 'a.creative_signal', 'm.eye_video_flag');
    return `WITH ${snapshots.sql},
asset AS (
  SELECT
    advertiser_id,
    platform_material_type,
    material_id,
    first_seen_report_date,
    CASE WHEN internal_product_name NOT IN ('', '待映射') THEN internal_product_name END AS source_product,
    CONCAT_WS(' ', COALESCE(platform_product_names_json, ''), COALESCE(platform_products_json, '')) AS platform_product_signal,
    CONCAT_WS(' ', COALESCE(platform_material_name, ''), COALESCE(filename, ''), COALESCE(content_description, '')) AS creative_signal,
    CONCAT_WS(' ', COALESCE(business_tags_json, ''), COALESCE(platform_tags_json, ''), COALESCE(platform_material_name, ''), COALESCE(filename, ''), COALESCE(content_description, ''), COALESCE(material_source, ''), COALESCE(publisher_aweme_name, ''), COALESCE(platform_product_names_json, '')) AS tag_signal,
    NULLIF(platform_material_name, '') AS platform_material_name,
    NULLIF(filename, '') AS filename,
    platform_material_type AS material_type
  FROM ${qianchuan_sql_1.MATERIAL_ASSET_TABLE} FORCE INDEX (uk_qc_material_asset)
  WHERE ${(0, qianchuan_sql_1.wisAdvertiserCondition)('qianchuan_material_asset_ledger')}
), material_snapshot AS (
  SELECT
    m.*,
    CASE WHEN m.advertiser_id IN ('1758788274050062', '1864699162217866') THEN 1 ELSE 0 END AS eye_video_flag,
    COALESCE(m.stat_cost_for_roi2, 0) AS cost_yuan,
    COALESCE(m.total_pay_order_gmv_include_coupon_for_roi2, m.total_pay_order_gmv_for_roi2, 0) AS gmv_yuan,
    CONCAT_WS(' ', COALESCE(m.business_material_type, ''), COALESCE(m.content_description, '')) AS daily_tag_signal
  FROM ${snapshots.snapshotRowsCte} m
), enriched AS (
  SELECT
    m.report_date,
    m.advertiser_id,
    m.platform_material_type,
    m.material_id,
    m.marketing_goal,
    ${classifiedProduct} AS product_name,
    ${classifiedBasis} AS mapping_basis,
    COALESCE(a.platform_material_name, a.filename, m.material_name) AS material_name,
    COALESCE(a.material_type, m.platform_material_type, 'UNKNOWN') AS material_type,
    NULL AS advertiser_name,
    CASE WHEN a.tag_signal LIKE '%唠嗑%' THEN 1 ELSE 0 END AS chat_koc_flag,
    CASE WHEN LOWER(CONCAT_WS(' ', a.tag_signal, m.daily_tag_signal)) LIKE '%live%' THEN 1 ELSE 0 END AS live_image_flag,
    CASE
      WHEN a.first_seen_report_date = m.report_date
        OR DATE(m.material_online_time) = m.report_date THEN 1
      ELSE 0
    END AS is_new,
    m.cost_yuan,
    m.gmv_yuan,
    m.observed_at
  FROM material_snapshot m
  LEFT JOIN asset a
    ON a.advertiser_id = m.advertiser_id
   AND a.platform_material_type = m.platform_material_type
   AND a.material_id = m.material_id
)
SELECT
  report_date,
  material_id,
  material_name,
  material_type,
  product_name,
  mapping_basis,
  marketing_goal,
  advertiser_name,
  chat_koc_flag,
  live_image_flag,
  ROUND(cost_yuan, 2) AS cost_yuan,
  ROUND(gmv_yuan, 2) AS gmv_yuan,
  is_new,
  MAX(observed_at) OVER () AS source_updated_at
FROM enriched
WHERE material_type = 'VIDEO'
  AND gmv_yuan >= 20000
ORDER BY report_date DESC, gmv_yuan DESC
LIMIT 500`;
}
function buildMaterialOnlineSql(startDate, endDate) {
    const today = shanghaiTodayStr();
    const defaultEnd = offsetDateStr(today, -1);
    const end = validDateStr(endDate, defaultEnd);
    const start = validDateStr(startDate, `${end.slice(0, 7)}-01`);
    const actualStart = start > end ? end : start;
    const actualEnd = end < start ? start : end;
    const snapshots = (0, qianchuan_sql_1.buildMaterialSnapshotCtes)({
        prefix: 'material_online',
        startDate: actualStart,
        endDate: actualEnd,
        today,
    });
    return `WITH ${snapshots.sql},
asset_instances AS (
  SELECT
    DATE(a.platform_create_time) AS report_date,
    a.advertiser_id,
    a.platform_material_type,
    a.material_id,
    CASE WHEN a.internal_product_name NOT IN ('', '待映射') THEN a.internal_product_name END AS source_product,
    CONCAT_WS(' ', COALESCE(a.platform_product_names_json, ''), COALESCE(a.platform_products_json, '')) AS platform_product_signal,
    CONCAT_WS(' ', COALESCE(a.platform_material_name, ''), COALESCE(a.filename, ''), COALESCE(a.content_description, '')) AS creative_signal,
    CONCAT_WS(' ', COALESCE(a.business_tags_json, ''), COALESCE(a.platform_tags_json, ''), COALESCE(a.platform_material_name, ''), COALESCE(a.filename, ''), COALESCE(a.content_description, ''), COALESCE(a.material_source, ''), COALESCE(a.publisher_aweme_name, ''), COALESCE(a.platform_product_names_json, '')) AS tag_signal
  FROM ${qianchuan_sql_1.MATERIAL_ASSET_TABLE} a FORCE INDEX (uk_qc_material_asset)
  WHERE ${(0, qianchuan_sql_1.wisAdvertiserCondition)('a')}
    AND a.platform_create_time >= DATE('${actualStart}')
    AND a.platform_create_time < DATE_ADD(DATE('${actualEnd}'), INTERVAL 1 DAY)
), chengfang_instances AS (
  SELECT
    COALESCE(DATE(MIN(m.material_online_time)), MIN(m.report_date)) AS report_date,
    m.advertiser_id,
    m.platform_material_type,
    m.material_id,
    MAX(CASE WHEN m.internal_product_name NOT IN ('', '待映射') THEN m.internal_product_name END) AS source_product,
    GROUP_CONCAT(DISTINCT CAST(m.platform_product_ids_json AS CHAR) SEPARATOR ' ') AS platform_product_signal,
    GROUP_CONCAT(DISTINCT CONCAT_WS(' ', COALESCE(m.material_name, ''), COALESCE(m.content_description, '')) SEPARATOR ' ') AS creative_signal,
    GROUP_CONCAT(DISTINCT CONCAT_WS(' ', COALESCE(m.business_material_type, ''), COALESCE(m.material_name, ''), COALESCE(m.content_description, '')) SEPARATOR ' ') AS tag_signal
  FROM ${snapshots.snapshotRowsCte} m
  WHERE m.source_name = 'chengfang'
  GROUP BY m.advertiser_id, m.platform_material_type, m.material_id
  HAVING report_date >= DATE('${actualStart}')
     AND report_date < DATE_ADD(DATE('${actualEnd}'), INTERVAL 1 DAY)
), eligible_instances AS (
  SELECT * FROM asset_instances

  UNION ALL

  SELECT c.*
  FROM chengfang_instances c
  LEFT JOIN asset_instances a
    ON a.advertiser_id = c.advertiser_id
   AND a.platform_material_type = c.platform_material_type
   AND a.material_id = c.material_id
  WHERE a.material_id IS NULL
), daily AS (
  SELECT
    m.advertiser_id,
    m.platform_material_type,
    m.material_id,
    MAX(CASE WHEN m.internal_product_name NOT IN ('', '待映射') THEN m.internal_product_name END) AS daily_product,
    GROUP_CONCAT(DISTINCT CONCAT_WS(' ', COALESCE(m.business_material_type, ''), COALESCE(m.content_description, '')) SEPARATOR ' ') AS daily_tag_signal,
    MAX(CASE WHEN m.marketing_goal = 'VIDEO_PROM_GOODS' THEN 1 ELSE 0 END) AS direct_flag,
    MAX(CASE WHEN m.marketing_goal = 'LIVE_PROM_GOODS' THEN 1 ELSE 0 END) AS live_flag,
    MAX(CASE WHEN m.advertiser_id IN ('1758788274050062', '1864699162217866') THEN 1 ELSE 0 END) AS eye_video_flag,
    MAX(m.observed_at) AS source_updated_at
  FROM ${snapshots.snapshotRowsCte} m
  JOIN eligible_instances e
    ON e.advertiser_id = m.advertiser_id
   AND e.platform_material_type = m.platform_material_type
   AND e.material_id = m.material_id
  WHERE m.report_date >= e.report_date
  GROUP BY m.advertiser_id, m.platform_material_type, m.material_id
), classified AS (
  SELECT
    e.report_date,
    e.material_id,
    COALESCE(x.direct_flag, 0) AS direct_flag,
    COALESCE(x.live_flag, 0) AS live_flag,
    x.source_updated_at,
    CASE WHEN e.tag_signal LIKE '%唠嗑%' THEN 1 ELSE 0 END AS chat_koc_flag,
    CASE WHEN LOWER(CONCAT_WS(' ', e.tag_signal, x.daily_tag_signal)) LIKE '%live%' THEN 1 ELSE 0 END AS live_image_flag,
    ${materialProductCase('COALESCE(x.daily_product, e.source_product)', 'e.platform_product_signal', 'e.creative_signal', 'x.eye_video_flag')} AS product_name
  FROM eligible_instances e
  LEFT JOIN daily x
    ON x.advertiser_id = e.advertiser_id
   AND x.platform_material_type = e.platform_material_type
   AND x.material_id = e.material_id
)
SELECT
  report_date,
  SUM(COUNT(*)) OVER (PARTITION BY report_date) AS online_total,
  SUM(SUM(direct_flag)) OVER (PARTITION BY report_date) AS direct_online,
  SUM(SUM(live_flag)) OVER (PARTITION BY report_date) AS live_online,
  SUM(SUM(CASE WHEN product_name <> '待映射' THEN 1 ELSE 0 END)) OVER (PARTITION BY report_date) AS mapped_online,
  SUM(SUM(CASE WHEN product_name = '待映射' THEN 1 ELSE 0 END)) OVER (PARTITION BY report_date) AS unmapped_online,
  SUM(SUM(chat_koc_flag)) OVER (PARTITION BY report_date) AS chat_koc_online,
  SUM(SUM(live_image_flag)) OVER (PARTITION BY report_date) AS live_image_online,
  product_name,
  COUNT(*) AS product_online,
  MAX(source_updated_at) AS source_updated_at
FROM classified
GROUP BY report_date, product_name
ORDER BY report_date, CASE WHEN product_name = '待映射' THEN 1 ELSE 0 END, product_online DESC`;
}
function isRootDataUnavailableError(error) {
    if (!error)
        return false;
    return /公司登录状态无效|公司身份(?:服务)?(?:状态)?(?:已)?(?:无效|失效|过期|校验失败|请求超时)|身份校验(?:失败|无效)|未授权|Unauthorized|Forbidden|HTTP 40[13]|请求超时|timeout|timed out|HTTP 5\d\d|temporarily unavailable/i.test(error);
}
async function safeQuery(sql, limit = 500) {
    try {
        const result = await (0, mcp_1.executeCockpitSql)(sql, limit);
        return { rows: result.rows, error: null };
    }
    catch (error) {
        return {
            rows: [],
            error: error instanceof Error ? error.message : '查询失败',
        };
    }
}
function throwOnQueryErrors(scope, results) {
    const errors = [
        ...new Set(results
            .map((result) => result.error)
            .filter((error) => Boolean(error))),
    ];
    if (errors.length) {
        throw new Error(`${scope}根数据查询失败：${errors.join('；')}`);
    }
}
function requestedMaterialTo() {
    return new Date(Date.now() + 8 * 60 * 60 * 1000 - 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
}
function emptyMaterialSnapshot() {
    return {
        reportDate: null,
        availableFrom: null,
        availableTo: null,
        requestedTo: requestedMaterialTo(),
        dailyOnline: [],
        onlineTotal: null,
        directOnline: null,
        liveOnline: null,
        mappedOnline: null,
        unmappedOnline: null,
        mappingCoveragePct: null,
        chatKocOnline: null,
        liveImageOnline: null,
        productOnline: [],
        bigMaterialCount: 0,
        newBreakoutCount: 0,
        fastGrowthCount: null,
        bigMaterials: [],
        periodMaterials: [],
        newBreakouts: [],
        fastGrowthSignals: [],
        hourlySignalState: 'missing',
        onlineMetricNote: '素材数据将在进入素材页后单独加载，避免阻塞首页经营核心数据。',
    };
}
function buildMaterialSnapshot(materialRows, materialOnline, expectedTo = requestedMaterialTo()) {
    const mappedMaterials = materialRows.rows.map((row) => {
        const costYuan = number(row.cost_yuan);
        const gmvYuan = number(row.gmv_yuan);
        const materialId = String(row.material_id || '');
        const materialType = String(row.material_type || 'UNKNOWN');
        const productName = String(row.product_name || '待映射');
        const advertiserName = String(row.advertiser_name || 'WIS千川');
        const rawNameCandidate = String(row.material_name || '').trim();
        const rawName = rawNameCandidate &&
            rawNameCandidate !== materialId &&
            !/^\d{12,24}$/.test(rawNameCandidate)
            ? rawNameCandidate
            : '';
        const typeLabel = {
            VIDEO: '视频素材',
            IMAGE: '图片素材',
            TITLE: '标题素材',
            LIVE_ROOM: '直播间画面',
        }[materialType] || '素材';
        const basis = String(row.mapping_basis || 'unmapped');
        const mappingBasis = [
            'source',
            'platform_product',
            'keyword',
            'account',
        ].includes(basis)
            ? basis
            : 'unmapped';
        return {
            reportDate: String(row.report_date || ''),
            materialId,
            materialName: rawName ||
                `${productName === '待映射' ? advertiserName : productName} · ${typeLabel}`,
            materialType,
            videoUrl: null,
            tags: [
                number(row.chat_koc_flag) === 1 ? '唠嗑KOC' : null,
                number(row.live_image_flag) === 1 ? 'live图' : null,
            ].filter(Boolean),
            productName,
            mappingBasis,
            marketingGoal: String(row.marketing_goal || 'UNKNOWN'),
            gmvYuan,
            costYuan,
            roi: costYuan > 0 ? gmvYuan / costYuan : null,
            isNew: number(row.is_new) === 1,
        };
    });
    const onlineDates = [
        ...new Set(materialOnline.rows
            .map((row) => String(row.report_date || ''))
            .filter(Boolean)),
    ].sort();
    const reportDate = onlineDates.at(-1) ||
        String(materialRows.rows[0]?.report_date || '') ||
        null;
    const availableTo = onlineDates.at(-1) || null;
    const sourceLag = Boolean(availableTo && availableTo < expectedTo);
    const latestOnlineRows = reportDate
        ? materialOnline.rows.filter((row) => String(row.report_date) === reportDate)
        : [];
    const online = latestOnlineRows[0];
    const onlineTotal = online ? number(online.online_total) : null;
    const mappedOnline = online ? number(online.mapped_online) : null;
    const unmappedOnline = online ? number(online.unmapped_online) : null;
    const productOnline = latestOnlineRows
        .filter((row) => String(row.product_name || '') !== '待映射')
        .map((row) => ({
        productName: String(row.product_name),
        onlineCount: number(row.product_online),
    }))
        .sort((a, b) => b.onlineCount - a.onlineCount);
    const dailyOnline = onlineDates.map((date) => {
        const rows = materialOnline.rows.filter((row) => String(row.report_date) === date);
        const summary = rows[0];
        return {
            date,
            onlineTotal: number(summary?.online_total),
            directOnline: number(summary?.direct_online),
            liveOnline: number(summary?.live_online),
            mappedOnline: number(summary?.mapped_online),
            unmappedOnline: number(summary?.unmapped_online),
            chatKocOnline: number(summary?.chat_koc_online),
            liveImageOnline: number(summary?.live_image_online),
            productOnline: rows
                .filter((row) => String(row.product_name || '') !== '待映射')
                .map((row) => ({
                productName: String(row.product_name),
                onlineCount: number(row.product_online),
            }))
                .sort((a, b) => b.onlineCount - a.onlineCount),
        };
    });
    const latestMappedMaterials = reportDate
        ? mappedMaterials.filter((item) => item.reportDate === reportDate)
        : [];
    const allBigMaterials = latestMappedMaterials.filter((item) => item.materialType === 'VIDEO' && item.gmvYuan >= 20000);
    const allNewBreakouts = latestMappedMaterials.filter((item) => item.materialType === 'VIDEO' && item.isNew && item.gmvYuan >= 20000);
    const errors = [materialRows.error, materialOnline.error].filter(Boolean);
    const sourceTimes = [
        ...materialRows.rows.map((row) => String(row.source_updated_at || '')),
        ...materialOnline.rows.map((row) => String(row.source_updated_at || '')),
    ]
        .filter(Boolean)
        .sort();
    return {
        errors,
        sourceUpdatedAt: sourceTimes.at(-1) || null,
        sourceLag,
        snapshot: {
            reportDate,
            availableFrom: onlineDates[0] || null,
            availableTo,
            requestedTo: expectedTo,
            dailyOnline,
            onlineTotal,
            directOnline: online ? number(online.direct_online) : null,
            liveOnline: online ? number(online.live_online) : null,
            mappedOnline,
            unmappedOnline,
            mappingCoveragePct: onlineTotal && mappedOnline !== null
                ? (mappedOnline / onlineTotal) * 100
                : null,
            chatKocOnline: online ? number(online.chat_koc_online) : null,
            liveImageOnline: online ? number(online.live_image_online) : null,
            productOnline,
            bigMaterialCount: allBigMaterials.length,
            newBreakoutCount: allNewBreakouts.length,
            fastGrowthCount: null,
            bigMaterials: allBigMaterials.slice(0, 20),
            periodMaterials: mappedMaterials,
            newBreakouts: allNewBreakouts.slice(0, 20),
            fastGrowthSignals: [],
            hourlySignalState: 'missing',
            onlineMetricNote: `当前可核验上线量按“广告账户×素材”去重，统计平台素材创建时间落在所选日期范围内的素材，不要求同期产生消耗；live识别已覆盖业务标签、平台标签、素材名、文件名、内容描述、素材来源、发布抖音号与平台商品名。单品归属优先使用源字段与平台商品名，其次使用素材关键词和已核验眼膜专用账户规则。当前资产表仅覆盖已被投放链路发现且创建时间已回填的素材，因此该数值是可核验下限，不代表账户全量上传。${unmappedOnline ? `最新日仍有 ${unmappedOnline} 条素材因缺少可靠单品信号保留为待映射。` : '最新日已覆盖素材均已完成可核验映射。'}`,
        },
    };
}
const promotionSceneGlobal = globalThis;
const promotionSceneRuntime = promotionSceneGlobal.__wisCockpitPromotionSceneRuntime ?? {
    inFlight: new Map(),
};
promotionSceneGlobal.__wisCockpitPromotionSceneRuntime = promotionSceneRuntime;
/**
 * 推直播间与推商品并行使用已验证的现有索引，并共享缓存和并发请求。
 * 包含今天的查询缓存2分钟，纯历史范围缓存30分钟。
 */
async function queryPromotionSceneRows(startDate, endDate, force = false) {
    // v14: 两个推广场景恢复整体成交金额口径，并保留按自然日切片、最多 4 片并发；
    // 所有日期仍必须完整成功后才会合并和写缓存，日终继续按 23:45 口径。
    const cacheKey = `cockpit:promotion-scenes:v14:${startDate}:${endDate}`;
    if (!force) {
        const cached = await (0, cache_1.readCacheAllowStale)(cacheKey, 24 * 60 * 60 * 1000);
        if (cached) {
            if (cached.stale) {
                void queryPromotionSceneRows(startDate, endDate, true).catch((error) => {
                    console.warn('[PromotionScene] background refresh failed', error);
                });
            }
            return { rows: cached.payload, error: null };
        }
    }
    const runtimeKey = force ? `${cacheKey}:force` : cacheKey;
    const pending = promotionSceneRuntime.inFlight.get(runtimeKey);
    if (pending)
        return pending;
    const requestedDates = dateRange(startDate, endDate);
    const chunkSize = (0, mysql_1.isDirectMysqlConfigured)() ? 1 : requestedDates.length;
    const queryChunks = Array.from({ length: Math.ceil(requestedDates.length / chunkSize) }, (_, index) => {
        const chunk = requestedDates.slice(index * chunkSize, index * chunkSize + chunkSize);
        return { start: chunk[0], end: chunk.at(-1) };
    });
    const query = (async () => {
        const results = [];
        const concurrency = (0, mysql_1.isDirectMysqlConfigured)() ? 4 : 1;
        for (let index = 0; index < queryChunks.length; index += concurrency) {
            const batch = queryChunks.slice(index, index + concurrency);
            results.push(...await Promise.all(batch.map((chunk) => safeQuery(buildPromotionScenesSql(chunk.start, chunk.end), 800))));
        }
        return results;
    })()
        .then(async (results) => {
        const rows = results.flatMap((result) => result.rows);
        const errors = [
            ...new Set(results
                .map((result) => result.error)
                .filter((error) => Boolean(error))),
        ];
        const result = {
            rows,
            error: errors.length ? errors.join('；') : null,
        };
        if (!result.error && result.rows.length) {
            const ttlMs = endDate === shanghaiTodayStr() ? 2 * 60 * 1000 : 30 * 60 * 1000;
            await (0, cache_1.writeCache)(cacheKey, result.rows, new Date(Date.now() + ttlMs).toISOString(), 'mcp');
        }
        return result;
    })
        .finally(() => {
        promotionSceneRuntime.inFlight.delete(runtimeKey);
    });
    promotionSceneRuntime.inFlight.set(runtimeKey, query);
    return query;
}
function buildPromotionScene(dates, rows, scene) {
    const byDate = new Map(rows.map((row) => [String(row.report_date), row]));
    return dates.map((date) => {
        const row = byDate.get(date);
        if (!row) {
            return {
                date,
                scene,
                qianchuanCostYuan: null,
                qianchuanOverallTransactionYuan: null,
                adSharePct: null,
                advertiserCount: 0,
                recordCount: 0,
                planCostCoveragePct: null,
                state: 'missing',
                sourceUpdatedAt: null,
            };
        }
        const qianchuanCostYuan = nullableNumber(row.cost_yuan);
        const qianchuanOverallTransactionYuan = nullableNumber(row.overall_transaction_yuan);
        const planCostCoveragePct = nullableNumber(row.plan_cost_coverage_pct);
        const hasIncompleteOverallRows = number(row.overall_transaction_null_rows) > 0;
        const hasIncompleteAccountCost = number(row.account_cost_null_rows) > 0;
        const hasIncompletePlanCoverage = planCostCoveragePct === null || planCostCoveragePct < 98;
        return {
            date,
            scene,
            qianchuanCostYuan,
            qianchuanOverallTransactionYuan,
            adSharePct: qianchuanCostYuan !== null &&
                qianchuanOverallTransactionYuan !== null &&
                qianchuanOverallTransactionYuan > 0
                ? (qianchuanCostYuan / qianchuanOverallTransactionYuan) * 100
                : null,
            advertiserCount: number(row.advertiser_count),
            recordCount: number(row.record_count),
            planCostCoveragePct,
            state: qianchuanCostYuan === null && qianchuanOverallTransactionYuan === null
                ? 'missing'
                : qianchuanOverallTransactionYuan === null ||
                    hasIncompleteOverallRows ||
                    hasIncompleteAccountCost ||
                    hasIncompletePlanCoverage
                    ? 'partial'
                    : 'complete',
            sourceUpdatedAt: row.source_updated_at
                ? String(row.source_updated_at)
                : null,
        };
    });
}
function monthKeys() {
    // 月累计查询会返回7月之后的实时月份；这里必须与全年目标配置同步，
    // 不能固定只生成1–7月，否则8月起即使根数据已有记录也会在目标卡上显示为0。
    return Object.keys(GSV_TARGET_WAN).sort();
}
function buildTarget(monthly, operating, canViewProfit) {
    const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const currentMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const monthRow = monthly.find((item) => item.month === currentMonth);
    const quarter = Math.floor(now.getUTCMonth() / 3) + 1;
    const quarterStartMonth = (quarter - 1) * 3 + 1;
    const quarterMonths = Array.from({ length: 3 }, (_, index) => `${now.getUTCFullYear()}-${String(quarterStartMonth + index).padStart(2, '0')}`);
    const monthTargetWan = nullableNumber(process.env.WIS_TARGET_MONTH_WAN) ??
        GSV_TARGET_WAN[currentMonth] ??
        3297;
    const yearTargetWan = nullableNumber(process.env.WIS_TARGET_YEAR_WAN) ?? YEAR_GSV_TARGET_WAN;
    const quarterTargetWan = nullableNumber(process.env.WIS_TARGET_QUARTER_WAN) ??
        quarterMonths.reduce((sum, month) => sum + (GSV_TARGET_WAN[month] || 0), 0);
    const yearCompletedWan = monthly
        .filter((item) => item.month <= currentMonth)
        .reduce((sum, item) => sum + number(item.gsvYuan) / 10000, 0);
    const quarterCompletedWan = monthly
        .filter((item) => quarterMonths.includes(item.month))
        .reduce((sum, item) => sum + number(item.gsvYuan) / 10000, 0);
    const monthCompletedWan = number(monthRow?.gsvYuan) / 10000;
    const day = now.getUTCDate();
    const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
    const remainingDays = Math.max(daysInMonth - day + 1, 1);
    const today = now.toISOString().slice(0, 10);
    const todayCompletedWan = number(operating.find((item) => item.date === today)?.gsvYuan) / 10000;
    const todayTargetWan = Math.max((monthTargetWan - monthCompletedWan + todayCompletedWan) / remainingDays, 0);
    const todayPoint = operating.find((item) => item.date === today);
    const currentMonthAdYuan = monthRow?.qianchuanCostYuan === null ||
        monthRow?.qianchuanCostYuan === undefined
        ? null
        : monthRow.qianchuanCostYuan +
            (todayPoint?.qianchuanCostSource === 'hourly'
                ? todayPoint.qianchuanCostYuan || 0
                : 0);
    const monthProfit = canViewProfit
        ? profitForPeriod(currentMonth, day, number(monthRow?.gsvYuan), currentMonthAdYuan)
        : { profitYuan: null, profitMarginPct: null };
    const monthlySeries = Object.keys(GSV_TARGET_WAN)
        .sort()
        .map((month) => {
        const row = monthly.find((item) => item.month === month);
        const hasActual = month <= currentMonth &&
            row?.gsvYuan !== null &&
            row?.gsvYuan !== undefined;
        const profitMarginPct = !canViewProfit
            ? null
            : (CALIBRATED_PROFIT_MARGIN_PCT[month] ??
                (month === currentMonth ? monthProfit.profitMarginPct : null));
        return {
            month,
            label: `${Number(month.slice(5))}月`,
            targetWan: GSV_TARGET_WAN[month],
            actualWan: hasActual ? number(row?.gsvYuan) / 10000 : null,
            profitMarginTargetPct: PROFIT_MARGIN_TARGET_PCT[month],
            profitMarginPct,
        };
    });
    const weightedMargin = (rows, value, weight) => {
        const available = rows.filter((item) => item[value] !== null &&
            item[weight] !== null &&
            number(item[weight]) > 0);
        const totalWeight = available.reduce((sum, item) => sum + number(item[weight]), 0);
        return totalWeight > 0
            ? available.reduce((sum, item) => sum + number(item[value]) * number(item[weight]), 0) / totalWeight
            : null;
    };
    const card = (period, label, target, complete, rows) => {
        const actualMargin = canViewProfit
            ? weightedMargin(rows, 'profitMarginPct', 'actualWan')
            : null;
        const targetMargin = canViewProfit
            ? weightedMargin(rows, 'profitMarginTargetPct', 'targetWan')
            : null;
        return {
            period,
            label,
            targetWan: target,
            completedWan: complete,
            progressPct: target ? Math.min((complete / target) * 100, 100) : null,
            remainingWan: target ? Math.max(target - complete, 0) : null,
            state: target ? 'complete' : 'missing',
            profitMarginPct: actualMargin,
            profitMarginTargetPct: targetMargin,
            profitMarginVariancePctPoint: actualMargin !== null && targetMargin !== null
                ? actualMargin - targetMargin
                : null,
        };
    };
    const yearSeries = monthlySeries;
    const quarterSeries = monthlySeries.filter((item) => quarterMonths.includes(item.month));
    const monthSeries = monthlySeries.filter((item) => item.month === currentMonth);
    return {
        metric: 'GSV',
        cards: [
            card('year', `${now.getUTCFullYear()}年度`, yearTargetWan, yearCompletedWan, yearSeries),
            card('quarter', `Q${quarter}季度`, quarterTargetWan, quarterCompletedWan, quarterSeries),
            card('month', `${now.getUTCMonth() + 1}月`, monthTargetWan, monthCompletedWan, monthSeries),
        ],
        monthly: monthlySeries,
        todayTargetWan,
        todayCompletedWan,
        todayRemainingWan: Math.max(todayTargetWan - todayCompletedWan, 0),
        remainingDays,
        sourceLabel: '目标来自战略2.0规划图；1–6月实际GSV来自经营规划截图校准，7月起接数据库实时数据。',
    };
}
async function buildCockpit(identity = {}) {
    const session = resolveSession(identity);
    // 经营趋势通常命中发布预热快照；先取回再启动其余聚合，避免冷启动时六路重查询
    // 同时争抢只读数据库连接并触发 inactivity timeout。
    const operatingSnapshot = await getOperatingTrend();
    const monthlySnapshots = [];
    const monthlyRanges = [
        { start: '2026-06-11', end: '2026-06-30' },
        { start: '2026-07-01', end: '2026-07-31' },
        { start: '2026-08-01', end: shanghaiTodayStr() },
    ].filter((range) => range.start <= range.end);
    // 月度历史也复用按日分片的经营趋势查询；按月依次取数可避免一次扫描两个月订单，
    // 同时让每月结果独立落入持久缓存供不同权限视图共享。
    for (const range of monthlyRanges) {
        monthlySnapshots.push(await getOperatingTrend(range.start, range.end));
    }
    const [hourOrders, hourAds] = await Promise.all([
        safeQuery(hourlyOrderSql, 100),
        safeQuery(hourlyAdSql, 100),
    ]);
    // 复用已经按自然日分片并通过发布门禁的经营趋势快照，避免核心接口再次扫描
    // 15 天订单与账户日报而拖慢单品、素材等路由的页面壳。
    const operatingTrend = operatingSnapshot.items
        .filter((item) => item.gmvYuan !== null && item.gsvYuan !== null)
        .map((item) => {
        const gmvYuan = item.gmvYuan;
        const gsvYuan = item.gsvYuan;
        const cost = item.qianchuanCostYuan;
        return {
            date: item.period,
            gmvYuan,
            gsvYuan,
            refundYuan: item.refundYuan ?? 0,
            refundRatePct: item.refundRatePct,
            closedOrderCount: item.closedOrderCount ?? 0,
            totalOrderCount: item.totalOrderCount ?? 0,
            qianchuanCostYuan: cost,
            qianchuanCostSource: cost !== null ? 'daily' : null,
            dayEndAccountCount: item.dayEndAccountCount,
            expectedAccountCount: item.expectedAccountCount,
            incompleteDayCount: item.incompleteDayCount,
            roi: cost && cost > 0 ? gsvYuan / cost : null,
            adSharePct: item.adSharePct,
            profitYuan: session.canViewProfit ? item.profitYuan : null,
            profitMarginPct: session.canViewProfit ? item.profitMarginPct : null,
            orderCount: item.orderCount ?? 0,
            state: item.state,
        };
    });
    const hourOrderMap = new Map(hourOrders.rows.map((row) => [number(row.hour_no), row]));
    const hourAdMap = new Map(hourAds.rows.map((row) => [number(row.hour_no), row]));
    const hourly = Array.from({ length: 24 }, (_, hour) => {
        const order = hourOrderMap.get(hour);
        const ad = hourAdMap.get(hour);
        const gmvYuan = number(order?.gmv_yuan);
        const gsvYuan = number(order?.gsv_yuan);
        const cost = ad ? number(ad.cost_yuan) : null;
        return {
            hour,
            label: `${String(hour).padStart(2, '0')}:00–${String((hour + 1) % 24).padStart(2, '0')}:00`,
            gmvYuan,
            gsvYuan,
            refundYuan: number(order?.refund_yuan),
            qianchuanCostYuan: cost,
            roi: cost && cost > 0 ? gsvYuan / cost : null,
            adSharePct: cost && gsvYuan > 0 ? (cost / gsvYuan) * 100 : null,
            orderCount: number(order?.order_count),
            state: order && ad ? 'complete' : order || ad ? 'partial' : 'missing',
        };
    });
    // 当账户日报尚未产出当天记录时，以计划小时表的累计消耗补齐今日ROI。
    const todayKey = new Date(Date.now() + 8 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
    const costAlignedHours = hourly.filter((item) => item.qianchuanCostYuan !== null && item.qianchuanCostYuan > 0);
    const hourlyTodayCost = costAlignedHours.reduce((sum, item) => sum + (item.qianchuanCostYuan || 0), 0);
    const costAlignedGsv = costAlignedHours.reduce((sum, item) => sum + item.gsvYuan, 0);
    const todayOperatingIndex = operatingTrend.findIndex((item) => item.date === todayKey);
    if (todayOperatingIndex >= 0 &&
        !operatingTrend[todayOperatingIndex].qianchuanCostYuan &&
        hourlyTodayCost > 0) {
        const todayPoint = operatingTrend[todayOperatingIndex];
        operatingTrend[todayOperatingIndex] = {
            ...todayPoint,
            qianchuanCostYuan: hourlyTodayCost,
            qianchuanCostSource: 'hourly',
            roi: costAlignedGsv > 0 ? costAlignedGsv / hourlyTodayCost : null,
            adSharePct: costAlignedGsv > 0 ? (hourlyTodayCost / costAlignedGsv) * 100 : null,
            ...(session.canViewProfit
                ? dailyProfit(todayPoint.date, todayPoint.gsvYuan, hourlyTodayCost)
                : { profitYuan: null, profitMarginPct: null }),
            state: 'partial',
        };
    }
    const monthMetricMap = new Map();
    for (const snapshot of monthlySnapshots) {
        for (const item of snapshot.items) {
            const month = item.period.slice(0, 7);
            const metric = monthMetricMap.get(month) || {
                gmvYuan: 0,
                gsvYuan: 0,
                refundYuan: 0,
                totalOrderCount: 0,
                closedOrderCount: 0,
                qianchuanCostYuan: 0,
                hasOrders: false,
                hasCost: false,
            };
            if (item.gmvYuan !== null && item.gsvYuan !== null) {
                metric.gmvYuan += item.gmvYuan;
                metric.gsvYuan += item.gsvYuan;
                metric.refundYuan += item.refundYuan ?? 0;
                metric.totalOrderCount += item.totalOrderCount ?? 0;
                metric.closedOrderCount += item.closedOrderCount ?? 0;
                metric.hasOrders = true;
            }
            if (item.qianchuanCostYuan !== null) {
                metric.qianchuanCostYuan += item.qianchuanCostYuan;
                metric.hasCost = true;
            }
            monthMetricMap.set(month, metric);
        }
    }
    const monthlyHistory = monthKeys().map((month) => {
        const metric = monthMetricMap.get(month);
        const hasOrders = Boolean(metric?.hasOrders);
        const hasCost = Boolean(metric?.hasCost);
        const calibratedGsvWan = CALIBRATED_GSV_WAN[month];
        const isCalibrated = calibratedGsvWan !== undefined;
        const gmv = isCalibrated ? null : hasOrders ? metric.gmvYuan : null;
        const gsv = isCalibrated
            ? calibratedGsvWan * 10000
            : hasOrders
                ? metric.gsvYuan
                : null;
        const refund = isCalibrated
            ? null
            : hasOrders
                ? metric.refundYuan
                : null;
        const totalOrderCount = isCalibrated || !hasOrders
            ? null
            : metric.totalOrderCount;
        const closedOrderCount = isCalibrated || !hasOrders
            ? null
            : metric.closedOrderCount;
        const cost = hasCost ? metric.qianchuanCostYuan : null;
        const orderState = isCalibrated
            ? 'partial'
            : !hasOrders
                ? 'missing'
                : month < '2026-07'
                    ? 'partial'
                    : 'complete';
        const adState = !hasCost
            ? 'missing'
            : month === '2026-06'
                ? 'partial'
                : 'complete';
        return {
            month,
            targetGsvWan: GSV_TARGET_WAN[month] ?? null,
            gmvYuan: gmv,
            gsvYuan: gsv,
            gsvSource: isCalibrated ? 'calibration' : hasOrders ? 'mcp' : 'missing',
            refundYuan: refund,
            refundRatePct: totalOrderCount && closedOrderCount !== null
                ? (closedOrderCount / totalOrderCount) * 100
                : null,
            closedOrderCount,
            totalOrderCount,
            qianchuanCostYuan: cost,
            roi: gsv && cost ? gsv / cost : null,
            adSharePct: gsv && cost ? (cost / gsv) * 100 : null,
            orderState,
            adState,
            note: isCalibrated
                ? 'GSV按经营规划图校准；退款前GMV与完整千川待补'
                : orderState === 'missing' && adState === 'missing'
                    ? '源表暂无历史数据'
                    : orderState === 'partial' || adState === 'partial'
                        ? '当月仅覆盖部分日期'
                        : null,
        };
    });
    // 首屏只返回经营核心数据。素材与场景进入对应页面后通过独立接口加载。
    const materialRows = {
        rows: [],
        error: null,
    };
    const materialOnline = {
        rows: [],
        error: null,
    };
    const livePromotion = {
        rows: [],
        error: null,
    };
    const productPromotion = {
        rows: [],
        error: null,
    };
    const operatingDates = operatingTrend.map((item) => item.date);
    const promotionScenes = { live: [], product: [] };
    const liveSceneObservedDays = operatingDates.length;
    const productSceneObservedDays = operatingDates.length;
    const mappedMaterials = materialRows.rows.map((row) => {
        const costYuan = number(row.cost_yuan);
        const gmvYuan = number(row.gmv_yuan);
        const materialId = String(row.material_id || '');
        const materialType = String(row.material_type || 'UNKNOWN');
        const productName = String(row.product_name || '待映射');
        const advertiserName = String(row.advertiser_name || 'WIS千川');
        const rawNameCandidate = String(row.material_name || '').trim();
        const rawName = rawNameCandidate &&
            rawNameCandidate !== materialId &&
            !/^\d{12,24}$/.test(rawNameCandidate)
            ? rawNameCandidate
            : '';
        const typeLabel = {
            VIDEO: '视频素材',
            IMAGE: '图片素材',
            TITLE: '标题素材',
            LIVE_ROOM: '直播间画面',
        }[materialType] || '素材';
        const basis = String(row.mapping_basis || 'unmapped');
        const mappingBasis = [
            'source',
            'platform_product',
            'keyword',
            'account',
        ].includes(basis)
            ? basis
            : 'unmapped';
        return {
            reportDate: String(row.report_date || ''),
            materialId,
            materialName: rawName ||
                `${productName === '待映射' ? advertiserName : productName} · ${typeLabel}`,
            materialType,
            videoUrl: null,
            tags: [
                number(row.chat_koc_flag) === 1 ? '唠嗑KOC' : null,
                number(row.live_image_flag) === 1 ? 'live图' : null,
            ].filter(Boolean),
            productName,
            mappingBasis,
            marketingGoal: String(row.marketing_goal || 'UNKNOWN'),
            gmvYuan,
            costYuan,
            roi: costYuan > 0 ? gmvYuan / costYuan : null,
            isNew: number(row.is_new) === 1,
        };
    });
    const onlineDates = [
        ...new Set(materialOnline.rows
            .map((row) => String(row.report_date || ''))
            .filter(Boolean)),
    ].sort();
    const reportDate = onlineDates.at(-1) ||
        String(materialRows.rows[0]?.report_date || '') ||
        null;
    const requestedMaterialTo = new Date(Date.now() + 8 * 60 * 60 * 1000 - 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
    const materialAvailableTo = onlineDates.at(-1) || null;
    const materialSourceLag = materialAvailableTo && materialAvailableTo < requestedMaterialTo;
    const latestOnlineRows = reportDate
        ? materialOnline.rows.filter((row) => String(row.report_date) === reportDate)
        : [];
    const online = latestOnlineRows[0];
    const onlineTotal = online ? number(online.online_total) : null;
    const mappedOnline = online ? number(online.mapped_online) : null;
    const unmappedOnline = online ? number(online.unmapped_online) : null;
    const productOnline = latestOnlineRows
        .filter((row) => String(row.product_name || '') !== '待映射')
        .map((row) => ({
        productName: String(row.product_name),
        onlineCount: number(row.product_online),
    }))
        .sort((a, b) => b.onlineCount - a.onlineCount);
    const dailyOnline = onlineDates.map((date) => {
        const rows = materialOnline.rows.filter((row) => String(row.report_date) === date);
        const summary = rows[0];
        return {
            date,
            onlineTotal: number(summary?.online_total),
            directOnline: number(summary?.direct_online),
            liveOnline: number(summary?.live_online),
            mappedOnline: number(summary?.mapped_online),
            unmappedOnline: number(summary?.unmapped_online),
            chatKocOnline: number(summary?.chat_koc_online),
            liveImageOnline: number(summary?.live_image_online),
            productOnline: rows
                .filter((row) => String(row.product_name || '') !== '待映射')
                .map((row) => ({
                productName: String(row.product_name),
                onlineCount: number(row.product_online),
            }))
                .sort((a, b) => b.onlineCount - a.onlineCount),
        };
    });
    const latestMappedMaterials = reportDate
        ? mappedMaterials.filter((item) => item.reportDate === reportDate)
        : [];
    const allBigMaterials = latestMappedMaterials.filter((item) => item.materialType === 'VIDEO' && item.gmvYuan >= 20000);
    const allNewBreakouts = latestMappedMaterials.filter((item) => item.materialType === 'VIDEO' && item.isNew && item.gmvYuan >= 20000);
    const bigMaterials = allBigMaterials.slice(0, 20);
    const newBreakouts = allNewBreakouts.slice(0, 20);
    const errors = [
        hourOrders.error ? `小时订单：${hourOrders.error}` : null,
        hourAds.error ? `小时千川：${hourAds.error}` : null,
        materialRows.error,
        materialOnline.error,
        livePromotion.error,
        productPromotion.error,
    ].filter(Boolean);
    const coreRealtimeErrors = [
        hourOrders.error ? `小时订单：${hourOrders.error}` : null,
        hourAds.error ? `小时千川：${hourAds.error}` : null,
    ].filter(Boolean);
    const rootDataUnavailable = coreRealtimeErrors.length >= 2 &&
        coreRealtimeErrors.some(isRootDataUnavailableError);
    const sourceTimes = [
        ...materialRows.rows.map((row) => String(row.source_updated_at || '')),
        ...livePromotion.rows.map((row) => String(row.source_updated_at || '')),
        ...productPromotion.rows.map((row) => String(row.source_updated_at || '')),
    ]
        .filter(Boolean)
        .sort();
    const targets = buildTarget(monthlyHistory, operatingTrend, session.canViewProfit);
    return {
        generatedAt: new Date().toISOString(),
        factsDate: todayKey,
        timezone: 'Asia/Shanghai',
        sourceMode: errors.length || materialSourceLag ? 'partial' : 'live',
        session,
        operatingTrend,
        promotionScenes,
        hourly,
        monthlyHistory,
        materials: emptyMaterialSnapshot(),
        targets,
        criticalWork: session.canViewCriticalWork ? JULY_CRITICAL_WORK : null,
        criticalWorkStatus: session.canViewCriticalWork ? 'available' : 'forbidden',
        coverage: {
            orderMinDate: '2026-04-18',
            adMinDate: '2026-06-11',
            liveHourlyMinDate: '2026-06-17',
            materialMinDate: '2026-06-11',
            sourceUpdatedAt: sourceTimes.at(-1) || null,
            notes: [
                '1–6月GSV已按经营规划截图校准；截图未提供订单状态数量，因此不反推退款率。抖店明细源仍从2026-04-18开始。',
                'WIS千川账户日报从2026-06-11开始，6月为部分覆盖，1–5月待补。',
                '小时素材事实目前仅有计划粒度，没有单素材小时粒度，因此单素材每小时5000元信号暂不计算。',
                ...(liveSceneObservedDays < operatingDates.length ||
                    productSceneObservedDays < operatingDates.length
                    ? [
                        `千川计划小时明细当前仅覆盖推直播间 ${liveSceneObservedDays}/${operatingDates.length} 天、推商品 ${productSceneObservedDays}/${operatingDates.length} 天；缺失日期不补零，需由上游按千川计划接口回补历史。`,
                    ]
                    : []),
                ...(materialSourceLag
                    ? [
                        `素材上传台账当前仅到${materialAvailableTo}，已核验目标截止日${requestedMaterialTo}，其后缺失日期不补零。`,
                    ]
                    : []),
                ...(unmappedOnline
                    ? [
                        `最新素材日仍有${unmappedOnline}条素材缺少可靠单品映射，未做推断归属。`,
                    ]
                    : []),
            ],
        },
        caveats: [
            ...(rootDataUnavailable
                ? [
                    '根数据服务暂时不可访问：当前页面的空白或缺失不代表当日经营数据为 0；系统已自动重试，请在服务恢复后重新刷新。',
                ]
                : []),
            'GMV/GSV按支付时间归属；退款率按下单时间归属，公式为order_status=4的已关闭订单数÷全部订单数，按平台主订单号去重。',
            '退款率是订单数量口径，不使用已关闭订单金额÷GMV；关闭状态会延迟回写，历史比例随刷新校准。',
            '1–6月校准截图只提供GSV实际完成额；对应GMV、退款率与完整千川消耗仍显示待补。',
            '广告占比=千川消耗/GSV；素材页的ROI仅用于单素材放量效率判断，不再作为总体经营主指标。',
            '推直播间/推商品图的消耗统一取账户小时表场景总消耗，整体成交金额取计划明细total_pay_order_gmv_include_coupon_for_roi2（缺失时回退total_pay_order_gmv_for_roi2）；覆盖不足时标记部分，不使用抖店GSV替代。',
            ...errors.map((error) => `部分数据查询失败：${error}`),
        ],
    };
}
const cockpitCache = new Map();
const cockpitInflight = new Map();
const cockpitRefreshFailures = new Map();
const COCKPIT_CACHE_TTL_MS = 5 * 60 * 1000;
const materialSnapshotCache = new Map();
const materialSnapshotInflight = new Map();
const MATERIAL_CACHE_TTL_MS = 10 * 60 * 1000;
function cockpitCacheKey(session) {
    return [
        session.canViewProfit ? 'profit' : 'no-profit',
        session.canViewCriticalWork ? 'critical' : 'basic',
    ].join(':');
}
function cockpitPersistentCacheKey(key) {
    return `cockpit:core:v1:${key}`;
}
function cockpitRefreshFailed(payload) {
    return payload.caveats.some((item) => item.includes('根数据服务暂时不可访问') ||
        item.includes('部分数据查询失败'));
}
function payloadForSession(payload, session) {
    return {
        ...payload,
        session,
    };
}
function snapshotState(payload, status, failure) {
    return {
        ...payload,
        sourceMode: status === 'fresh' ? payload.sourceMode : 'partial',
        freshness: {
            status,
            lastSuccessAt: payload.generatedAt,
            ...(failure ? { lastAttemptAt: failure.at, error: failure.error } : {}),
        },
        caveats: status === 'fresh' ? payload.caveats : [
            `当前展示最后成功快照（${payload.generatedAt}），${status === 'refreshing' ? '最新数据正在后台刷新' : '本轮刷新未成功，请按快照实际日期使用'}。`,
            ...payload.caveats,
        ],
    };
}
function refreshCockpit(identity, session, key) {
    const existing = cockpitInflight.get(key);
    if (existing)
        return existing;
    const pending = buildCockpit(identity)
        .then(async (payload) => {
        const refreshFailed = cockpitRefreshFailed(payload);
        let lastGood = cockpitCache.get(key)?.payload ?? null;
        if (!lastGood) {
            const persisted = await (0, cache_1.readCacheAllowStale)(cockpitPersistentCacheKey(key), 24 * 60 * 60 * 1000);
            lastGood = persisted?.payload ?? null;
        }
        if (refreshFailed && lastGood) {
            const failure = { at: new Date().toISOString(), error: '根数据查询不完整' };
            cockpitRefreshFailures.set(key, failure);
            return snapshotState(lastGood, 'stale', failure);
        }
        if (refreshFailed) {
            const failureSummary = payload.caveats
                .filter((item) => item.includes('根数据服务暂时不可访问') ||
                item.includes('部分数据查询失败'))
                .join('；');
            throw new Error(`根数据查询不完整，未覆盖现有成功快照${failureSummary ? `：${failureSummary}` : ''}`);
        }
        cockpitRefreshFailures.delete(key);
        cockpitCache.set(key, { payload, refreshedAt: Date.now() });
        await (0, cache_1.writeCache)(cockpitPersistentCacheKey(key), payload, new Date(Date.now() + COCKPIT_CACHE_TTL_MS).toISOString(), 'verified-root-data');
        return snapshotState(payload, 'fresh');
    })
        .catch(error => {
        cockpitRefreshFailures.set(key, { at: new Date().toISOString(), error: '根数据刷新失败' });
        throw error;
    })
        .finally(() => {
        cockpitInflight.delete(key);
    });
    cockpitInflight.set(key, pending);
    return pending;
}
function warmCockpit(identity = {}) {
    if (process.env.NODE_ENV === 'test')
        return;
    const session = resolveSession(identity);
    const key = cockpitCacheKey(session);
    const cached = cockpitCache.get(key);
    if (cached && Date.now() - cached.refreshedAt < COCKPIT_CACHE_TTL_MS)
        return;
    const failure = cockpitRefreshFailures.get(key);
    if (failure && Date.now() - Date.parse(failure.at) < 60000)
        return;
    void refreshCockpit(identity, session, key).catch((error) => {
        console.warn('[Cockpit] background warm-up failed', error);
    });
}
async function getCockpit(identity = {}, force = false) {
    const session = resolveSession(identity);
    if (process.env.NODE_ENV === 'test')
        return buildCockpit(identity);
    const key = cockpitCacheKey(session);
    if (force) {
        const payload = await refreshCockpit(identity, session, key);
        return payloadForSession(payload, session);
    }
    const cached = cockpitCache.get(key);
    const age = cached
        ? Date.now() - cached.refreshedAt
        : Number.POSITIVE_INFINITY;
    if (cached && age < COCKPIT_CACHE_TTL_MS) {
        const failure = cockpitRefreshFailures.get(key);
        return payloadForSession(snapshotState(cached.payload, failure ? 'stale' : 'fresh', failure), session);
    }
    if (cached) {
        warmCockpit(identity);
        const failure = cockpitRefreshFailures.get(key);
        return payloadForSession(snapshotState(cached.payload, cockpitInflight.has(key) ? 'refreshing' : 'stale', failure), session);
    }
    const persisted = await (0, cache_1.readCacheAllowStale)(cockpitPersistentCacheKey(key), 24 * 60 * 60 * 1000);
    if (persisted) {
        cockpitCache.set(key, {
            payload: persisted.payload,
            refreshedAt: Math.min(Date.now(), persisted.expiresAt - COCKPIT_CACHE_TTL_MS),
        });
        if (persisted.stale) {
            void refreshCockpit(identity, session, key).catch((error) => {
                console.warn('[Cockpit] background persistent refresh failed', error);
            });
        }
        return payloadForSession(snapshotState(persisted.payload, persisted.stale ? 'refreshing' : 'fresh'), session);
    }
    const payload = await refreshCockpit(identity, session, key);
    return payloadForSession(payload, session);
}
function normalizeMaterialSnapshotRange(startDate, endDate) {
    const materialToday = shanghaiTodayStr();
    const latestCompleteDay = offsetDateStr(materialToday, -1);
    const requestedEnd = validDateStr(endDate, latestCompleteDay);
    const materialTo = requestedEnd > latestCompleteDay ? latestCompleteDay : requestedEnd;
    const requestedStart = validDateStr(startDate, offsetDateStr(materialTo, -14));
    const materialFrom = requestedStart > materialTo ? materialTo : requestedStart;
    return { materialToday, materialFrom, materialTo };
}
async function buildDeferredMaterialSnapshot(startDate, endDate) {
    const { materialToday, materialFrom, materialTo } = normalizeMaterialSnapshotRange(startDate, endDate);
    const ranges = (0, mysql_1.isDirectMysqlConfigured)()
        ? dateRange(materialFrom, materialTo).map((date) => ({ start: date, end: date }))
        : [{ start: materialFrom, end: materialTo }];
    const queryRange = async (buildSql, limit) => {
        const results = [];
        const concurrency = (0, mysql_1.isDirectMysqlConfigured)() ? 4 : 1;
        for (let index = 0; index < ranges.length; index += concurrency) {
            const batch = ranges.slice(index, index + concurrency);
            results.push(...await Promise.all(batch.map((range) => safeQuery(buildSql(range.start, range.end), limit))));
        }
        const errors = [
            ...new Set(results
                .map((result) => result.error)
                .filter((error) => Boolean(error))),
        ];
        return {
            rows: results.flatMap((result) => result.rows),
            error: errors.length ? errors.join('；') : null,
        };
    };
    const [materialRows, materialOnline] = await Promise.all([
        queryRange((from, to) => buildMaterialSql(from, to, materialToday), 1000),
        queryRange(buildMaterialOnlineSql, 500),
    ]);
    const built = buildMaterialSnapshot(materialRows, materialOnline, materialTo);
    if (built.errors.length &&
        !built.snapshot.periodMaterials.length &&
        !built.snapshot.dailyOnline.length) {
        throw new Error(`素材根数据查询失败：${built.errors.join('；')}`);
    }
    return built.snapshot;
}
function refreshMaterialSnapshot(startDate, endDate) {
    const { materialFrom, materialTo } = normalizeMaterialSnapshotRange(startDate, endDate);
    const key = `wis-douyin-materials:${materialFrom}:${materialTo}`;
    const existing = materialSnapshotInflight.get(key);
    if (existing)
        return existing;
    const pending = buildDeferredMaterialSnapshot(materialFrom, materialTo)
        .then(async (snapshot) => {
        materialSnapshotCache.set(key, { snapshot, refreshedAt: Date.now() });
        await (0, cache_1.writeCache)(key, snapshot, new Date(Date.now() + MATERIAL_CACHE_TTL_MS).toISOString(), 'mcp');
        return snapshot;
    })
        .finally(() => materialSnapshotInflight.delete(key));
    materialSnapshotInflight.set(key, pending);
    return pending;
}
async function getMaterialSnapshot(startDate, endDate, force = false) {
    const { materialFrom, materialTo } = normalizeMaterialSnapshotRange(startDate, endDate);
    const key = `wis-douyin-materials:${materialFrom}:${materialTo}`;
    const cached = materialSnapshotCache.get(key);
    if (process.env.NODE_ENV === 'test')
        return buildDeferredMaterialSnapshot(materialFrom, materialTo);
    if (!force && cached && Date.now() - cached.refreshedAt < MATERIAL_CACHE_TTL_MS)
        return cached.snapshot;
    if (!force && cached) {
        void refreshMaterialSnapshot(materialFrom, materialTo).catch((error) => {
            console.warn('[Materials] background refresh failed', error);
        });
        return {
            ...cached.snapshot,
            onlineMetricNote: `当前先展示最后成功快照（${new Date(cached.refreshedAt).toISOString()}），最新素材正在后台刷新。${cached.snapshot.onlineMetricNote}`,
        };
    }
    if (!force) {
        const persisted = await (0, cache_1.readCacheAllowStale)(key, 24 * 60 * 60 * 1000);
        if (persisted) {
            const refreshedAt = Math.min(Date.now(), persisted.expiresAt - MATERIAL_CACHE_TTL_MS);
            materialSnapshotCache.set(key, {
                snapshot: persisted.payload,
                refreshedAt,
            });
            if (persisted.stale) {
                void refreshMaterialSnapshot(materialFrom, materialTo).catch((error) => {
                    console.warn('[Materials] background refresh failed', error);
                });
                return {
                    ...persisted.payload,
                    onlineMetricNote: `当前先展示最后成功快照（${new Date(refreshedAt).toISOString()}），最新素材正在后台刷新。${persisted.payload.onlineMetricNote}`,
                };
            }
            return persisted.payload;
        }
    }
    return refreshMaterialSnapshot(materialFrom, materialTo);
}
function shanghaiTodayStr() {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(new Date());
}
function offsetDateStr(value, days) {
    const date = new Date(`${value}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}
function validDateStr(value, fallback) {
    return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
}
function dayCount(start, end) {
    const s = new Date(`${start}T00:00:00Z`).getTime();
    const e = new Date(`${end}T00:00:00Z`).getTime();
    return Math.round((e - s) / 86400000) + 1;
}
function weekKey(date) {
    const d = new Date(`${date}T00:00:00Z`);
    const day = d.getUTCDay();
    const diff = day === 0 ? 6 : day - 1;
    const monday = new Date(d.getTime() - diff * 86400000);
    return monday.toISOString().slice(0, 10);
}
function weekLabel(start) {
    const end = offsetDateStr(start, 6);
    return `${start.slice(5).replace('-', '/')}–${end.slice(5).replace('-', '/')}`;
}
function monthKey(date) {
    return date.slice(0, 7);
}
function monthLabel(month) {
    const [y, m] = month.split('-');
    return `${y}年${Number(m)}月`;
}
function resolveGranularity(start, end) {
    const days = dayCount(start, end);
    if (days <= 45)
        return 'day';
    if (days <= 180)
        return 'week';
    return 'month';
}
function buildOperatingSql(start, end) {
    const dailyQueries = dateRange(start, end).map((date) => `SELECT
  DATE('${date}') AS pay_date,
  p.gmv_yuan,
  p.gsv_yuan,
  p.refund_yuan,
  p.order_count,
  q.total_order_count,
  q.closed_order_count,
  COALESCE(GREATEST(p.pay_source_updated_at, q.order_source_updated_at), p.pay_source_updated_at, q.order_source_updated_at) AS source_updated_at
FROM (
  SELECT
    ROUND(SUM(o.order_pay_amount) / 100, 2) AS gmv_yuan,
    ROUND(SUM(CASE WHEN o.order_status <> '4' THEN o.order_pay_amount ELSE 0 END) / 100, 2) AS gsv_yuan,
    ROUND(SUM(CASE WHEN o.order_status = '4' THEN o.order_pay_amount ELSE 0 END) / 100, 2) AS refund_yuan,
    COUNT(*) AS order_count,
    MAX(o.updated_at) AS pay_source_updated_at
  FROM ${ORDER_TABLE} o FORCE INDEX (${ORDER_QUERY_INDEX})
  WHERE ${wisOrderFilter}
    AND o.pay_time >= '${date}'
    AND o.pay_time < DATE_ADD('${date}', INTERVAL 1 DAY)
) p
CROSS JOIN (
  SELECT
    COUNT(DISTINCT o.platform_order_no) AS total_order_count,
    COUNT(DISTINCT CASE WHEN o.order_status = '4' THEN o.platform_order_no END) AS closed_order_count,
    MAX(o.updated_at) AS order_source_updated_at
  FROM ${ORDER_TABLE} o FORCE INDEX (${ORDER_TIME_QUERY_INDEX})
  WHERE ${wisOrderFilter}
    AND o.order_time >= '${date}'
    AND o.order_time < DATE_ADD('${date}', INTERVAL 1 DAY)
) q
WHERE p.order_count > 0`);
    // 每天一个索引范围，避免长区间 GROUP BY DATE 产生临时表和文件排序。
    return `${dailyQueries.join('\nUNION ALL\n')}
ORDER BY pay_date`;
}
function buildAdDailySql(start, end) {
    const accountCtes = (0, qianchuan_sql_1.buildAccountSnapshotCtes)({
        prefix: 'requested_ad_daily',
        startDate: start,
        endDate: end,
        today: shanghaiTodayStr(),
    });
    return `WITH ${accountCtes.sql}
SELECT
  report_date,
  ROUND(SUM(COALESCE(total_cost_yuan, 0)), 2) AS cost_yuan,
  SUM(CASE WHEN data_status = 'COMPLETE' THEN 1 ELSE 0 END) AS complete_rows,
  COUNT(DISTINCT CASE WHEN is_day_end_snapshot = 1 THEN advertiser_id END) AS day_end_account_count,
  ${qianchuan_sql_1.QIANCHUAN_EXPECTED_DAY_END_ACCOUNT_COUNT} AS expected_account_count,
  CASE
    WHEN COUNT(DISTINCT CASE WHEN is_day_end_snapshot = 1 THEN advertiser_id END) = ${qianchuan_sql_1.QIANCHUAN_EXPECTED_DAY_END_ACCOUNT_COUNT}
    THEN 1 ELSE 0
  END AS reached_day_end,
  COUNT(*) AS row_count,
  MAX(observed_at) AS source_updated_at
FROM ${accountCtes.normalizedCte}
GROUP BY report_date
ORDER BY report_date`;
}
function buildProductTrendSql(start, end) {
    return `WITH RECURSIVE effective_orders AS (
    SELECT o.pay_time, o.sku_items, o.updated_at
    FROM ${ORDER_TABLE} o FORCE INDEX (${ORDER_QUERY_INDEX})
    WHERE ${wisOrderFilter}
      AND o.pay_time >= '${start}'
      AND o.pay_time < DATE_ADD('${end}', INTERVAL 1 DAY)
      AND o.order_status <> '4'
  ),
  seq AS (
    SELECT 0 AS n
    UNION ALL
    SELECT n + 1 FROM seq WHERE n < 49
  ),
  sku_lines AS (
    SELECT
      DATE(o.pay_time) AS pay_date,
      JSON_UNQUOTE(JSON_EXTRACT(o.sku_items, CONCAT('$[', seq.n, '].product_id'))) AS product_id,
      JSON_UNQUOTE(JSON_EXTRACT(o.sku_items, CONCAT('$[', seq.n, '].product_name'))) AS product_name,
      CAST(JSON_UNQUOTE(JSON_EXTRACT(o.sku_items, CONCAT('$[', seq.n, '].sku_pay_amount'))) AS UNSIGNED) AS sku_pay_amount,
      o.updated_at
    FROM effective_orders o
    JOIN seq ON seq.n < JSON_LENGTH(o.sku_items)
  ),
  categorized AS (
    SELECT
      pay_date,
      sku_pay_amount,
      updated_at,
      CASE
        -- 水润只计真正的水润面膜及其组合；向佐专链、乳糖酸和黑晶组合不归入水润。
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
      END AS product_name
    FROM sku_lines
    WHERE sku_pay_amount > 0
  ),
  product_daily AS (
    SELECT
      pay_date,
      product_name,
      ROUND(SUM(sku_pay_amount) / 100, 2) AS gsv_yuan,
      MAX(updated_at) AS source_updated_at
    FROM categorized
    GROUP BY pay_date, product_name
  )
  SELECT d.pay_date, d.product_name, d.gsv_yuan, d.source_updated_at
  FROM product_daily d
  ORDER BY d.pay_date, d.gsv_yuan DESC, d.product_name`;
}
/**
 * MySQL 直连使用原生 JSON_TABLE 展开 SKU；分类和聚合尾部复用兼容版 SQL，
 * 确保两条路径的单品口径始终一致。MCP 回退仍保留递归序列表达式。
 */
function buildProductTrendDirectSql(start, end) {
    const compatibleSql = buildProductTrendSql(start, end);
    const categorizedOffset = compatibleSql.indexOf('  categorized AS (');
    if (categorizedOffset < 0)
        throw new Error('单品趋势 SQL 分类片段缺失');
    return `WITH sku_lines AS (
    SELECT
      DATE(o.pay_time) AS pay_date,
      j.product_id,
      j.product_name,
      j.sku_pay_amount,
      o.updated_at
    FROM ${ORDER_TABLE} o FORCE INDEX (${ORDER_QUERY_INDEX})
    CROSS JOIN JSON_TABLE(
      o.sku_items,
      '$[*]' COLUMNS (
        product_id VARCHAR(64) PATH '$.product_id',
        product_name VARCHAR(512) PATH '$.product_name',
        sku_pay_amount BIGINT PATH '$.sku_pay_amount' NULL ON ERROR
      )
    ) AS j
    WHERE ${wisOrderFilter}
      AND o.pay_time >= '${start}'
      AND o.pay_time < DATE_ADD('${end}', INTERVAL 1 DAY)
      AND o.order_status <> '4'
  ),
${compatibleSql.slice(categorizedOffset)}`;
}
function buildRuntimeProductTrendSql(start, end) {
    return (0, mysql_1.isDirectMysqlConfigured)()
        ? buildProductTrendDirectSql(start, end)
        : buildProductTrendSql(start, end);
}
function buildProductAttributionSql(start, end) {
    const planCtes = (0, qianchuan_sql_1.buildPlanDailyNormalizedCtes)({
        prefix: 'product_attribution_plan',
        startExpression: `'${start}'`,
        endExpression: `'${end}'`,
        endInclusive: true,
        forceIndex: 'idx_qc_plan_material_daily_ad',
        dedupeAcrossSources: true,
    });
    const accountCtes = (0, qianchuan_sql_1.buildAccountLatestCtes)({
        prefix: 'product_attribution_account',
        startExpression: `'${start}'`,
        endExpression: `'${end}'`,
        endInclusive: true,
    });
    return `WITH ${planCtes.sql},
${accountCtes.sql},
plan_candidates AS (
  SELECT
    q.source_name,
    q.report_date,
    q.advertiser_id,
    q.ad_id,
    q.ad_name,
    q.marketing_goal_code,
    q.cost_yuan AS attributed_cost_yuan,
    q.observed_at,
    ${(0, qianchuan_sql_1.buildQianchuanProductAttributionCase)('q')} AS product_name
  FROM ${planCtes.normalizedCte} q
  WHERE q.cost_yuan > 0
    AND NOT (${(0, qianchuan_sql_1.livePromotionPlanCondition)('q')})
), live_account_candidates AS (
  SELECT
    'ACCOUNT_LIVE' AS source_name,
    q.report_date,
    q.advertiser_id,
    NULL AS ad_id,
    NULL AS ad_name,
    'LIVE_PROM_GOODS' AS marketing_goal_code,
    q.live_prom_goods_cost_yuan AS attributed_cost_yuan,
    q.observed_at,
    ${(0, qianchuan_sql_1.livePromotionAccountProductCase)('q')} AS product_name
  FROM ${accountCtes.normalizedCte} q
  WHERE q.live_prom_goods_cost_yuan > 0
    AND ${(0, qianchuan_sql_1.livePromotionAccountProductCase)('q')} IS NOT NULL
), attributed_candidates AS (
  SELECT * FROM plan_candidates
  UNION ALL
  SELECT * FROM live_account_candidates
), daily_product AS (
  SELECT
    report_date,
    product_name,
    ROUND(SUM(attributed_cost_yuan), 2) AS qianchuan_cost_yuan,
    COUNT(DISTINCT CONCAT(source_name, ':', advertiser_id)) AS advertiser_count,
    COUNT(DISTINCT CONCAT(source_name, ':', advertiser_id, ':', ad_id)) AS plan_count,
    MAX(observed_at) AS source_updated_at
  FROM attributed_candidates
  WHERE product_name IS NOT NULL
  GROUP BY report_date, product_name
)
SELECT
  report_date,
  product_name,
  qianchuan_cost_yuan,
  advertiser_count,
  plan_count,
  source_updated_at
FROM daily_product
ORDER BY report_date, product_name`;
}
async function queryOperatingTrend(startDate, endDate) {
    const today = shanghaiTodayStr();
    const end = validDateStr(endDate, today);
    const start = validDateStr(startDate, offsetDateStr(end, -14));
    const actualStart = start > end ? end : start;
    const actualEnd = end < start ? start : end;
    const granularity = resolveGranularity(actualStart, actualEnd);
    const requestedDates = dateRange(actualStart, actualEnd);
    const chunkSize = (0, mysql_1.isDirectMysqlConfigured)() ? 5 : requestedDates.length;
    const queryChunks = Array.from({ length: Math.ceil(requestedDates.length / chunkSize) }, (_, index) => {
        const chunk = requestedDates.slice(index * chunkSize, index * chunkSize + chunkSize);
        return { start: chunk[0], end: chunk.at(-1) };
    });
    const runChunks = async (buildSql) => {
        const results = [];
        const concurrency = (0, mysql_1.isDirectMysqlConfigured)() ? 4 : 1;
        for (let index = 0; index < queryChunks.length; index += concurrency) {
            const batch = queryChunks.slice(index, index + concurrency);
            results.push(...await Promise.all(batch.map((chunk) => safeQuery(buildSql(chunk.start, chunk.end), 100))));
        }
        return results;
    };
    const [orderResults, adResults] = await Promise.all([
        runChunks(buildOperatingSql),
        runChunks(buildAdDailySql),
    ]);
    throwOnQueryErrors('经营趋势', [...orderResults, ...adResults]);
    const orderRows = orderResults.flatMap((result) => result.rows);
    const adRows = adResults.flatMap((result) => result.rows);
    const adByDate = new Map(adRows.map((row) => [String(row.report_date), row]));
    const dailyPoints = orderRows.map((row) => {
        const date = String(row.pay_date);
        const ad = adByDate.get(date);
        const gmvYuan = number(row.gmv_yuan);
        const gsvYuan = number(row.gsv_yuan);
        const refundYuan = number(row.refund_yuan);
        const totalOrderCount = number(row.total_order_count);
        const closedOrderCount = number(row.closed_order_count);
        const cost = ad ? number(ad.cost_yuan) : null;
        const accountCoverage = ad
            ? dayEndCoverage(ad)
            : {
                dayEndAccountCount: 0,
                expectedAccountCount: qianchuan_sql_1.QIANCHUAN_EXPECTED_DAY_END_ACCOUNT_COUNT,
                complete: false,
            };
        const adComplete = ad
            ? number(ad.complete_rows) === number(ad.row_count) &&
                accountCoverage.complete
            : false;
        const state = !ad
            ? 'partial'
            : adComplete
                ? 'complete'
                : 'partial';
        const profit = dailyProfit(date, gsvYuan, cost);
        return {
            date,
            gmvYuan,
            gsvYuan,
            refundYuan,
            refundRatePct: totalOrderCount > 0 ? (closedOrderCount / totalOrderCount) * 100 : null,
            closedOrderCount,
            totalOrderCount,
            qianchuanCostYuan: cost,
            dayEndAccountCount: accountCoverage.dayEndAccountCount,
            expectedAccountCount: accountCoverage.expectedAccountCount,
            incompleteDayCount: accountCoverage.complete ? 0 : 1,
            adSharePct: cost && gsvYuan > 0 ? (cost / gsvYuan) * 100 : null,
            profitYuan: profit.profitYuan,
            profitMarginPct: profit.profitMarginPct,
            orderCount: number(row.order_count),
            state,
        };
    });
    const dailyDateSet = new Set(dailyPoints.map((p) => p.date));
    const todayPoint = dailyPoints.find((p) => p.date === today);
    const todayAdMissing = todayPoint && todayPoint.qianchuanCostYuan === null;
    const needsTodayFallback = actualEnd === today && (!todayPoint || todayAdMissing);
    if (needsTodayFallback) {
        const [hourOrderResult, hourAdResult] = await Promise.all([
            todayPoint
                ? Promise.resolve({
                    rows: [],
                    error: null,
                })
                : safeQuery(buildHourlyOrderSql(today), 50),
            safeQuery(buildHourlyAdSql(today), 50),
        ]);
        throwOnQueryErrors('经营趋势小时回退', [hourOrderResult, hourAdResult]);
        const hourCost = hourAdResult.rows.reduce((sum, row) => sum + number(row.cost_yuan), 0);
        const hasHourAd = hourAdResult.rows.length > 0;
        if (todayPoint && hasHourAd) {
            todayPoint.qianchuanCostYuan = hourCost;
            todayPoint.adSharePct =
                todayPoint.gsvYuan > 0 ? (hourCost / todayPoint.gsvYuan) * 100 : null;
            const profit = dailyProfit(today, todayPoint.gsvYuan, hourCost);
            todayPoint.profitYuan = profit.profitYuan;
            todayPoint.profitMarginPct = profit.profitMarginPct;
            todayPoint.dayEndAccountCount = 0;
            todayPoint.expectedAccountCount = qianchuan_sql_1.QIANCHUAN_EXPECTED_DAY_END_ACCOUNT_COUNT;
            todayPoint.incompleteDayCount = 1;
            todayPoint.state = 'partial';
        }
        else if (!todayPoint && (hourOrderResult.rows.length > 0 || hasHourAd)) {
            const hourGmv = hourOrderResult.rows.reduce((sum, row) => sum + number(row.gmv_yuan), 0);
            const hourGsv = hourOrderResult.rows.reduce((sum, row) => sum + number(row.gsv_yuan), 0);
            const hourRefund = hourOrderResult.rows.reduce((sum, row) => sum + number(row.refund_yuan), 0);
            const hourOrders = hourOrderResult.rows.reduce((sum, row) => sum + number(row.order_count), 0);
            const profit = dailyProfit(today, hourGsv, hasHourAd ? hourCost : null);
            dailyPoints.push({
                date: today,
                gmvYuan: hourGmv,
                gsvYuan: hourGsv,
                refundYuan: hourRefund,
                // 小时回退只按支付时间聚合，不能伪造下单时间口径的退款率。
                refundRatePct: null,
                closedOrderCount: 0,
                totalOrderCount: 0,
                qianchuanCostYuan: hasHourAd ? hourCost : null,
                dayEndAccountCount: 0,
                expectedAccountCount: qianchuan_sql_1.QIANCHUAN_EXPECTED_DAY_END_ACCOUNT_COUNT,
                incompleteDayCount: 1,
                adSharePct: hasHourAd && hourGsv > 0 ? (hourCost / hourGsv) * 100 : null,
                profitYuan: profit.profitYuan,
                profitMarginPct: profit.profitMarginPct,
                orderCount: hourOrders,
                state: 'partial',
            });
            dailyPoints.sort((a, b) => a.date.localeCompare(b.date));
        }
    }
    if (granularity === 'day') {
        return {
            items: dailyPoints.map((p) => ({
                period: p.date,
                periodLabel: p.date.slice(5).replace('-', '/'),
                gmvYuan: p.gmvYuan,
                gsvYuan: p.gsvYuan,
                refundYuan: p.refundYuan,
                refundRatePct: p.refundRatePct,
                closedOrderCount: p.closedOrderCount,
                totalOrderCount: p.totalOrderCount,
                qianchuanCostYuan: p.qianchuanCostYuan,
                dayEndAccountCount: p.dayEndAccountCount,
                expectedAccountCount: p.expectedAccountCount,
                incompleteDayCount: p.incompleteDayCount,
                adSharePct: p.adSharePct,
                profitYuan: p.profitYuan,
                profitMarginPct: p.profitMarginPct,
                orderCount: p.orderCount,
                state: p.state,
            })),
            granularity: 'day',
            startDate: actualStart,
            endDate: actualEnd,
        };
    }
    const groupKey = (date) => granularity === 'week' ? weekKey(date) : monthKey(date);
    const groupLabel = (key) => granularity === 'week' ? weekLabel(key) : monthLabel(key);
    const groups = new Map();
    for (const point of dailyPoints) {
        const key = groupKey(point.date);
        const list = groups.get(key) || [];
        list.push(point);
        groups.set(key, list);
    }
    const sortedKeys = [...groups.keys()].sort();
    const items = sortedKeys.map((key) => {
        const points = groups.get(key);
        const totalGmv = points.reduce((sum, p) => sum + p.gmvYuan, 0);
        const totalGsv = points.reduce((sum, p) => sum + p.gsvYuan, 0);
        const totalRefund = points.reduce((sum, p) => sum + p.refundYuan, 0);
        const totalClosedOrders = points.reduce((sum, p) => sum + p.closedOrderCount, 0);
        const totalPlacedOrders = points.reduce((sum, p) => sum + p.totalOrderCount, 0);
        const totalCost = points.reduce((sum, p) => sum + (p.qianchuanCostYuan || 0), 0);
        const hasCost = points.some((p) => p.qianchuanCostYuan !== null);
        const totalOrders = points.reduce((sum, p) => sum + p.orderCount, 0);
        const dayEndAccountCount = points.reduce((min, p) => Math.min(min, p.dayEndAccountCount), qianchuan_sql_1.QIANCHUAN_EXPECTED_DAY_END_ACCOUNT_COUNT);
        const expectedAccountCount = qianchuan_sql_1.QIANCHUAN_EXPECTED_DAY_END_ACCOUNT_COUNT;
        const incompleteDayCount = points.reduce((sum, p) => sum + p.incompleteDayCount, 0);
        const hasComplete = points.some((p) => p.state === 'complete');
        const hasPartial = points.some((p) => p.state === 'partial');
        const state = hasComplete && !hasPartial
            ? 'complete'
            : hasComplete || hasPartial
                ? 'partial'
                : 'missing';
        const monthKeyStr = key.slice(0, 7);
        const throughDay = granularity === 'week' ? 7 : points.length;
        const profit = hasCost && totalGsv > 0 && monthKeyStr >= PROFIT_CONFIG.effectiveFrom
            ? profitForPeriod(monthKeyStr, throughDay, totalGsv, totalCost)
            : { profitYuan: null, profitMarginPct: null };
        return {
            period: key,
            periodLabel: groupLabel(key),
            gmvYuan: totalGmv,
            gsvYuan: totalGsv,
            refundYuan: totalRefund,
            refundRatePct: totalPlacedOrders > 0
                ? (totalClosedOrders / totalPlacedOrders) * 100
                : null,
            closedOrderCount: totalClosedOrders,
            totalOrderCount: totalPlacedOrders,
            qianchuanCostYuan: hasCost ? totalCost : null,
            dayEndAccountCount,
            expectedAccountCount,
            incompleteDayCount,
            adSharePct: hasCost && totalGsv > 0 ? (totalCost / totalGsv) * 100 : null,
            profitYuan: profit.profitYuan,
            profitMarginPct: profit.profitMarginPct,
            orderCount: totalOrders,
            state,
        };
    });
    return {
        items,
        granularity,
        startDate: actualStart,
        endDate: actualEnd,
    };
}
const cockpitRuntime = globalThis;
const operatingTrendRuntime = cockpitRuntime.__wisCockpitOperatingTrendRuntime ?? {
    inFlight: new Map(),
};
cockpitRuntime.__wisCockpitOperatingTrendRuntime = operatingTrendRuntime;
/**
 * 经营趋势使用短缓存承接页面重复加载，并通过 in-flight Promise 合并同一时间范围的并发查询。
 * 今天及最近两个完整自然日仍可能发生订单状态回补，结果缓存2分钟；更早历史缓存30分钟。
 * 用户主动刷新时绕过持久缓存，并使用独立 in-flight 键避免复用旧查询。
 */
async function getOperatingTrend(startDate, endDate, force = false) {
    const today = shanghaiTodayStr();
    const end = validDateStr(endDate, today);
    const start = validDateStr(startDate, offsetDateStr(end, -14));
    const actualStart = start > end ? end : start;
    const actualEnd = end < start ? start : end;
    // v9: 仅在上海时间到达 23:45 后，将当天账户最后累计快照视为日终。
    const cacheKey = `cockpit:operating-trend:v9:${wisDouyinShopIdsSql}:${actualStart}:${actualEnd}`;
    if (!force) {
        const cached = await (0, cache_1.readCacheAllowStale)(cacheKey, 24 * 60 * 60 * 1000);
        if (cached) {
            if (cached.stale) {
                void getOperatingTrend(actualStart, actualEnd, true).catch((error) => {
                    console.warn('[OperatingTrend] background refresh failed', error);
                });
            }
            return cached.payload;
        }
    }
    const runtimeKey = force ? `${cacheKey}:force` : cacheKey;
    const pending = operatingTrendRuntime.inFlight.get(runtimeKey);
    if (pending)
        return pending;
    const query = queryOperatingTrend(actualStart, actualEnd)
        .then(async (response) => {
        // 空结果可能来自下游查询失败，不写缓存，避免把瞬时错误放大到整个缓存周期。
        if (response.items.length) {
            const mayStillBackfill = actualEnd >= offsetDateStr(today, -2);
            const ttlMs = mayStillBackfill ? 2 * 60 * 1000 : 30 * 60 * 1000;
            await (0, cache_1.writeCache)(cacheKey, response, new Date(Date.now() + ttlMs).toISOString(), 'mcp');
        }
        return response;
    })
        .finally(() => {
        operatingTrendRuntime.inFlight.delete(runtimeKey);
    });
    operatingTrendRuntime.inFlight.set(runtimeKey, query);
    return query;
}
async function queryProductTrend(startDate, endDate) {
    const today = shanghaiTodayStr();
    const end = validDateStr(endDate, today);
    const start = validDateStr(startDate, offsetDateStr(end, -14));
    const actualStart = start > end ? end : start;
    const actualEnd = end < start ? start : end;
    const granularity = resolveGranularity(actualStart, actualEnd);
    // 订单 SKU 展开在完整 15 天范围内可能超过公司网关超时。直连根库时按
    // 自然日拆分并行查询，再在服务端合并；日期区间互不重叠，不会重复计入。
    const requestedDates = dateRange(actualStart, actualEnd);
    const chunkSize = (0, mysql_1.isDirectMysqlConfigured)() ? 1 : requestedDates.length;
    const queryChunks = Array.from({ length: Math.ceil(requestedDates.length / chunkSize) }, (_, index) => {
        const chunk = requestedDates.slice(index * chunkSize, index * chunkSize + chunkSize);
        return { start: chunk[0], end: chunk.at(-1) };
    });
    const results = await Promise.all(queryChunks.map((chunk) => safeQuery(buildRuntimeProductTrendSql(chunk.start, chunk.end), 2000)));
    throwOnQueryErrors('单品趋势', results);
    const resultRows = results.flatMap((result) => result.rows);
    const dates = [
        ...new Set(resultRows.map((row) => String(row.pay_date))),
    ].sort();
    const productSet = new Set();
    const dailyMap = new Map();
    for (const row of resultRows) {
        const date = String(row.pay_date);
        const name = String(row.product_name || '其他单品');
        const amount = number(row.gsv_yuan);
        productSet.add(name);
        const dayMap = dailyMap.get(date) || new Map();
        dayMap.set(name, (dayMap.get(name) || 0) + amount);
        dailyMap.set(date, dayMap);
    }
    const productNames = [...productSet];
    if (granularity === 'day') {
        return {
            items: dates.map((date) => ({
                period: date,
                periodLabel: date.slice(5).replace('-', '/'),
                products: productNames.map((name) => ({
                    productName: name,
                    salesAmount: dailyMap.get(date)?.get(name) || 0,
                })),
            })),
            granularity: 'day',
            startDate: actualStart,
            endDate: actualEnd,
            productNames,
        };
    }
    const groupKeyFn = (date) => granularity === 'week' ? weekKey(date) : monthKey(date);
    const groupLabelFn = (key) => granularity === 'week' ? weekLabel(key) : monthLabel(key);
    const periodMap = new Map();
    for (const date of dates) {
        const key = groupKeyFn(date);
        const dayMap = dailyMap.get(date);
        if (!dayMap)
            continue;
        const period = periodMap.get(key) || new Map();
        for (const [name, amount] of dayMap) {
            period.set(name, (period.get(name) || 0) + amount);
        }
        periodMap.set(key, period);
    }
    const sortedKeys = [...periodMap.keys()].sort();
    return {
        items: sortedKeys.map((key) => ({
            period: key,
            periodLabel: groupLabelFn(key),
            products: productNames.map((name) => ({
                productName: name,
                salesAmount: periodMap.get(key)?.get(name) || 0,
            })),
        })),
        granularity,
        startDate: actualStart,
        endDate: actualEnd,
        productNames,
    };
}
function normalizedProductEconomicsName(name) {
    if (name.includes('深海') && (name.includes('次抛') || name.includes('弹嫩')))
        return '深海次抛精华';
    if (name.includes('眼膜'))
        return '晶润紧致眼膜';
    return name;
}
function dateRange(start, end) {
    const dates = [];
    for (let date = start; date <= end; date = offsetDateStr(date, 1))
        dates.push(date);
    return dates;
}
async function queryProductEconomics(startDate, endDate) {
    const today = shanghaiTodayStr();
    const latestCompleteDay = offsetDateStr(today, -1);
    const end = validDateStr(endDate, latestCompleteDay);
    const start = validDateStr(startDate, offsetDateStr(end, -14));
    const actualStart = start > end ? end : start;
    const actualEnd = end < start ? start : end;
    const requestedDates = dateRange(actualStart, actualEnd);
    const chunkSize = (0, mysql_1.isDirectMysqlConfigured)() ? 1 : requestedDates.length;
    const queryChunks = Array.from({ length: Math.ceil(requestedDates.length / chunkSize) }, (_, index) => {
        const chunk = requestedDates.slice(index * chunkSize, index * chunkSize + chunkSize);
        return { start: chunk[0], end: chunk.at(-1) };
    });
    const runChunks = async (buildSql, limit) => {
        const results = [];
        const concurrency = (0, mysql_1.isDirectMysqlConfigured)() ? 4 : 1;
        for (let index = 0; index < queryChunks.length; index += concurrency) {
            const batch = queryChunks.slice(index, index + concurrency);
            results.push(...await Promise.all(batch.map((chunk) => safeQuery(buildSql(chunk.start, chunk.end), limit))));
        }
        return results;
    };
    const [gsvResults, costResults] = await Promise.all([
        runChunks(buildRuntimeProductTrendSql, 1200),
        runChunks(buildProductAttributionSql, 500),
    ]);
    const gsvRows = gsvResults.flatMap((result) => result.rows);
    const costRows = costResults.flatMap((result) => result.rows);
    const gsvErrors = gsvResults
        .map((result) => result.error)
        .filter((error) => Boolean(error));
    const costErrors = costResults
        .map((result) => result.error)
        .filter((error) => Boolean(error));
    const gsvByDate = new Map();
    const costByDate = new Map();
    const gsvDates = new Set();
    const costProducts = new Set();
    const productTotals = new Map();
    let sourceUpdatedAt = null;
    for (const row of gsvRows) {
        const date = String(row.pay_date);
        const productName = normalizedProductEconomicsName(String(row.product_name || '其他单品'));
        const gsvYuan = number(row.gsv_yuan);
        gsvDates.add(date);
        const day = gsvByDate.get(date) || new Map();
        day.set(productName, (day.get(productName) || 0) + gsvYuan);
        gsvByDate.set(date, day);
        productTotals.set(productName, (productTotals.get(productName) || 0) + gsvYuan);
        const updatedAt = row.source_updated_at
            ? String(row.source_updated_at)
            : null;
        if (updatedAt && (!sourceUpdatedAt || updatedAt > sourceUpdatedAt))
            sourceUpdatedAt = updatedAt;
    }
    for (const row of costRows) {
        const date = String(row.report_date);
        const productName = normalizedProductEconomicsName(String(row.product_name));
        costProducts.add(productName);
        const day = costByDate.get(date) || new Map();
        day.set(productName, {
            costYuan: number(row.qianchuan_cost_yuan),
            advertiserCount: number(row.advertiser_count),
            planCount: number(row.plan_count),
            sourceUpdatedAt: row.source_updated_at
                ? String(row.source_updated_at)
                : null,
        });
        costByDate.set(date, day);
        const updatedAt = row.source_updated_at
            ? String(row.source_updated_at)
            : null;
        if (updatedAt && (!sourceUpdatedAt || updatedAt > sourceUpdatedAt))
            sourceUpdatedAt = updatedAt;
    }
    const attributedProductNames = [...ATTRIBUTED_PRODUCT_NAMES];
    const rankedProductNames = [...productTotals.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'))
        .map(([name]) => name);
    const productNames = [
        ...attributedProductNames.filter((name) => productTotals.has(name) || costProducts.has(name)),
        ...rankedProductNames.filter((name) => !attributedProductNames.includes(name)),
    ].sort((a, b) => (productTotals.get(b) || 0) - (productTotals.get(a) || 0) ||
        a.localeCompare(b, 'zh-CN'));
    return {
        items: dateRange(actualStart, actualEnd).map((date) => ({
            date,
            products: productNames.map((productName) => {
                const cost = costByDate.get(date)?.get(productName);
                return {
                    productName,
                    gsvYuan: gsvDates.has(date)
                        ? gsvByDate.get(date)?.get(productName) || 0
                        : null,
                    qianchuanCostYuan: cost?.costYuan ?? null,
                    advertiserCount: cost?.advertiserCount ?? 0,
                    planCount: cost?.planCount ?? 0,
                    costState: cost ? 'partial' : 'missing',
                    sourceUpdatedAt: cost?.sourceUpdatedAt ?? null,
                };
            }),
        })),
        startDate: actualStart,
        endDate: actualEnd,
        productNames,
        attributedProductNames,
        sourceUpdatedAt,
        caveats: [
            'GSV来自抖店订单SKU实付金额，按订单最新状态剔除order_status=4并合并同名单品。',
            '单品千川消耗为映射规则命中的全部账户、全部对应计划日终累计消耗之和；未映射计划不分摊，缺失日期不按0处理。',
            '黑晶直播间自2026-08-26起仅播黑晶，账户直播场景消耗归入黑晶；此前与深海次抛共播且无法拆分的历史仍保持未归因。',
            ...gsvErrors.map((error) => `部分单品GSV查询失败：${error}`),
            ...costErrors.map((error) => `部分单品千川查询失败：${error}`),
        ],
    };
}
const productEconomicsGlobal = globalThis;
const productEconomicsRuntime = productEconomicsGlobal.__wisCockpitProductEconomicsRuntime ?? {
    inFlight: new Map(),
};
productEconomicsGlobal.__wisCockpitProductEconomicsRuntime = productEconomicsRuntime;
async function getProductEconomics(startDate, endDate, force = false) {
    const today = shanghaiTodayStr();
    const latestCompleteDay = offsetDateStr(today, -1);
    const end = validDateStr(endDate, latestCompleteDay);
    const start = validDateStr(startDate, offsetDateStr(end, -14));
    const actualStart = start > end ? end : start;
    const actualEnd = end < start ? start : end;
    const cacheKey = `cockpit:product-economics:v2:${wisDouyinShopIdsSql}:${actualStart}:${actualEnd}`;
    if (!force) {
        const cached = await (0, cache_1.readCacheAllowStale)(cacheKey, 24 * 60 * 60 * 1000);
        if (cached) {
            if (cached.stale) {
                void getProductEconomics(actualStart, actualEnd, true).catch((error) => {
                    console.warn('[ProductEconomics] background refresh failed', error);
                });
            }
            return cached.payload;
        }
        const pending = productEconomicsRuntime.inFlight.get(cacheKey);
        if (pending)
            return pending;
    }
    const query = queryProductEconomics(actualStart, actualEnd)
        .then(async (response) => {
        const hasQueryFailure = response.caveats.some((item) => item.includes('查询失败'));
        if (!hasQueryFailure && response.items.length) {
            const ttlMs = actualEnd >= latestCompleteDay ? 2 * 60 * 1000 : 30 * 60 * 1000;
            await (0, cache_1.writeCache)(cacheKey, response, new Date(Date.now() + ttlMs).toISOString(), 'mcp');
        }
        return response;
    })
        .finally(() => {
        if (productEconomicsRuntime.inFlight.get(cacheKey) === query) {
            productEconomicsRuntime.inFlight.delete(cacheKey);
        }
    });
    productEconomicsRuntime.inFlight.set(cacheKey, query);
    return query;
}
const productTrendGlobal = globalThis;
const productTrendRuntime = productTrendGlobal.__wisCockpitProductTrendRuntime ?? {
    inFlight: new Map(),
};
productTrendGlobal.__wisCockpitProductTrendRuntime = productTrendRuntime;
/** 单品趋势与经营趋势使用相同的短缓存策略，避免重复展开订单SKU。 */
async function getProductTrend(startDate, endDate, force = false) {
    const today = shanghaiTodayStr();
    const end = validDateStr(endDate, today);
    const start = validDateStr(startDate, offsetDateStr(end, -14));
    const actualStart = start > end ? end : start;
    const actualEnd = end < start ? start : end;
    // v5: 15 天订单 SKU 查询改为分片执行，禁止复用可能由网关超时产生的旧缓存。
    const cacheKey = `cockpit:product-trend:v5:${wisDouyinShopIdsSql}:${actualStart}:${actualEnd}`;
    if (!force) {
        const cached = await (0, cache_1.readCacheAllowStale)(cacheKey, 24 * 60 * 60 * 1000);
        if (cached) {
            if (cached.stale) {
                void getProductTrend(actualStart, actualEnd, true).catch((error) => {
                    console.warn('[ProductTrend] background refresh failed', error);
                });
            }
            return cached.payload;
        }
    }
    const runtimeKey = force ? `${cacheKey}:force` : cacheKey;
    const pending = productTrendRuntime.inFlight.get(runtimeKey);
    if (pending)
        return pending;
    const query = queryProductTrend(actualStart, actualEnd)
        .then(async (response) => {
        if (response.items.length) {
            const ttlMs = actualEnd === today ? 2 * 60 * 1000 : 30 * 60 * 1000;
            await (0, cache_1.writeCache)(cacheKey, response, new Date(Date.now() + ttlMs).toISOString(), 'mcp');
        }
        return response;
    })
        .finally(() => {
        productTrendRuntime.inFlight.delete(runtimeKey);
    });
    productTrendRuntime.inFlight.set(runtimeKey, query);
    return query;
}
async function getPromotionSceneTrend(scene, startDate, endDate, force = false) {
    const today = shanghaiTodayStr();
    const end = validDateStr(endDate, today);
    const start = validDateStr(startDate, offsetDateStr(end, -14));
    const actualStart = start > end ? end : start;
    const actualEnd = end < start ? start : end;
    const granularity = resolveGranularity(actualStart, actualEnd);
    const marketingGoal = scene === 'live' ? 'LIVE_PROM_GOODS' : 'VIDEO_PROM_GOODS';
    const combinedResult = await queryPromotionSceneRows(actualStart, actualEnd, force);
    if (combinedResult.error) {
        throw new Error(`千川场景趋势根数据查询失败：${combinedResult.error}`);
    }
    const unmappedByDate = new Map(combinedResult.rows
        .filter((row) => row.marketing_goal_code === 'UNMAPPED')
        .map((row) => [String(row.report_date), row]));
    const result = {
        rows: combinedResult.rows.filter((row) => row.marketing_goal_code === marketingGoal),
        error: combinedResult.error,
    };
    const sceneByDate = new Map(result.rows.map((row) => [String(row.report_date), row]));
    const dailyPoints = dateRange(actualStart, actualEnd).map((date) => {
        const row = sceneByDate.get(date);
        const unmapped = unmappedByDate.get(date);
        const unmappedCostYuan = unmapped
            ? nullableNumber(unmapped.cost_yuan)
            : null;
        const unmappedOverallTransactionYuan = unmapped
            ? nullableNumber(unmapped.overall_transaction_yuan)
            : null;
        const unmappedRecordCount = unmapped ? number(unmapped.record_count) : 0;
        const hasUnmapped = (unmappedCostYuan ?? 0) > 0 ||
            (unmappedOverallTransactionYuan ?? 0) > 0 ||
            unmappedRecordCount > 0;
        if (!row) {
            return {
                date,
                qianchuanCostYuan: null,
                qianchuanOverallTransactionYuan: null,
                adSharePct: null,
                advertiserCount: 0,
                recordCount: 0,
                planCostCoveragePct: null,
                dayEndAccountCount: 0,
                expectedAccountCount: qianchuan_sql_1.QIANCHUAN_EXPECTED_DAY_END_ACCOUNT_COUNT,
                incompleteDayCount: 1,
                unmappedCostYuan,
                unmappedOverallTransactionYuan,
                unmappedRecordCount,
                state: hasUnmapped ? 'partial' : 'missing',
                sourceUpdatedAt: unmapped?.source_updated_at
                    ? String(unmapped.source_updated_at)
                    : null,
            };
        }
        const cost = nullableNumber(row.cost_yuan);
        const overallTransaction = nullableNumber(row.overall_transaction_yuan);
        const planCostCoveragePct = nullableNumber(row.plan_cost_coverage_pct);
        const hasCompleteOverall = Number(row.overall_transaction_null_rows) === 0;
        const hasCompleteAccountCost = Number(row.account_cost_null_rows) === 0;
        const accountCoverage = dayEndCoverage(row);
        const hasCompletePlanCoverage = planCostCoveragePct !== null && planCostCoveragePct >= 98;
        const hasReportedValue = cost !== null || overallTransaction !== null;
        const state = !hasReportedValue
            ? 'missing'
            : cost !== null &&
                overallTransaction !== null &&
                hasCompleteOverall &&
                hasCompleteAccountCost &&
                hasCompletePlanCoverage &&
                accountCoverage.complete &&
                !hasUnmapped
                ? 'complete'
                : 'partial';
        const shouldShowReturnedSubtotal = state === 'complete' || date < today;
        return {
            date,
            // 已结束日期即使覆盖不足，也展示根表确实返回的小计并保留 partial 标记；
            // 缺失账户/计划不补 0。当天尚未结束时继续等待日终快照，不展示为正式日值。
            qianchuanCostYuan: shouldShowReturnedSubtotal ? cost : null,
            qianchuanOverallTransactionYuan: shouldShowReturnedSubtotal
                ? overallTransaction
                : null,
            adSharePct: shouldShowReturnedSubtotal && overallTransaction && cost
                ? (cost / overallTransaction) * 100
                : null,
            advertiserCount: number(row.advertiser_count),
            recordCount: number(row.record_count),
            planCostCoveragePct,
            dayEndAccountCount: accountCoverage.dayEndAccountCount,
            expectedAccountCount: accountCoverage.expectedAccountCount,
            incompleteDayCount: accountCoverage.complete ? 0 : 1,
            unmappedCostYuan,
            unmappedOverallTransactionYuan,
            unmappedRecordCount,
            state,
            sourceUpdatedAt: row.source_updated_at
                ? String(row.source_updated_at)
                : null,
        };
    });
    // 两个场景消耗均来自账户小时表；整体成交来自计划明细的含券成交字段，
    // 缺失时回退不含券字段。已结束日期覆盖不足时展示已返回小计并保持 partial，
    // 不用 0 或抖店 GSV 补造；当天尚未结束时不把小时值当成正式日值。
    if (granularity === 'day') {
        return {
            items: dailyPoints.map((p) => ({
                period: p.date,
                periodLabel: p.date.slice(5).replace('-', '/'),
                qianchuanCostYuan: p.qianchuanCostYuan,
                qianchuanOverallTransactionYuan: p.qianchuanOverallTransactionYuan,
                adSharePct: p.adSharePct,
                advertiserCount: p.advertiserCount,
                recordCount: p.recordCount,
                planCostCoveragePct: p.planCostCoveragePct,
                dayEndAccountCount: p.dayEndAccountCount,
                expectedAccountCount: p.expectedAccountCount,
                incompleteDayCount: p.incompleteDayCount,
                unmappedCostYuan: p.unmappedCostYuan,
                unmappedOverallTransactionYuan: p.unmappedOverallTransactionYuan,
                unmappedRecordCount: p.unmappedRecordCount,
                state: p.state,
                sourceUpdatedAt: p.sourceUpdatedAt,
            })),
            granularity: 'day',
            startDate: actualStart,
            endDate: actualEnd,
            scene,
        };
    }
    const groupKeyFn = (date) => granularity === 'week' ? weekKey(date) : monthKey(date);
    const groupLabelFn = (key) => granularity === 'week' ? weekLabel(key) : monthLabel(key);
    const periodMap = new Map();
    for (const p of dailyPoints) {
        const key = groupKeyFn(p.date);
        const agg = periodMap.get(key) || {
            cost: 0,
            hasCost: false,
            overallTransaction: 0,
            hasOverallTransaction: false,
            advertiserCount: 0,
            recordCount: 0,
            planCostCoveragePct: null,
            dayEndAccountCount: qianchuan_sql_1.QIANCHUAN_EXPECTED_DAY_END_ACCOUNT_COUNT,
            expectedAccountCount: qianchuan_sql_1.QIANCHUAN_EXPECTED_DAY_END_ACCOUNT_COUNT,
            incompleteDayCount: 0,
            unmappedCost: 0,
            unmappedOverallTransaction: 0,
            unmappedRecordCount: 0,
            states: [],
            updatedAt: null,
        };
        if (p.qianchuanCostYuan !== null) {
            agg.cost += p.qianchuanCostYuan;
            agg.hasCost = true;
        }
        if (p.qianchuanOverallTransactionYuan !== null) {
            agg.overallTransaction += p.qianchuanOverallTransactionYuan;
            agg.hasOverallTransaction = true;
        }
        agg.advertiserCount = Math.max(agg.advertiserCount, p.advertiserCount);
        agg.recordCount += p.recordCount;
        agg.dayEndAccountCount = Math.min(agg.dayEndAccountCount, p.dayEndAccountCount);
        agg.expectedAccountCount = p.expectedAccountCount;
        agg.incompleteDayCount += p.incompleteDayCount;
        if (p.planCostCoveragePct !== null) {
            agg.planCostCoveragePct =
                agg.planCostCoveragePct === null
                    ? p.planCostCoveragePct
                    : Math.min(agg.planCostCoveragePct, p.planCostCoveragePct);
        }
        agg.unmappedCost += p.unmappedCostYuan ?? 0;
        agg.unmappedOverallTransaction +=
            p.unmappedOverallTransactionYuan ?? 0;
        agg.unmappedRecordCount += p.unmappedRecordCount ?? 0;
        agg.states.push(p.state);
        if (p.sourceUpdatedAt &&
            (!agg.updatedAt || p.sourceUpdatedAt > agg.updatedAt)) {
            agg.updatedAt = p.sourceUpdatedAt;
        }
        periodMap.set(key, agg);
    }
    const sortedKeys = [...periodMap.keys()].sort();
    return {
        items: sortedKeys.map((key) => {
            const agg = periodMap.get(key);
            const state = agg.states.every((s) => s === 'complete')
                ? 'complete'
                : agg.states.some((s) => s === 'complete' || s === 'partial')
                    ? 'partial'
                    : 'missing';
            return {
                period: key,
                periodLabel: groupLabelFn(key),
                qianchuanCostYuan: agg.hasCost ? agg.cost : null,
                qianchuanOverallTransactionYuan: agg.hasOverallTransaction
                    ? agg.overallTransaction
                    : null,
                adSharePct: agg.hasCost &&
                    agg.hasOverallTransaction &&
                    agg.overallTransaction > 0
                    ? (agg.cost / agg.overallTransaction) * 100
                    : null,
                advertiserCount: agg.advertiserCount,
                recordCount: agg.recordCount,
                planCostCoveragePct: agg.planCostCoveragePct,
                dayEndAccountCount: agg.dayEndAccountCount,
                expectedAccountCount: agg.expectedAccountCount,
                incompleteDayCount: agg.incompleteDayCount,
                unmappedCostYuan: agg.unmappedCost > 0 ? agg.unmappedCost : null,
                unmappedOverallTransactionYuan: agg.unmappedOverallTransaction > 0
                    ? agg.unmappedOverallTransaction
                    : null,
                unmappedRecordCount: agg.unmappedRecordCount,
                state,
                sourceUpdatedAt: agg.updatedAt,
            };
        }),
        granularity,
        startDate: actualStart,
        endDate: actualEnd,
        scene,
    };
}
async function getMaterialOnlineTrend(startDate, endDate) {
    const today = shanghaiTodayStr();
    const end = validDateStr(endDate, today);
    const start = validDateStr(startDate, offsetDateStr(end, -14));
    const actualStart = start > end ? end : start;
    const actualEnd = end < start ? start : end;
    const granularity = resolveGranularity(actualStart, actualEnd);
    const result = await safeQuery(buildMaterialOnlineSql(actualStart, actualEnd), 500);
    const dates = [
        ...new Set(result.rows.map((row) => String(row.report_date))),
    ].sort();
    const dailyMap = new Map();
    for (const row of result.rows) {
        const date = String(row.report_date);
        const day = dailyMap.get(date) || {
            onlineTotal: 0,
            directOnline: 0,
            liveOnline: 0,
            mappedOnline: 0,
            unmappedOnline: 0,
            chatKocOnline: 0,
            liveImageOnline: 0,
            productOnline: new Map(),
            sourceUpdatedAt: null,
        };
        if (!dailyMap.has(date)) {
            day.onlineTotal = number(row.online_total);
            day.directOnline = number(row.direct_online);
            day.liveOnline = number(row.live_online);
            day.mappedOnline = number(row.mapped_online);
            day.unmappedOnline = number(row.unmapped_online);
            day.chatKocOnline = number(row.chat_koc_online);
            day.liveImageOnline = number(row.live_image_online);
            day.sourceUpdatedAt = row.source_updated_at
                ? String(row.source_updated_at)
                : null;
            dailyMap.set(date, day);
        }
        else {
            const updatedAt = row.source_updated_at
                ? String(row.source_updated_at)
                : null;
            if (updatedAt &&
                (!day.sourceUpdatedAt || updatedAt > day.sourceUpdatedAt)) {
                day.sourceUpdatedAt = updatedAt;
            }
        }
        const productName = String(row.product_name || '待映射');
        day.productOnline.set(productName, number(row.product_online));
    }
    const availableFrom = dates[0] || null;
    const availableTo = dates.at(-1) || null;
    if (granularity === 'day') {
        return {
            items: dates.map((date) => {
                const day = dailyMap.get(date);
                return {
                    period: date,
                    periodLabel: date.slice(5).replace('-', '/'),
                    onlineTotal: day.onlineTotal,
                    directOnline: day.directOnline,
                    liveOnline: day.liveOnline,
                    mappedOnline: day.mappedOnline,
                    unmappedOnline: day.unmappedOnline,
                    chatKocOnline: day.chatKocOnline,
                    liveImageOnline: day.liveImageOnline,
                    productOnline: [...day.productOnline.entries()]
                        .map(([productName, onlineCount]) => ({ productName, onlineCount }))
                        .sort((a, b) => b.onlineCount - a.onlineCount),
                    state: 'partial',
                    sourceUpdatedAt: day.sourceUpdatedAt,
                };
            }),
            granularity: 'day',
            startDate: actualStart,
            endDate: actualEnd,
            availableFrom,
            availableTo,
        };
    }
    const groupKeyFn = (date) => granularity === 'week' ? weekKey(date) : monthKey(date);
    const groupLabelFn = (key) => granularity === 'week' ? weekLabel(key) : monthLabel(key);
    const periodMap = new Map();
    for (const date of dates) {
        const key = groupKeyFn(date);
        const day = dailyMap.get(date);
        if (!day)
            continue;
        const agg = periodMap.get(key) || {
            onlineTotal: 0,
            directOnline: 0,
            liveOnline: 0,
            mappedOnline: 0,
            unmappedOnline: 0,
            chatKocOnline: 0,
            liveImageOnline: 0,
            productOnline: new Map(),
            dates: 0,
            sourceUpdatedAt: null,
        };
        agg.onlineTotal += day.onlineTotal;
        agg.directOnline += day.directOnline;
        agg.liveOnline += day.liveOnline;
        agg.mappedOnline += day.mappedOnline;
        agg.unmappedOnline += day.unmappedOnline;
        agg.chatKocOnline += day.chatKocOnline;
        agg.liveImageOnline += day.liveImageOnline;
        agg.dates += 1;
        if (day.sourceUpdatedAt &&
            (!agg.sourceUpdatedAt || day.sourceUpdatedAt > agg.sourceUpdatedAt)) {
            agg.sourceUpdatedAt = day.sourceUpdatedAt;
        }
        for (const [name, count] of day.productOnline) {
            agg.productOnline.set(name, (agg.productOnline.get(name) || 0) + count);
        }
        periodMap.set(key, agg);
    }
    const sortedKeys = [...periodMap.keys()].sort();
    return {
        items: sortedKeys.map((key) => {
            const agg = periodMap.get(key);
            return {
                period: key,
                periodLabel: groupLabelFn(key),
                onlineTotal: agg.onlineTotal,
                directOnline: agg.directOnline,
                liveOnline: agg.liveOnline,
                mappedOnline: agg.mappedOnline,
                unmappedOnline: agg.unmappedOnline,
                chatKocOnline: agg.chatKocOnline,
                liveImageOnline: agg.liveImageOnline,
                productOnline: [...agg.productOnline.entries()]
                    .map(([productName, onlineCount]) => ({ productName, onlineCount }))
                    .sort((a, b) => b.onlineCount - a.onlineCount),
                state: 'partial',
                sourceUpdatedAt: agg.sourceUpdatedAt,
            };
        }),
        granularity,
        startDate: actualStart,
        endDate: actualEnd,
        availableFrom,
        availableTo,
    };
}
