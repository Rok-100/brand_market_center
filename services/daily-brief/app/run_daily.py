"""Daily pipeline entry point; group mode remains disabled during local acceptance."""
import argparse,json,os,subprocess,time,sqlite3
from datetime import datetime,timedelta,timezone
from collect import collect
from report import ROOT,load,build,people_from_base
from render import ranking,trend
from send import deliver
TZ=timezone(timedelta(hours=8))

def refresh_keywords():
    if os.getenv('REPORT_KEYWORD_MODE')=='bot':
        from keywords import refresh
        return refresh()
    cfg=load(ROOT/'config.json')
    args=['lark-cli','base','+record-list','--base-token',cfg['keywordBaseToken'],'--table-id',cfg['keywordTableId'],
        '--view-id',cfg['keywordViewId'],'--as','user','--limit','200','--format','json']
    for field in ['fldXOIq3FG','fldoXkpzge','flda7cLLdC','fldJ5N37jD','fldgHUr7Jp','fldtr8qv73']:args+=['--field-id',field]
    if os.name=='nt':
        # All arguments above are fixed config tokens, not material names or document text.
        args=['powershell','-NoProfile','-Command','[Console]::OutputEncoding=[Text.Encoding]::UTF8; & '+' '.join("'"+x.replace("'","''")+"'" for x in args)]
    result=subprocess.run(args,capture_output=True,timeout=120,check=True)
    raw=json.loads(result.stdout.decode('utf-8-sig'))
    if not raw.get('ok'):raise RuntimeError('Keyword table refresh failed')
    people_from_base(raw) # Reject partial pagination before replacing the mapping.
    path=ROOT/'data/creator-keyword-records.json';path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(raw,ensure_ascii=False),encoding='utf-8')

def run(test=False,prepare_only=False):
    cfg=load(ROOT/'config.json')
    if not test and not cfg['groupEnabled']:raise RuntimeError('Group delivery has not been enabled')
    target=(datetime.now(TZ)-timedelta(days=1)).date()
    refresh_keywords();collect(target,allow_partial=True)
    r,folder=build(target)
    if not r['ready']:
        print(json.dumps({'reportDate':r['target'],'dataQuality':'partial','deliveryPolicy':'send_available',
            'missingSources':r.get('emptyQueries',[]),'delayedSources':r.get('delayedSources',[]),
            'missingTrendDates':r.get('trendQuality',{}).get('missingDates',[])},ensure_ascii=False),flush=True)
    render_as_test=test and os.getenv('REPORT_PRODUCTION_PREVIEW')!='true'
    ranking(r,folder/'ranking.png',test=render_as_test);trend(r,folder/'trend.png',test=render_as_test)
    return {'reportDate':str(target),'ready':r['ready'],'folder':str(folder)} if prepare_only else deliver(folder,production=not test)

def serve():
    cfg=load(ROOT/'config.json')
    if not cfg['groupEnabled']:raise SystemExit('Group delivery disabled')
    state=ROOT/'data/schedule.sqlite';state.parent.mkdir(exist_ok=True)
    db=sqlite3.connect(state);db.execute('CREATE TABLE IF NOT EXISTS runs (day TEXT PRIMARY KEY,state TEXT,last_attempt REAL,error TEXT)');db.commit()
    status_path=ROOT/'data/status.json'
    while True:
        now=datetime.now(TZ);day=now.date().isoformat()
        row=db.execute('SELECT state,last_attempt,error FROM runs WHERE day=?',(day,)).fetchone()
        status={'heartbeatAt':now.isoformat(),'schedule':cfg['sendTime'],'timezone':'Asia/Shanghai','day':day,'state':row[0] if row else 'waiting','error':row[2] if row else ''}
        status_path.write_text(json.dumps(status,ensure_ascii=False),encoding='utf-8')
        # Catch up after restarts; bounded retries allow delayed source data to arrive.
        due=cfg['sendTime']<=now.strftime('%H:%M')<='18:00'
        if due and (not row or row[0]!='sent') and (not row or time.time()-row[1]>=900):
            db.execute('INSERT OR REPLACE INTO runs VALUES (?,?,?,?)',(day,'running',time.time(),''));db.commit()
            status.update(state='running',heartbeatAt=datetime.now(TZ).isoformat());status_path.write_text(json.dumps(status),encoding='utf-8')
            try:
                result=run();db.execute('UPDATE runs SET state=?,error=? WHERE day=?',('sent','',day));db.commit()
                print(json.dumps({'day':day,'state':'sent','receipts':result},ensure_ascii=False),flush=True)
            except Exception as exc:
                message=str(exc)[:2000];db.execute('UPDATE runs SET state=?,error=? WHERE day=?',('pending',message,day));db.commit()
                print(json.dumps({'day':day,'state':'pending','error':message},ensure_ascii=False),flush=True)
        time.sleep(20)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--test',action='store_true');p.add_argument('--serve',action='store_true');p.add_argument('--prepare-only',action='store_true');a=p.parse_args()
    if not a.serve:print(json.dumps(run(a.test,a.prepare_only),ensure_ascii=False))
    else:serve()
