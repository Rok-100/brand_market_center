"""Feishu bot delivery with recipient verification and durable per-part receipts."""
import hashlib,json,os,sqlite3,uuid,time
from pathlib import Path
import requests
from report import ROOT,load

class Feishu:
    def __init__(self,credentials):
        self.app_id=credentials['appId']
        self.http=requests.Session()
        r=self.http.post('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',json={
            'app_id':self.app_id,'app_secret':credentials['appSecret']},timeout=30)
        data=self.checked(r)
        self.http.headers['Authorization']='Bearer '+data['tenant_access_token']

    @staticmethod
    def checked(response):
        data=response.json()
        if data.get('code',0)!=0:raise RuntimeError(f"Feishu {data.get('code')}: {data.get('msg')}")
        response.raise_for_status()
        return data

    def verify_person(self,recipient):
        r=self.http.get('https://open.feishu.cn/open-apis/contact/v3/users/'+recipient,
            params={'user_id_type':'open_id'},timeout=30)
        user=self.checked(r)['data']['user']
        if user.get('name')!='崔经瀚':raise RuntimeError('Test recipient name mismatch')
        return user['name']

    def image(self,path):
        with Path(path).open('rb') as file:
            r=self.http.post('https://open.feishu.cn/open-apis/im/v1/images',
                data={'image_type':'message'},files={'image':(Path(path).name,file,'image/png')},timeout=60)
        return self.checked(r)['data']['image_key']

    def message(self,recipient,kind,content,key,receive_type='open_id'):
        r=self.http.post('https://open.feishu.cn/open-apis/im/v1/messages',params={'receive_id_type':receive_type},
            json={'receive_id':recipient,'msg_type':kind,'content':json.dumps(content,ensure_ascii=False),'uuid':key},timeout=45)
        return self.checked(r)['data']['message_id']

def deliver(folder,production=False,allow_partial_date=None):
    folder=Path(folder);report=load(folder/'report.json')
    cfg=load(ROOT/'config.json')
    if allow_partial_date and (not production or allow_partial_date!=report['target']):
        raise ValueError('One-time override must name this exact group report date')
    if production and not cfg['groupEnabled']:
        raise RuntimeError('Group delivery disabled')
    credentials=load(os.getenv('REPORT_FEISHU_CREDENTIALS',str(ROOT.parent/'wis-hub/.secrets/feishu-app.json')))
    client=Feishu(credentials)
    if production:
        recipient=cfg['groupChatId'];receive_type='chat_id'
    else:
        binding=load(os.getenv('REPORT_BINDINGS_FILE',str(ROOT/'data/local-bindings.json')))
        if binding['appId']!=client.app_id or binding['receiveIdType']!='open_id':
            raise RuntimeError('App-specific recipient binding mismatch')
        recipient=binding['recipients']['FD-227829'];receive_type='open_id'
        client.verify_person(recipient)
    # A transaction serializes concurrent local send attempts. UUID also protects response-loss retries.
    conn=sqlite3.connect(ROOT/'data/delivery.sqlite',timeout=60)
    conn.execute('CREATE TABLE IF NOT EXISTS deliveries (id TEXT PRIMARY KEY, message_id TEXT NOT NULL)')
    conn.execute('CREATE TABLE IF NOT EXISTS attempts (id TEXT PRIMARY KEY, kind TEXT NOT NULL, content TEXT NOT NULL, first_at REAL NOT NULL, unknown INTEGER NOT NULL DEFAULT 0)')
    receipts=[]
    parts=[('ranking',folder/'ranking.png'),('trend',folder/'trend.png')]
    for part,path in parts:
        payload=path.read_bytes()
        logical=f'{client.app_id}|{recipient}|{report["target"]}|{part}|'+('daily-production-v1' if production else hashlib.sha256(payload).hexdigest())
        key=str(uuid.uuid5(uuid.NAMESPACE_URL,logical))
        conn.execute('BEGIN IMMEDIATE')
        try:
            previous=conn.execute('SELECT message_id FROM deliveries WHERE id=?',(key,)).fetchone()
            if previous:mid=previous[0]
            else:
                pending=conn.execute('SELECT kind,content,first_at,unknown FROM attempts WHERE id=?',(key,)).fetchone()
                if pending and pending[3] and time.time()-pending[2]>=3300:
                    raise RuntimeError('Delivery outcome unknown beyond safe retry window; manual reconciliation required')
                if pending:kind,content=pending[0],json.loads(pending[1])
                else:
                    kind='image';content={'image_key':client.image(path)}
                    conn.execute('INSERT INTO attempts VALUES (?,?,?,?,0)',(key,kind,json.dumps(content,ensure_ascii=False),time.time()))
                # Commit the original body before sending. A process crash is an uncertain result.
                conn.execute('UPDATE attempts SET unknown=1 WHERE id=?',(key,));conn.commit()
                mid=client.message(recipient,kind,content,key,receive_type)
                conn.execute('BEGIN IMMEDIATE')
                conn.execute('INSERT INTO deliveries VALUES (?,?)',(key,mid))
            conn.commit();receipts.append({'part':part,'messageId':mid})
        except Exception:
            conn.rollback();conn.close();raise
    conn.close()
    (folder/'receipts.json').write_text(json.dumps({'recipient':'group' if production else '崔经瀚','receipts':receipts,'manualPartialDate':allow_partial_date,
        'dataComplete':report.get('ready',False),'deliveryPolicy':'send_available'},ensure_ascii=False,indent=2),encoding='utf-8')
    return receipts

if __name__=='__main__':
    import argparse
    p=argparse.ArgumentParser();p.add_argument('folder');p.add_argument('--group',action='store_true');p.add_argument('--allow-partial-date');a=p.parse_args()
    print(json.dumps(deliver(a.folder,a.group,a.allow_partial_date),ensure_ascii=False))
