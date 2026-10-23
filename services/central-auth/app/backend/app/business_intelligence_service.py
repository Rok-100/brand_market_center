from __future__ import annotations

import json
from copy import deepcopy
from datetime import date, datetime, timedelta
from pathlib import Path
from threading import Lock
from typing import Any, Callable

from .config import settings
from .personal_sales_service import FandowDataMcpClient, PersonalSalesError, SHANGHAI_TZ


class BusinessIntelligenceError(PersonalSalesError):
    pass


def _date_range(start: date, end: date) -> list[date]:
    return [start + timedelta(days=offset) for offset in range((end - start).days + 1)]


def _number(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _round2(value: Any) -> float:
    return round(_number(value) + 1e-9, 2)


def _max_timestamp(current: str, value: Any) -> str:
    candidate = str(value or "")
    return max(current, candidate) if candidate else current


def _product_sql(target: date, channel: str = "douyin") -> str:
    value = target.isoformat()
    following = (target + timedelta(days=1)).isoformat()
    if channel == "wechat":
        shop_filter = "o.shop_id = 1179"
        status_filter = "o.order_status NOT IN ('200', '250')"
    else:
        shop_filter = "o.shop_id IN (1099, 1100)"
        status_filter = "o.order_status <> '4'"
    return f"""WITH RECURSIVE effective_orders AS (
  SELECT o.pay_time, o.platform_order_no, o.sku_items, o.updated_at
  FROM d_root_project_order_db.platform_order_item_api_field o FORCE INDEX (idx_shop_pay_time)
  WHERE {shop_filter}
    AND o.pay_time >= TIMESTAMP('{value} 00:00:00')
    AND o.pay_time < TIMESTAMP('{following} 00:00:00')
    AND {status_filter}
),
seq AS (
  SELECT 0 AS n
  UNION ALL
  SELECT n + 1 FROM seq WHERE n < 49
),
sku_lines AS (
  SELECT
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
    platform_order_no, product_id, sku_pay_amount, product_quantity, updated_at,
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
      ELSE '其他未归类'
    END AS standard_product_name
  FROM sku_lines
  WHERE sku_pay_amount > 0
),
order_summary AS (
  SELECT COUNT(DISTINCT platform_order_no) AS effective_order_count,
    MAX(updated_at) AS order_source_updated_at
  FROM effective_orders
),
family_sales AS (
  SELECT
    standard_product_name,
    ROUND(SUM(sku_pay_amount) / 100, 2) AS effective_sales_yuan,
    COUNT(DISTINCT platform_order_no) AS order_count,
    SUM(product_quantity) AS product_quantity,
    COUNT(DISTINCT product_id) AS product_link_count,
    MAX(updated_at) AS source_updated_at
  FROM categorized
  GROUP BY standard_product_name
)
SELECT
  DATE('{value}') AS pay_date,
  f.standard_product_name,
  f.effective_sales_yuan,
  f.order_count,
  f.product_quantity,
  f.product_link_count,
  ROUND(f.effective_sales_yuan / NULLIF(SUM(f.effective_sales_yuan) OVER (), 0) * 100, 2) AS sales_share_pct,
  f.source_updated_at,
  o.effective_order_count,
  o.order_source_updated_at
FROM family_sales f
CROSS JOIN order_summary o
ORDER BY f.effective_sales_yuan DESC, f.standard_product_name"""


def _qianchuan_bounds(day: date) -> tuple[str, str]:
    following = day + timedelta(days=1)
    return f"{day.isoformat()} 23:30:00", f"{following.isoformat()} 00:00:00"


def _material_sql(day: date, source: str) -> str:
    value = day.isoformat()
    start, end = _qianchuan_bounds(day)
    if source == "STANDARD":
        table = "d_root_project_mid_db_brandmarketing.qianchuan_material_hourly_report"
        name_expression = "NULLIF(m.content_description, '')"
    else:
        table = "d_root_project_mid_db_brandmarketing.qianchuan_chengfang_material_hourly_report"
        name_expression = "COALESCE(NULLIF(m.material_name, ''), NULLIF(m.content_description, ''))"
    return f"""WITH latest_snapshot AS (
  SELECT advertiser_id, MAX(stat_time) AS stat_time
  FROM {table} FORCE INDEX (uk_qc_material_hourly)
  WHERE report_date = DATE('{value}')
    AND stat_time BETWEEN TIMESTAMP('{start}') AND TIMESTAMP('{end}')
  GROUP BY advertiser_id
)
SELECT '{value}' AS report_date, '{source}' AS source_platform,
  m.advertiser_id, m.material_id,
  MAX({name_expression}) AS material_name,
  NULL AS internal_author,
  NULL AS material_source,
  ROUND(SUM(COALESCE(m.total_pay_order_gmv_include_coupon_for_roi2, m.total_pay_order_gmv_for_roi2, 0)), 2) AS gmv_yuan,
  ROUND(SUM(COALESCE(m.stat_cost_for_roi2, 0)), 2) AS cost_yuan,
  SUM(COALESCE(m.total_pay_order_count_for_roi2, 0)) AS order_count,
  MAX(m.stat_time) AS source_cutoff_at,
  MAX(m.updated_at) AS source_updated_at
FROM latest_snapshot s
JOIN {table} m FORCE INDEX (uk_qc_material_hourly)
  ON m.report_date = DATE('{value}')
 AND m.advertiser_id = s.advertiser_id
 AND m.stat_time = s.stat_time
WHERE COALESCE(NULLIF(m.platform_material_type, ''), 'VIDEO') = 'VIDEO'
GROUP BY m.advertiser_id, m.material_id
HAVING gmv_yuan > 0 OR cost_yuan > 0
ORDER BY gmv_yuan DESC, cost_yuan DESC
LIMIT 200"""


def _material_summary_sql(day: date, source: str) -> str:
    value = day.isoformat()
    start, end = _qianchuan_bounds(day)
    if source == "STANDARD":
        table = "d_root_project_mid_db_brandmarketing.qianchuan_material_hourly_report"
        name_expression = "NULLIF(m.content_description, '')"
    else:
        table = "d_root_project_mid_db_brandmarketing.qianchuan_chengfang_material_hourly_report"
        name_expression = "COALESCE(NULLIF(m.material_name, ''), NULLIF(m.content_description, ''))"
    return f"""WITH latest_snapshot AS (
  SELECT advertiser_id, MAX(stat_time) AS stat_time
  FROM {table} FORCE INDEX (uk_qc_material_hourly)
  WHERE report_date = DATE('{value}')
    AND stat_time BETWEEN TIMESTAMP('{start}') AND TIMESTAMP('{end}')
  GROUP BY advertiser_id
)
SELECT '{value}' AS report_date, '{source}' AS source_platform,
  COUNT(*) AS material_record_count,
  SUM(CASE WHEN COALESCE(m.stat_cost_for_roi2, 0) > 0 THEN 1 ELSE 0 END) AS spent_material_count,
  SUM(CASE WHEN COALESCE(m.stat_cost_for_roi2, 0) > 0
    AND COALESCE(m.total_pay_order_gmv_include_coupon_for_roi2, m.total_pay_order_gmv_for_roi2, 0) > 0
    THEN 1 ELSE 0 END) AS effective_material_count,
  SUM(CASE WHEN COALESCE(m.stat_cost_for_roi2, 0) > 0 AND {name_expression} IS NOT NULL THEN 1 ELSE 0 END)
    AS named_spent_material_count,
  ROUND(SUM(COALESCE(m.total_pay_order_gmv_include_coupon_for_roi2, m.total_pay_order_gmv_for_roi2, 0)), 2)
    AS total_gmv_yuan,
  ROUND(SUM(COALESCE(m.stat_cost_for_roi2, 0)), 2) AS total_cost_yuan,
  SUM(COALESCE(m.total_pay_order_count_for_roi2, 0)) AS total_order_count,
  MAX(m.updated_at) AS daily_source_updated_at
FROM latest_snapshot s
JOIN {table} m FORCE INDEX (uk_qc_material_hourly)
  ON m.report_date = DATE('{value}')
 AND m.advertiser_id = s.advertiser_id
 AND m.stat_time = s.stat_time
WHERE COALESCE(NULLIF(m.platform_material_type, ''), 'VIDEO') = 'VIDEO'
  AND (
    COALESCE(m.stat_cost_for_roi2, 0) > 0
    OR COALESCE(m.total_pay_order_gmv_include_coupon_for_roi2, m.total_pay_order_gmv_for_roi2, 0) > 0
  )"""


def _freshness_sql(target: date) -> str:
    value = target.isoformat()
    return f"""SELECT 'QIANCHUAN_STANDARD' AS source_name, MAX(report_date) AS data_date
FROM d_root_project_mid_db_brandmarketing.qianchuan_material_hourly_report
WHERE report_date <= DATE('{value}')
UNION ALL
SELECT 'QIANCHUAN_CHENGFANG', MAX(report_date)
FROM d_root_project_mid_db_brandmarketing.qianchuan_chengfang_material_hourly_report
WHERE report_date <= DATE('{value}')"""


def build_overview_snapshot(
    product_rows: list[dict[str, Any]],
    material_rows: list[dict[str, Any]],
    target: date,
    days: int,
    freshness: dict[str, str],
    material_summary_rows: list[dict[str, Any]] | None = None,
    wechat_product_rows: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    products = []
    product_total = 0.0
    product_quantity = 0
    product_source_updated_at = ""
    effective_order_count: int | None = None
    for row in product_rows:
        sales = _round2(row.get("effective_sales_yuan"))
        product_total += sales
        product_quantity += int(_number(row.get("product_quantity")))
        if effective_order_count is None and row.get("effective_order_count") is not None:
            effective_order_count = int(_number(row.get("effective_order_count")))
        product_source_updated_at = _max_timestamp(product_source_updated_at, row.get("source_updated_at"))
        product_source_updated_at = _max_timestamp(product_source_updated_at, row.get("order_source_updated_at"))
        products.append({
            "standardProductName": str(row.get("standard_product_name") or "其他未归类"),
            "effectiveSalesYuan": sales,
            "orderCount": int(_number(row.get("order_count"))),
            "productQuantity": int(_number(row.get("product_quantity"))),
            "productLinkCount": int(_number(row.get("product_link_count"))),
            "salesSharePct": _round2(row.get("sales_share_pct")),
            "mapped": str(row.get("standard_product_name") or "") != "其他未归类",
        })
    products.sort(key=lambda item: (-item["effectiveSalesYuan"], item["standardProductName"]))
    unclassified_sales = sum(item["effectiveSalesYuan"] for item in products if not item["mapped"])

    wechat_products = []
    wechat_product_total = 0.0
    wechat_product_quantity = 0
    wechat_product_source_updated_at = ""
    wechat_effective_order_count: int | None = None
    for row in wechat_product_rows or []:
        sales = _round2(row.get("effective_sales_yuan"))
        wechat_product_total += sales
        wechat_product_quantity += int(_number(row.get("product_quantity")))
        if wechat_effective_order_count is None and row.get("effective_order_count") is not None:
            wechat_effective_order_count = int(_number(row.get("effective_order_count")))
        wechat_product_source_updated_at = _max_timestamp(
            wechat_product_source_updated_at, row.get("source_updated_at"),
        )
        wechat_product_source_updated_at = _max_timestamp(
            wechat_product_source_updated_at, row.get("order_source_updated_at"),
        )
        wechat_products.append({
            "standardProductName": str(row.get("standard_product_name") or "其他未归类"),
            "effectiveSalesYuan": sales,
            "orderCount": int(_number(row.get("order_count"))),
            "productQuantity": int(_number(row.get("product_quantity"))),
            "productLinkCount": int(_number(row.get("product_link_count"))),
            "salesSharePct": _round2(row.get("sales_share_pct")),
            "mapped": str(row.get("standard_product_name") or "") != "其他未归类",
        })
    wechat_products.sort(key=lambda item: (-item["effectiveSalesYuan"], item["standardProductName"]))
    wechat_unclassified_sales = sum(
        item["effectiveSalesYuan"] for item in wechat_products if not item["mapped"]
    )

    material_map: dict[str, dict[str, Any]] = {}
    for row in material_rows:
        material_id = str(row.get("material_id") or "").strip()
        source = str(row.get("source_platform") or "").strip()
        advertiser_id = str(row.get("advertiser_id") or "").strip()
        key = material_id or f"missing:{source}:{advertiser_id}:{row.get('report_date') or ''}"
        current = material_map.setdefault(key, {
            "materialId": material_id,
            "materialName": "",
            "internalAuthor": "",
            "materialSource": "",
            "sourcePlatforms": set(),
            "advertiserIds": set(),
            "gmvYuan": 0.0,
            "costYuan": 0.0,
            "orderCount": 0,
            "activeDates": set(),
            "dailyGmv": {},
            "sourceCutoffAt": "",
            "sourceUpdatedAt": "",
        })
        name = str(row.get("material_name") or "").strip()
        if name and (not current["materialName"] or len(name) > len(current["materialName"])):
            current["materialName"] = name
        author = str(row.get("internal_author") or "").strip()
        if author:
            current["internalAuthor"] = author
        material_source = str(row.get("material_source") or "").strip()
        if material_source:
            current["materialSource"] = material_source
        if source:
            current["sourcePlatforms"].add(source)
        if advertiser_id:
            current["advertiserIds"].add(advertiser_id)
        gmv = _number(row.get("gmv_yuan"))
        cost = _number(row.get("cost_yuan"))
        report_date = str(row.get("report_date") or "")[:10]
        current["gmvYuan"] += gmv
        current["costYuan"] += cost
        current["orderCount"] += int(_number(row.get("order_count")))
        if report_date:
            current["activeDates"].add(report_date)
            current["dailyGmv"][report_date] = current["dailyGmv"].get(report_date, 0.0) + gmv
        current["sourceCutoffAt"] = _max_timestamp(current["sourceCutoffAt"], row.get("source_cutoff_at"))
        current["sourceUpdatedAt"] = _max_timestamp(current["sourceUpdatedAt"], row.get("source_updated_at"))

    materials = []
    for item in material_map.values():
        cost = _round2(item["costYuan"])
        gmv = _round2(item["gmvYuan"])
        materials.append({
            "materialId": item["materialId"],
            "materialName": item["materialName"],
            "internalAuthor": item["internalAuthor"],
            "materialSource": item["materialSource"],
            "sourcePlatforms": sorted(item["sourcePlatforms"]),
            "advertiserIds": sorted(item["advertiserIds"]),
            "gmvYuan": gmv,
            "costYuan": cost,
            "roi": round(gmv / cost, 4) if cost > 0 else None,
            "orderCount": item["orderCount"],
            "activeDayCount": len(item["activeDates"]),
            "maxDailyGmvYuan": _round2(max(item["dailyGmv"].values(), default=0)),
            "sourceCutoffAt": item["sourceCutoffAt"],
            "sourceUpdatedAt": item["sourceUpdatedAt"],
        })
    positive_materials = [item for item in materials if item["gmvYuan"] > 0]
    top_materials = sorted(
        positive_materials,
        key=lambda item: (-item["gmvYuan"], -item["costYuan"], item["materialId"]),
    )[:10]
    if material_summary_rows:
        material_record_count = int(sum(_number(row.get("material_record_count")) for row in material_summary_rows))
        spent_material_count = int(sum(_number(row.get("spent_material_count")) for row in material_summary_rows))
        effective_material_count = int(sum(_number(row.get("effective_material_count")) for row in material_summary_rows))
        named_spent_material_count = int(sum(_number(row.get("named_spent_material_count")) for row in material_summary_rows))
        material_gmv = _round2(sum(_number(row.get("total_gmv_yuan")) for row in material_summary_rows))
        material_cost = _round2(sum(_number(row.get("total_cost_yuan")) for row in material_summary_rows))
        source_updated_at = max((str(row.get("daily_source_updated_at") or "") for row in material_summary_rows), default="")
    else:
        spent_materials = [item for item in materials if item["costYuan"] > 0]
        material_record_count = len(materials)
        spent_material_count = len(spent_materials)
        effective_material_count = len([item for item in spent_materials if item["gmvYuan"] > 0])
        named_spent_material_count = len([item for item in spent_materials if item["materialName"]])
        material_gmv = _round2(sum(item["gmvYuan"] for item in materials))
        material_cost = _round2(sum(item["costYuan"] for item in materials))
        source_updated_at = max((item["sourceUpdatedAt"] for item in materials), default="")
    candidate_gmv = _round2(sum(_number(row.get("gmv_yuan")) for row in material_rows))
    candidate_gmv_coverage = round(candidate_gmv / material_gmv, 4) if material_gmv > 0 else None
    period_start = target - timedelta(days=days - 1)
    generated_at = datetime.now(SHANGHAI_TZ).isoformat(timespec="seconds")

    return {
        "schemaVersion": 1,
        "status": "ready" if product_rows and (material_summary_rows or material_rows) else "partial",
        "generatedAt": generated_at,
        "query": {
            "productDate": target.isoformat(),
            "materialStartDate": period_start.isoformat(),
            "materialEndDate": target.isoformat(),
            "materialDays": days,
        },
        "summary": {
            "productEffectiveSalesYuan": _round2(product_total) if product_rows else None,
            "effectiveOrderCount": effective_order_count if product_rows else None,
            "productQuantity": product_quantity if product_rows else None,
            "wechatProductEffectiveSalesYuan": _round2(wechat_product_total) if wechat_product_rows else None,
            "wechatEffectiveOrderCount": wechat_effective_order_count if wechat_product_rows else None,
            "wechatProductQuantity": wechat_product_quantity if wechat_product_rows else None,
            "materialAttributedGmvYuan": material_gmv if material_rows else None,
            "materialCostYuan": material_cost if material_rows else None,
            "materialRoi": round(material_gmv / material_cost, 4) if material_cost > 0 else None,
            "spentMaterialCount": spent_material_count if (material_summary_rows or material_rows) else None,
            "effectiveMaterialCount": effective_material_count if (material_summary_rows or material_rows) else None,
            "effectiveMaterialRate": round(effective_material_count / spent_material_count, 4) if spent_material_count else None,
        },
        "products": products,
        "wechatProducts": wechat_products,
        "topMaterials": top_materials,
        # Internal candidate ledger for registered-material matching. The public
        # business endpoint removes this field and continues to return TOP10.
        "_materialCandidates": materials,
        "quality": {
            "unclassifiedProductSalesYuan": _round2(unclassified_sales) if product_rows else None,
            "productMappedSalesRate": round((product_total - unclassified_sales) / product_total, 4) if product_total > 0 else None,
            "wechatUnclassifiedProductSalesYuan": _round2(wechat_unclassified_sales) if wechat_product_rows else None,
            "wechatProductMappedSalesRate": (
                round((wechat_product_total - wechat_unclassified_sales) / wechat_product_total, 4)
                if wechat_product_total > 0 else None
            ),
            "materialNameCoverageRate": round(named_spent_material_count / spent_material_count, 4) if spent_material_count else None,
            "materialSourceRowCount": material_record_count,
            "topCandidateGmvCoverageRate": candidate_gmv_coverage,
            "topMaterialLineageLinkedCount": None,
            "topMaterialLineageCoverageRate": None,
        },
        "coverage": {
            "product": {
                "state": "available" if product_rows else "unavailable",
                "sourceUpdatedAt": product_source_updated_at or None,
                "source": "FanDo 根数据 · WIS 抖店订单 SKU 明细",
            },
            "wechatProduct": {
                "state": "available" if wechat_product_rows else "unavailable",
                "sourceUpdatedAt": wechat_product_source_updated_at or None,
                "source": "FanDo 根数据 · WIS 视频号店铺订单 SKU 明细",
            },
            "material": {
                "state": "available" if (material_summary_rows or material_rows) else "unavailable",
                "sourceUpdatedAt": source_updated_at or None,
                "sourceFreshness": freshness,
                "source": "FanDo 根数据 · 千川标准与乘方素材小时报表",
            },
            "warnings": [
                message for condition, message in (
                    (not product_rows, "所选日期没有返回可核验的单品成交明细，未按 0 处理"),
                    (not wechat_product_rows, "所选日期没有返回可核验的视频号单品成交明细，未按 0 处理"),
                    (not (material_summary_rows or material_rows), "所选周期没有返回可核验的千川素材数据，未按 0 处理"),
                    (bool(product_rows and unclassified_sales > 0), "其他未归类单品仍保留在总额与质量提示中"),
                    (bool(candidate_gmv_coverage is not None and candidate_gmv_coverage < 0.9), "每日高成交候选覆盖不足全部素材归因 GMV 的 90%，TOP10 仅作发现线索"),
                ) if condition
            ],
        },
        "definitions": {
            "productEffectiveSales": "北京时间自然日内 WIS 抖店有效订单的 SKU 实付金额，排除 order_status=4 的取消单；金额由分换算为元",
            "wechatProductEffectiveSales": "北京时间自然日内 WIS 视频号店铺有效订单的 SKU 实付金额，排除 order_status=200/250 的无效状态；金额由分换算为元",
            "materialAttributedGmv": "千川 ROI2 含券成交 GMV；含券字段为空时回退 ROI2 成交 GMV，与根数据有效成交额不是同一口径",
            "effectiveMaterialRate": "近7日账户素材-天记录中，产生千川归因 GMV 的有消耗记录数 ÷ 全部有消耗记录数；这是可守恒的投放记录效率，不等同于去重成片成功率",
            "topMaterialDiscovery": "每天分别取千川标准与乘方的高成交候选，再按素材ID合并近7日表现生成TOP10；候选GMV覆盖率随数据质量一起展示",
            "lineageCoverage": "TOP10 素材中，可与中枢推送记录及 WIS 素材库资产匹配的数量占比；未匹配不等于没有来源",
        },
    }


class BusinessIntelligenceService:
    def __init__(
        self,
        snapshot_path: str | Path | None = None,
        client_factory: Callable[..., FandowDataMcpClient] = FandowDataMcpClient,
    ) -> None:
        self.snapshot_path = Path(snapshot_path or settings.business_intelligence_snapshot_path)
        self.client_factory = client_factory
        self._refresh_lock = Lock()
        self._last_attempt_at: datetime | None = None
        self._last_error = ""

    @property
    def configured(self) -> bool:
        return bool(settings.fandow_data_mcp_token and settings.fandow_data_mcp_endpoint)

    @staticmethod
    def expected_target_date(now: datetime | None = None) -> date:
        current = now.astimezone(SHANGHAI_TZ) if now else datetime.now(SHANGHAI_TZ)
        return current.date() - timedelta(days=1)

    def _load_snapshot(self) -> dict[str, Any] | None:
        if not self.snapshot_path.exists():
            return None
        with self.snapshot_path.open("r", encoding="utf-8") as handle:
            return json.load(handle)

    def _write_snapshot(self, snapshot: dict[str, Any]) -> None:
        self.snapshot_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.snapshot_path.with_suffix(self.snapshot_path.suffix + ".tmp")
        with temporary.open("w", encoding="utf-8") as handle:
            json.dump(snapshot, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        temporary.replace(self.snapshot_path)

    @staticmethod
    def _matches(snapshot: dict[str, Any] | None, target: date, days: int) -> bool:
        query = (snapshot or {}).get("query") or {}
        return query.get("productDate") == target.isoformat() and query.get("materialDays") == days

    def _with_automation(self, snapshot: dict[str, Any], requested: date, days: int) -> dict[str, Any]:
        result = deepcopy(snapshot)
        result["automation"] = {
            "configured": self.configured,
            "requestedProductDate": requested.isoformat(),
            "requestedMaterialDays": days,
            "matchesRequest": self._matches(snapshot, requested, days),
            "lastSuccessAt": snapshot.get("generatedAt"),
            "lastAttemptAt": self._last_attempt_at.isoformat(timespec="seconds") if self._last_attempt_at else None,
            "lastError": self._last_error,
            "preservesLastSuccessOnFailure": True,
        }
        return result

    def refresh(self, target: date, days: int = 7) -> dict[str, Any]:
        if not self.configured:
            raise BusinessIntelligenceError("FanDo 根数据连接尚未配置，已保留上次成功快照")
        if days < 1 or days > 7:
            raise BusinessIntelligenceError("素材查询周期必须为 1 至 7 天")
        client = self.client_factory(
            settings.fandow_data_mcp_endpoint,
            settings.fandow_data_mcp_token,
            settings.fandow_data_mcp_timeout_seconds,
        )
        client.initialize()
        freshness_rows, freshness_capped = client.run_sql("千川素材新鲜度", _freshness_sql(target), 20)
        if freshness_capped:
            raise BusinessIntelligenceError("千川素材新鲜度查询被截断，已保留上次成功快照")
        freshness = {
            str(row.get("source_name") or ""): str(row.get("data_date") or "")[:10]
            for row in freshness_rows
        }
        pending = [
            label for key, label in (
                ("QIANCHUAN_STANDARD", "千川标准"),
                ("QIANCHUAN_CHENGFANG", "千川乘方"),
            ) if freshness.get(key, "") < target.isoformat()
        ]
        if pending:
            raise BusinessIntelligenceError(f"{'、'.join(pending)}尚未完整到达{target.isoformat()}，已保留上次成功快照")

        product_rows, product_capped = client.run_sql(
            f"WIS抖店单品有效成交 {target.isoformat()}", _product_sql(target, "douyin"), 500,
        )
        if product_capped:
            raise BusinessIntelligenceError("WIS单品有效成交查询被截断，已保留上次成功快照")
        wechat_product_rows, wechat_product_capped = client.run_sql(
            f"WIS视频号单品有效成交 {target.isoformat()}", _product_sql(target, "wechat"), 500,
        )
        if wechat_product_capped:
            raise BusinessIntelligenceError("WIS视频号单品有效成交查询被截断，已保留上次成功快照")
        material_rows: list[dict[str, Any]] = []
        material_summary_rows: list[dict[str, Any]] = []
        start = target - timedelta(days=days - 1)
        for day in _date_range(start, target):
            for source, label in (("STANDARD", "千川标准"), ("CHENGFANG", "千川乘方")):
                summary_rows, summary_capped = client.run_sql(
                    f"{label}素材汇总 {day.isoformat()}", _material_summary_sql(day, source), 10,
                )
                if summary_capped:
                    raise BusinessIntelligenceError(f"{label}素材汇总 {day.isoformat()} 查询异常截断，已保留上次成功快照")
                material_summary_rows.extend(summary_rows)
                rows, capped = client.run_sql(f"{label}素材候选 {day.isoformat()}", _material_sql(day, source), 300)
                if capped:
                    raise BusinessIntelligenceError(f"{label}素材候选 {day.isoformat()} 查询异常截断，已保留上次成功快照")
                material_rows.extend(rows)
        snapshot = build_overview_snapshot(
            product_rows, material_rows, target, days, freshness, material_summary_rows,
            wechat_product_rows,
        )
        self._write_snapshot(snapshot)
        self._last_error = ""
        return snapshot

    def get_overview(self, target: date | None = None, days: int = 7, force: bool = False) -> dict[str, Any]:
        requested = target or self.expected_target_date()
        if requested > self.expected_target_date():
            raise BusinessIntelligenceError("只能查询截至昨天的完整自然日")
        existing = self._load_snapshot()
        if not force and self._matches(existing, requested, days):
            return self._with_automation(existing or {}, requested, days)
        with self._refresh_lock:
            existing = self._load_snapshot()
            if not force and self._matches(existing, requested, days):
                return self._with_automation(existing or {}, requested, days)
            self._last_attempt_at = datetime.now(SHANGHAI_TZ)
            try:
                snapshot = self.refresh(requested, days)
                return self._with_automation(snapshot, requested, days)
            except Exception as error:
                self._last_error = str(error)[:500]
                existing = self._load_snapshot()
                if existing:
                    stale = self._with_automation(existing, requested, days)
                    stale["status"] = "stale"
                    stale.setdefault("coverage", {}).setdefault("warnings", []).append(
                        "本次根数据刷新失败，当前展示上次成功快照；请以页面实际日期为准"
                    )
                    return stale
                raise

    def refresh_if_due(self, now: datetime | None = None) -> dict[str, Any] | None:
        current = now.astimezone(SHANGHAI_TZ) if now else datetime.now(SHANGHAI_TZ)
        target = self.expected_target_date(current)
        snapshot = self._load_snapshot()
        if self._matches(snapshot, target, 7):
            return snapshot
        return self.get_overview(target, 7)


business_intelligence_service = BusinessIntelligenceService()
