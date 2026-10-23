"""Read-only extraction through the existing dashboard's credential boundary."""
import ast
import base64
import json
import os
from pathlib import Path
import subprocess
from datetime import date, timedelta

ROOT = Path(__file__).resolve().parent
SSH = ['ssh', '-i', str(Path.home()/'.ssh/fandow/brand-marketing/id_ed25519'),
       '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
       os.getenv('REPORT_SSH_HOST', '')]
CONTAINER = os.getenv('REPORT_DATA_CONTAINER', '')
NODE = """
const fs=require('fs');
const modulePath=process.env.REPORT_DASHBOARD_DIR || '/app/dist/server/modules/dashboard';
if(process.env.REPORT_DATABASE_CONFIG){const values=JSON.parse(fs.readFileSync(process.env.REPORT_DATABASE_CONFIG,'utf8'));for(const [key,value] of Object.entries(values)){if(key.startsWith('ROOT_MYSQL_')||['WIS_QIANCHUAN_ADVERTISER_IDS','WIS_DOUYIN_SHOP_IDS'].includes(key))process.env[key]=String(value);}}
const db=require(modulePath+'/mysql.js');
setTimeout(()=>process.exit(124),120000).unref();
(async()=>{try{
 if(!db.isDirectMysqlConfigured())throw Error('Read-only database not configured');
 const job=JSON.parse(fs.readFileSync(0,'utf8'));
 const cockpit=(job.trend || job.materialOnline) ? require(modulePath+'/cockpit.service.js') : null;
 const sql=job.materialOnline ? cockpit.buildMaterialOnlineSql(job.start,job.end) : job.trend ? cockpit.buildProductTrendDirectSql(job.day,job.day) : job.sql;
 const result=job.materialOnline ? await require(modulePath+'/mcp.js').executeCockpitSql(sql,100000) : await db.executeDirectSql(sql,100000);
 if(result.truncated)throw Error('Query truncated');
 console.log(JSON.stringify(result));
}catch(e){console.error(e.message);process.exitCode=1}finally{await db.closeDirectMysqlPool()}})();
"""

def query(job):
    mode = os.getenv('REPORT_QUERY_MODE', 'direct')
    if mode == 'direct':
        p=subprocess.run(['node','-e',NODE],input=json.dumps(job).encode(),capture_output=True,timeout=150)
        if p.returncode:raise RuntimeError('Database query failed: '+p.stderr.decode(errors='replace')[-1200:])
        return json.loads(p.stdout)
    if mode != 'ssh' or not os.getenv('REPORT_SSH_HOST') or not CONTAINER:
        raise RuntimeError('Configure REPORT_QUERY_MODE=direct or explicit SSH host/container')
    # Only code is sent in argv. SQL is stdin; database credentials never leave the container.
    remote = 'import subprocess,sys;sys.exit(subprocess.call('+repr([
        'docker','exec','-i',CONTAINER,'timeout','120','node','-e',NODE])+'))'
    code = base64.b64encode(remote.encode()).decode()
    command = "env DOCKER_HOST=unix:///run/user/1000/docker.sock python3 -c 'import base64,sys;exec(base64.b64decode(sys.argv[1]))' " + code
    p = subprocess.run(SSH+[command],input=json.dumps(job).encode(),capture_output=True,timeout=180)
    if p.returncode:
        raise RuntimeError(p.stderr.decode(errors='replace')[-1800:])
    return json.loads(p.stdout)

def query_functions():
    if (ROOT/'queries.py').exists():
        import queries
        return vars(queries)
    source = (ROOT.parent/'wis-hub/cloud-manager/backend/app/personal_sales_service.py').read_text(encoding='utf-8')
    names = {'_qianchuan_bounds','_standard_qianchuan_sql','_chengfang_qianchuan_sql','_haitun_sql','_adq_sql','_freshness_sql'}
    tree = ast.parse(source)
    module = ast.Module(body=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in names],type_ignores=[])
    scope={'date':date,'timedelta':timedelta}
    exec(compile(module,'cloud-manager-query-reference','exec'),scope)
    return scope

def collect(target, allow_partial=True):
    funcs=query_functions()
    dest=ROOT/'data'/target.isoformat(); dest.mkdir(parents=True,exist_ok=True)
    fresh=query({'sql':funcs['_freshness_sql'](target)})
    (dest/'freshness.json').write_text(json.dumps(fresh,ensure_ascii=False),encoding='utf-8')
    print('freshness',json.dumps(fresh,ensure_ascii=False),flush=True)
    for source in fresh['rows']:
        if str(source['data_date'] or '')[:10] < target.isoformat() and not allow_partial:
            raise RuntimeError('Data source not ready: '+str(source))
    jobs=[]
    start=target.replace(day=1)
    for i in range((target-start).days+1):
        day=start+timedelta(days=i)
        for key,fn in [('standard','_standard_qianchuan_sql'),('chengfang','_chengfang_qianchuan_sql'),('haitun','_haitun_sql'),('adq','_adq_sql')]:
            jobs.append((f'{day}-{key}',{'sql':funcs[fn](day)}))
    jobs.append(('material-online',{'materialOnline':True,'start':str(target-timedelta(days=14)),'end':str(target)}))
    # A single database query at a time, resumable from successful local files.
    for label,job in jobs:
        path=dest/(label+'.json')
        if os.getenv('REPORT_FORCE_REFRESH')!='true' and path.exists() and json.loads(path.read_text(encoding='utf-8'))['rows']:
            continue
        data=query(job)
        if not data['rows'] and label!='material-online':
            from queries import coverage_sql
            source=label[11:];day=date.fromisoformat(label[:10])
            coverage=query({'sql':coverage_sql(source,day)})
            count=int(coverage['rows'][0]['snapshot_rows'])
            data['sourceCoverage']={'hasSnapshot':count>0,'snapshotRows':count}
        path.write_text(json.dumps(data,ensure_ascii=False),encoding='utf-8')
        print(label,len(data['rows']),flush=True)
    (dest/'complete.json').write_text(json.dumps({'target':str(target),'jobs':[x[0] for x in jobs]}),encoding='utf-8')

if __name__=='__main__':
    import argparse
    p=argparse.ArgumentParser();p.add_argument('--date',required=True);p.add_argument('--allow-partial-test',action='store_true')
    args=p.parse_args()
    collect(date.fromisoformat(args.date),args.allow_partial_test)
