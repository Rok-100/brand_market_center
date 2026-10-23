# Read-only SQL extracted from cloud-manager personal_sales_service.py.
# Source SHA256: 1d60f98d9eca9a05489ec4a49f73d850d209980bcd785c209cd5cb74054e0cac
from datetime import date,timedelta

def coverage_sql(source,day):
    value=day.isoformat()
    if source in ['standard','chengfang']:
        table='qianchuan_material_hourly_report' if source=='standard' else 'qianchuan_chengfang_material_hourly_report'
        start,end=_qianchuan_bounds(day)
        return f"SELECT COUNT(*) AS snapshot_rows FROM d_root_project_mid_db_brandmarketing.{table} FORCE INDEX (uk_qc_material_hourly) WHERE report_date=DATE('{value}') AND stat_time BETWEEN TIMESTAMP('{start}') AND TIMESTAMP('{end}')"
    if source=='haitun':return f"SELECT COUNT(*) AS snapshot_rows FROM d_root_project_mid_db_brandmarketing.haitun_zhitou_short_video_material_hourly_detail WHERE stat_date=DATE('{value}')"
    if source=='adq':return f"SELECT COUNT(*) AS snapshot_rows FROM d_root_project_mid_db_brandmarketing.adq_video_material_databoard WHERE report_date=DATE('{value}') AND report_time_line='REPORTING_TIME'"
    raise ValueError('Unknown source')

def _qianchuan_bounds(day: date) -> tuple[str, str]:
    following = day + timedelta(days=1)
    return f"{day.isoformat()} 23:30:00", f"{following.isoformat()} 00:00:00"

def _standard_qianchuan_sql(day: date) -> str:
    start, end = _qianchuan_bounds(day)
    value = day.isoformat()
    return f"""WITH latest_snapshot AS (
  SELECT advertiser_id, MAX(stat_time) AS stat_time
  FROM d_root_project_mid_db_brandmarketing.qianchuan_material_hourly_report FORCE INDEX (uk_qc_material_hourly)
  WHERE report_date = DATE('{value}')
    AND stat_time BETWEEN TIMESTAMP('{start}') AND TIMESTAMP('{end}')
  GROUP BY advertiser_id
)
SELECT '{value}' AS report_date, '千川' AS channel, 'STANDARD' AS source_platform,
  m.advertiser_id, m.material_id,
  MAX(COALESCE(NULLIF(a.platform_material_name, ''), NULLIF(a.filename, ''), NULLIF(m.content_description, ''))) AS material_name,
  MAX(NULLIF(a.internal_author, '')) AS internal_author,
  ROUND(SUM(COALESCE(m.total_pay_order_gmv_include_coupon_for_roi2, m.total_pay_order_gmv_for_roi2, 0)), 2) AS gmv_yuan,
  MAX(m.stat_time) AS source_cutoff_at, MAX(m.updated_at) AS source_updated_at
FROM latest_snapshot s
JOIN d_root_project_mid_db_brandmarketing.qianchuan_material_hourly_report m FORCE INDEX (uk_qc_material_hourly)
  ON m.report_date = DATE('{value}') AND m.advertiser_id = s.advertiser_id AND m.stat_time = s.stat_time
LEFT JOIN d_root_project_mid_db_brandmarketing.qianchuan_material_asset_ledger a
  ON a.advertiser_id = m.advertiser_id AND a.material_id = m.material_id
GROUP BY m.advertiser_id, m.material_id
HAVING gmv_yuan > 0"""

def _chengfang_qianchuan_sql(day: date) -> str:
    start, end = _qianchuan_bounds(day)
    value = day.isoformat()
    return f"""WITH latest_snapshot AS (
  SELECT advertiser_id, MAX(stat_time) AS stat_time
  FROM d_root_project_mid_db_brandmarketing.qianchuan_chengfang_material_hourly_report FORCE INDEX (uk_qc_material_hourly)
  WHERE report_date = DATE('{value}')
    AND stat_time BETWEEN TIMESTAMP('{start}') AND TIMESTAMP('{end}')
  GROUP BY advertiser_id
)
SELECT '{value}' AS report_date, '千川' AS channel, 'CHENGFANG' AS source_platform,
  m.advertiser_id, m.material_id,
  MAX(COALESCE(NULLIF(m.material_name, ''), NULLIF(m.content_description, ''))) AS material_name,
  NULL AS internal_author,
  ROUND(SUM(COALESCE(m.total_pay_order_gmv_include_coupon_for_roi2, m.total_pay_order_gmv_for_roi2, 0)), 2) AS gmv_yuan,
  MAX(m.stat_time) AS source_cutoff_at, MAX(m.updated_at) AS source_updated_at
FROM latest_snapshot s
JOIN d_root_project_mid_db_brandmarketing.qianchuan_chengfang_material_hourly_report m FORCE INDEX (uk_qc_material_hourly)
  ON m.report_date = DATE('{value}') AND m.advertiser_id = s.advertiser_id AND m.stat_time = s.stat_time
GROUP BY m.advertiser_id, m.material_id
HAVING gmv_yuan > 0"""

def _haitun_sql(day: date) -> str:
    value = day.isoformat()
    return f"""WITH latest_snapshot AS (
  SELECT platform_account_id, MAX(collection_time) AS collection_time
  FROM d_root_project_mid_db_brandmarketing.haitun_zhitou_short_video_material_hourly_detail
  WHERE stat_date = DATE('{value}')
  GROUP BY platform_account_id
)
SELECT '{value}' AS report_date, '视频号' AS channel, 'HAITUN' AS source_platform,
  m.platform_account_id AS advertiser_id,
  COALESCE(NULLIF(m.platform_video_id, ''), m.material_record_key) AS material_id,
  MAX(COALESCE(NULLIF(m.material_title, ''), NULLIF(m.material_remark, ''))) AS material_name,
  NULL AS internal_author,
  ROUND(MAX(COALESCE(m.transaction_amount_yuan, 0)), 2) AS gmv_yuan,
  MAX(TIMESTAMP(m.stat_date, m.collection_time)) AS source_cutoff_at, MAX(m.updated_at) AS source_updated_at
FROM latest_snapshot s
JOIN d_root_project_mid_db_brandmarketing.haitun_zhitou_short_video_material_hourly_detail m
  ON m.stat_date = DATE('{value}') AND m.platform_account_id = s.platform_account_id AND m.collection_time = s.collection_time
GROUP BY m.platform_account_id, COALESCE(NULLIF(m.platform_video_id, ''), m.material_record_key)
HAVING gmv_yuan > 0"""

def _adq_sql(day: date) -> str:
    value = day.isoformat()
    return f"""WITH ranked AS (
  SELECT report_date, ad_account_id, video_id, video_name, order_amount_yuan, updated_at,
    ROW_NUMBER() OVER (PARTITION BY report_date, ad_account_id, video_id ORDER BY updated_at DESC, id DESC) AS row_rank
  FROM d_root_project_mid_db_brandmarketing.adq_video_material_databoard
  WHERE report_date = DATE('{value}') AND report_time_line = 'REPORTING_TIME'
)
SELECT '{value}' AS report_date, '视频号' AS channel, 'ADQ' AS source_platform,
  ad_account_id AS advertiser_id, video_id AS material_id, video_name AS material_name,
  NULL AS internal_author, ROUND(COALESCE(order_amount_yuan, 0), 2) AS gmv_yuan,
  CONCAT('{value}', ' 23:59:59') AS source_cutoff_at, updated_at AS source_updated_at
FROM ranked
WHERE row_rank = 1 AND COALESCE(order_amount_yuan, 0) > 0"""

def _freshness_sql(target: date) -> str:
    value = target.isoformat()
    return f"""SELECT 'QIANCHUAN_STANDARD' AS source_name, MAX(report_date) AS data_date
FROM d_root_project_mid_db_brandmarketing.qianchuan_material_hourly_report WHERE report_date <= DATE('{value}')
UNION ALL
SELECT 'QIANCHUAN_CHENGFANG', MAX(report_date)
FROM d_root_project_mid_db_brandmarketing.qianchuan_chengfang_material_hourly_report WHERE report_date <= DATE('{value}')
UNION ALL
SELECT 'HAITUN', MAX(stat_date)
FROM d_root_project_mid_db_brandmarketing.haitun_zhitou_short_video_material_hourly_detail WHERE stat_date <= DATE('{value}')
UNION ALL
SELECT 'ADQ', MAX(report_date)
FROM d_root_project_mid_db_brandmarketing.adq_video_material_databoard
WHERE report_date <= DATE('{value}') AND report_time_line = 'REPORTING_TIME'"""
