"""Collector repository preserving the existing lease/outbox state machine."""
import json
import re
import pymysql
from common import quote_identifier as q


class IntelligenceRepository:
    def __init__(self,db,specs):
        self.db=db
        self.specs=specs
        self.tables={name:q(specs[name]['mysql']) for name in ['runs','settings','messages']}

    def all(self,sql,args=()):
        with self.db.cursor(pymysql.cursors.DictCursor) as cursor:
            cursor.execute(sql,args)
            return [{key:value for key,value in row.items() if not key.startswith('__')} for row in cursor.fetchall()]

    def first(self,sql,args=()):
        rows=self.all(sql,args)
        return rows[0] if rows else None

    def run(self,sql,args=()):
        with self.db.cursor() as cursor:return cursor.execute(sql,args)

    def setting(self,key,value=None):
        table=self.tables['settings']
        if value is not None:
            self.run('INSERT INTO '+table+' (`key`,value) VALUES(%s,%s) ON DUPLICATE KEY UPDATE value=VALUES(value)',(key,str(value)))
        row=self.first('SELECT value FROM '+table+' WHERE `key`=%s',(key,))
        return row['value'] if row else None

    def claim(self,identity,window,test,now,retry_incomplete=False):
        runs=self.tables['runs']
        old=self.first('SELECT * FROM '+runs+' WHERE id=%s FOR UPDATE',(identity,))
        retry=bool(old and test and retry_incomplete and old['state'] in ['failed','partial'] and not self.first('SELECT uuid FROM '+self.tables['messages']+' WHERE run_id=%s LIMIT 1',(identity,)))
        if old and not retry and (old['state']!='running' or (old['lease'] is not None and old['lease']>now)):return None
        from datetime import datetime,timezone
        payload={'id':identity,'window':window,'test':bool(test),'startedAt':datetime.fromtimestamp(now/1000,timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z'),'state':'running','materials':{'status':'pending','items':[]},'competitors':{'status':'pending','items':[]}}
        if retry:
            previous=json.loads(old['payload'])
            attempt={key:previous[key] for key in ['finishedAt','state'] if key in previous}
            if 'error' in previous.get('materials',{}):attempt['materialError']=previous['materials']['error']
            if 'error' in previous.get('competitors',{}):attempt['competitorError']=previous['competitors']['error']
            payload['previousAttempts']=(previous.get('previousAttempts',[])+[attempt])[-10:]
        self.run('INSERT INTO '+runs+' (id,date,test,state,lease,payload) VALUES(%s,%s,%s,%s,%s,%s) ON DUPLICATE KEY UPDATE state=VALUES(state),lease=VALUES(lease),payload=VALUES(payload)',(identity,window['date'],int(bool(test)),'running',now+600000,json.dumps(payload,ensure_ascii=False)))
        return payload

    def insertMessage(self,run_id,target,message,ordinal):
        if isinstance(target,str):target={'id':target,'type':'chat_id','name':''}
        payload=message.get('payload') or {'msg_type':'text','content':json.dumps({'text':message.get('text')},ensure_ascii=False,separators=(',',':'))}
        self.run('INSERT INTO '+self.tables['messages']+' (uuid,run_id,ordinal,chat_id,text,receive_id_type,recipient_name,payload) VALUES(%s,%s,%s,%s,%s,%s,%s,%s) ON DUPLICATE KEY UPDATE uuid=uuid',
                 (message['uuid'],run_id,ordinal+1,target['id'],message.get('text',''),target['type'],target.get('name',''),json.dumps(payload,ensure_ascii=False,separators=(',',':'))))

    def finish(self,report,options=None):
        options=options or {}
        self.run('UPDATE '+self.tables['runs']+' SET state=%s,lease=NULL,payload=%s WHERE id=%s',(report['state'],json.dumps(report,ensure_ascii=False),report['id']))
        for ordinal,message in enumerate(options.get('messages',[])):self.insertMessage(report['id'],options['target'],message,ordinal)

    def get(self,identity):
        row=self.first('SELECT payload FROM '+self.tables['runs']+' WHERE id=%s',(identity,))
        return json.loads(row['payload']) if row else None

    def overview(self):
        rows=self.all('SELECT id,date,test,state,payload FROM '+self.tables['runs']+' ORDER BY date DESC,test ASC,__rowid DESC LIMIT 31')
        latest=json.loads(rows[0]['payload']) if rows else None
        if latest:latest['delivery']=self.delivery(latest['id'])
        return {'report':latest,'history':[{'id':row['id'],'date':row['date'],'test':bool(row['test']),'state':row['state']} for row in rows]}

    def delivery(self,identity,target=None):
        sql='SELECT ordinal,state,message_id AS messageId,error,receive_id_type AS receiveType,recipient_name AS recipientName FROM '+self.tables['messages']+' WHERE run_id=%s'
        args=[identity]
        if target:
            sql+=' AND receive_id_type=%s AND chat_id=%s'
            args.extend([target['type'],target['id']])
        return self.all(sql+' ORDER BY ordinal',args)

    def cancelOtherRecipients(self,target):
        return self.run('UPDATE '+self.tables['messages']+" SET state='cancelled',error=%s,lease=NULL WHERE state NOT IN ('sent','cancelled') AND (receive_id_type<>%s OR chat_id<>%s)",('接收范围已变更，该旧收件人的未送达消息停止投递',target['type'],target['id']))

    def enqueue(self,report,target,messages):
        for ordinal,message in enumerate(messages):self.insertMessage(report['id'],target,message,ordinal)

    def messageClaim(self,now):
        table=self.tables['messages']
        message=self.first('SELECT * FROM '+table+" WHERE (state IN ('ready','retry') AND next_at<=%s) OR (state='sending' AND lease<=%s) ORDER BY __rowid LIMIT 1 FOR UPDATE",(now,now))
        if not message:return None
        if message['first_at'] is not None and now-message['first_at']>=3600000:
            self.run('UPDATE '+table+" SET state='attention',error=%s WHERE uuid=%s",('超过幂等核验窗口，停止自动重发，请核对飞书消息',message['uuid']))
            return None
        self.run('UPDATE '+table+" SET state='sending',attempts=attempts+1,first_at=COALESCE(first_at,%s),lease=%s WHERE uuid=%s",(now,now+60000,message['uuid']))
        return {**message,'attempts':message['attempts']+1}

    def messageFinish(self,message,options,now):
        state='attention' if options['state']=='retry' and message['attempts']>=5 else options['state']
        self.run('UPDATE '+self.tables['messages']+' SET state=%s,message_id=%s,error=%s,next_at=%s,lease=NULL WHERE uuid=%s',
                 (state,options.get('messageId'),options.get('error'),now+min(300000,10000*2**message['attempts']),message['uuid']))

    def close(self):return None

    def rawQuery(self,sql,params=None):
        params=params or []
        if re.fullmatch(r'\s*INSERT\s+OR\s+REPLACE\s+INTO\s+intelligence_images\s+VALUES\s*\(\s*\?\s*,\s*\?\s*,\s*\?\s*\)\s*;?\s*',sql,re.I):
            table=q(self.specs['intelligence_images']['mysql'])
            changes=self.run('INSERT INTO '+table+' (cache_key,image_key,created_at) VALUES(%s,%s,%s) ON DUPLICATE KEY UPDATE image_key=VALUES(image_key),created_at=VALUES(created_at)',params)
            return {'results':[],'meta':{'changes':changes,'last_row_id':0}}
        from sql_gateway import execute
        return execute(self.db,sql,params,self.specs)


def invoke(db,specs,method,args):
    allowed={'setting','claim','finish','get','overview','delivery','cancelOtherRecipients','enqueue','messageClaim','messageFinish','insertMessage','close','rawQuery'}
    if method not in allowed:raise ValueError('Unknown collector operation')
    return getattr(IntelligenceRepository(db,specs),method)(*args)
