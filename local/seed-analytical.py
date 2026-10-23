"""Minimal SQL-derived local fixtures. Never production migration DDL."""
import datetime as dt
import json
import re
from pathlib import Path
import pymysql
from common import config
import os
assert os.environ.get('LOCAL_SIMULATION') == '1', 'Local simulation required'
c=config()['mysql']
assert (c['host'],c['database'],c['user'])==('mysql','wis_local','wis_local')
database='d_root_project_mid_db_brandmarketing'
db=pymysql.connect(host='mysql',user='root',password=__LOCAL_ROOT_PASSWORD__,autocommit=True,charset='utf8mb4',ssl={'check_hostname':False})
schema=json.loads(Path('/local-schemas/analytical-synthetic.json').read_text())
q=lambda s:'`'+s.replace('`','``')+'`'
def dtype(name):
    if name.endswith('_date'):return 'DATE'
    if name.endswith(('_time','_at')):return 'DATETIME'
    if name.endswith('_json') or name=='sku_items':return 'JSON'
    if re.search(r'cost|amount|gmv|count|roi',name) and not name.endswith('_id'):return 'DECIMAL(24,4)'
    return 'VARCHAR(512)'
with db.cursor() as cur:
    cur.execute('CREATE DATABASE IF NOT EXISTS '+q(database)+' CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_bin')
    for full,spec in schema.items():
        assert full.startswith(database+'.')
        table=full.split('.')[1]
        columns=spec['columns']
        definitions=['`_fixture_id` VARCHAR(128) PRIMARY KEY']+[q(c)+' '+dtype(c)+' NULL' for c in columns]
        # FORCE INDEX names are required by original queries. These minimal test indexes are not production indexes.
        index_col='shop_id' if 'shop_id' in columns else 'advertiser_id'
        definitions += ['INDEX '+q(index)+' ('+q(index_col)+')' for index in spec['indexes']]
        cur.execute('CREATE TABLE IF NOT EXISTS '+full+' ('+','.join(definitions)+") COMMENT='LOCAL_SYNTHETIC SQL-derived test structure'")
        cur.execute('SELECT table_comment FROM information_schema.tables WHERE table_schema=%s AND table_name=%s',(database,table))
        assert cur.fetchone()[0].startswith('LOCAL_SYNTHETIC'), 'Refusing to seed an unmarked table'
        cur.execute('ALTER TABLE '+full+' CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_bin')
        # Expanding query coverage may discover extra fields; only synthetic tables can be extended.
        cur.execute('SELECT column_name FROM information_schema.columns WHERE table_schema=%s AND table_name=%s',(database,table))
        existing={row[0] for row in cur.fetchall()}
        for column in set(columns)-existing:cur.execute('ALTER TABLE '+full+' ADD '+q(column)+' '+dtype(column)+' NULL')
    cur.execute('GRANT SELECT ON '+q(database)+".* TO 'wis_local'@'%'")
today=dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).date()
total=0
def save(table,key,values):
    global total
    full=database+'.'+table
    columns=schema[full]['columns']
    values={k:v for k,v in values.items() if k in columns}
    values={'_fixture_id':'local-simulation:'+key,**values}
    names=list(values)
    with db.cursor() as cur:
        cur.execute('INSERT INTO '+full+' ('+','.join(q(n) for n in names)+') VALUES ('+','.join(['%s']*len(names))+') ON DUPLICATE KEY UPDATE '+','.join(q(n)+'=VALUES('+q(n)+')' for n in names if n!='_fixture_id'),list(values.values()))
    total+=1
for offset in range(21):
    day=today-dt.timedelta(days=offset)
    for i,(cents,status) in enumerate([(10000,'3'),(20000,'3'),(5000,'4')]):
        time=str(day)+' 12:00:00'
        save('platform_order_item_api_field',f'{day}-order-{i}',{'platform_order_no':f'LOCAL-MOCK-{day}-{i}','shop_id':'1099',
             'order_pay_amount':cents,'order_status':status,'order_time':time,'pay_time':time,'updated_at':time,
             'sku_items':json.dumps([{'product_name':'水润面膜','sku_pay_amount':cents}],ensure_ascii=False)})
    for hour in range(24):
        time=f'{day} {hour:02d}:00:00'
        common={'advertiser_id':'99000001','advertiser_name':'【本机模拟】WIS测试账户','report_date':str(day),
                'stat_time':time,'observed_at':time,'data_status':'COMPLETE','total_cost_yuan':2.5,
                'live_prom_goods_cost_yuan':1,'video_prom_goods_cost_yuan':1.5,'internal_product_name':'水润面膜',
                'ad_id':'99000002','ad_name':'【本机模拟】水润面膜测试计划','id':f'{day}-{hour}',
                'marketing_goal_code':'VIDEO_PROM_GOODS','record_grain':'hourly','time_granularity':'HOURLY',
                'stat_cost':2.5,'plan_total_cost_yuan':2.5,'plan_net_pay_order_gmv_yuan':12.5,
                'total_pay_order_gmv_for_roi2':12.5,'total_pay_order_gmv_include_coupon_for_roi2':12.5}
        save('qianchuan_account_hourly_cost',f'{day}-account-{hour}',common)
        save('qianchuan_ad_plan_hourly_delivery_cost_detail',f'{day}-plan-{hour}',common)
        save('qianchuan_material_hourly_report',f'{day}-material-{hour}',{**common,'material_id':'99000003',
             'marketing_goal':'VIDEO_PROM_GOODS','platform_material_type':'VIDEO','business_material_type':'自产',
             'content_description':'【本机模拟】流程测试素材','stat_cost_for_roi2':(hour+1)*2.5,
             'total_pay_order_gmv_for_roi2':(hour+1)*12.5,'platform_product_ids_json':'[]'})
save('qianchuan_material_asset_ledger','asset-1',{'advertiser_id':'99000001','material_id':'99000003',
     'platform_material_name':'【本机模拟】流程测试素材','filename':'LOCAL-MOCK.mp4','internal_product_name':'水润面膜',
     'platform_create_time':str(today-dt.timedelta(days=20))+' 00:00:00','platform_material_type':'VIDEO',
     'business_tags_json':'[]','platform_products_json':'[]','platform_product_names_json':'["水润面膜"]','platform_tags_json':'[]'})
db.close()
print(json.dumps({'database':database,'tables':len(schema),'syntheticRowsUpserted':total,
     'dailyExpected':{'gmvYuan':350,'gsvYuan':300,'refundYuan':50,'adCostYuan':60},'remoteAccess':False}))
