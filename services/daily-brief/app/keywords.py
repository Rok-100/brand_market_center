"""Daily bot-identity refresh of the configured Feishu view, including all pages."""
import json,os
from datetime import datetime,timezone
from report import ROOT,load,people_from_base
from send import Feishu

FIELDS=[('fldXOIq3FG','人员'),('fldoXkpzge','人员-工号'),('flda7cLLdC','人员.部门'),
        ('fldJ5N37jD','渠道'),('fldgHUr7Jp','素材名识别关键词（例：张三、zs）'),('fldtr8qv73','其他（有多种命名方式可填，非必填）')]

def text(value):
    if value is None:return None
    if isinstance(value,list):return ''.join(text(v) or '' for v in value)
    if isinstance(value,dict):return str(value.get('text',value.get('name','')))
    return str(value)

def refresh():
    cfg=load(ROOT/'config.json');client=Feishu(load(os.environ['REPORT_FEISHU_CREDENTIALS']))
    url=f"https://open.feishu.cn/open-apis/bitable/v1/apps/{cfg['keywordBaseToken']}/tables/{cfg['keywordTableId']}/records"
    rows=[];ids=[];token=None;seen=set()
    while True:
        params={'view_id':cfg['keywordViewId'],'page_size':500,'field_names':json.dumps([name for _,name in FIELDS],ensure_ascii=False)}
        if token:params['page_token']=token
        data=client.checked(client.http.get(url,params=params,timeout=45))['data']
        for item in data.get('items',[]):
            rid=item['record_id']
            if rid in seen:raise RuntimeError('Duplicate keyword record while paging')
            seen.add(rid);values=item.get('fields',{});row=[]
            for fid,name in FIELDS:
                value=values.get(name)
                if fid=='fldXOIq3FG':row.append(value or [])
                elif fid=='flda7cLLdC':row.append([text(v) for v in value] if isinstance(value,list) else [text(value)] if value else [])
                else:row.append(text(value))
            rows.append(row);ids.append(rid)
        if not data.get('has_more'):break
        nxt=data.get('page_token')
        if not nxt or nxt==token:raise RuntimeError('Invalid keyword pagination token')
        token=nxt
    result={'ok':True,'identity':'bot','fetchedAt':datetime.now(timezone.utc).isoformat(),
      'data':{'data':rows,'record_id_list':ids,'field_id_list':[id for id,_ in FIELDS],
        'has_more':False,'rev':None,'query_context':{'view_id':cfg['keywordViewId']}}}
    people=people_from_base(result)
    if not people:raise RuntimeError('Keyword table returned no usable members')
    path=ROOT/'data/creator-keyword-records.json';path.parent.mkdir(exist_ok=True)
    tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(result,ensure_ascii=False),encoding='utf-8');tmp.replace(path)
    return {'records':len(rows),'people':len(people)}
