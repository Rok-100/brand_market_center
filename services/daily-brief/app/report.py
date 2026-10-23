"""Deterministic attribution and exact-cent aggregation. No network or secrets."""
from collections import defaultdict
from datetime import date,timedelta
from decimal import Decimal
import json,re
from pathlib import Path
ROOT=Path(__file__).resolve().parent

def load(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))

def people_from_base(raw):
    data=raw['data']
    if data.get('has_more'):
        raise ValueError('Keyword table pagination incomplete')
    people={}
    for rid,values in zip(data['record_id_list'],data['data']):
        v=dict(zip(data['field_id_list'],values))
        person=v.get('fldXOIq3FG') or []
        employee=v.get('fldoXkpzge')
        if not person or not employee:
            continue
        p=people.setdefault(employee,{'employeeId':employee,'name':person[0]['name'],
            'department':' / '.join(v.get('flda7cLLdC') or []),'rules':[]})
        if p['name'] != person[0]['name']:
            raise ValueError('Employee ID has conflicting names')
        keywords=[]
        for field in ['fldgHUr7Jp','fldtr8qv73']:
            keywords += [k.strip().lower() for k in re.split(r'[,，;；\n、/]+',v.get(field) or '') if k.strip()]
        p['rules'].append({'channel':v.get('fldJ5N37jD'),'keywords':sorted(set(keywords)), 'recordId':rid})
    return list(people.values())

def keyword_matches(signal,kw):
    # Single-letter/character tokens are too ambiguous, matching cloud-manager's rule.
    if len(kw)<2:return False
    if re.fullmatch(r'[\u3400-\u9fff]+',kw):return kw in signal
    return bool(re.search(rf'(^|[^a-z0-9]){re.escape(kw)}(?=$|[^a-z])',signal,re.I))

def match(material,people):
    channel='抖音' if material['channel']=='千川' else '视频号'
    eligible=[(p,[r for r in p['rules'] if not r['channel'] or r['channel']==channel]) for p in people]
    eligible=[(p,rules) for p,rules in eligible if rules]
    author=(material.get('internal_author') or '').strip().lower()
    exact=[(p,author) for p,_ in eligible if author and p['name'].lower()==author]
    candidates=exact
    if not candidates:
        signal=(author+' '+(material.get('material_name') or '')).lower()
        for p,rules in eligible:
            hits=[k for r in rules for k in r['keywords'] if keyword_matches(signal,k)]
            if hits:candidates.append((p,max(hits,key=len)))
        if candidates:
            longest=max(len(k) for _,k in candidates)
            candidates=[c for c in candidates if len(c[1])==longest]
    if len(candidates)==1:return 'mapped',candidates[0][0],candidates[0][1]
    return ('conflict' if candidates else 'unmapped'),None,[p['employeeId'] for p,_ in candidates]

def cents(value):
    return int((Decimal(str(value or 0))*100).quantize(Decimal('1')))

def aggregate(rows,people):
    monthly={}; seen=set()
    for row in rows:
        sourcekey=tuple(str(row.get(f) or '') for f in ['channel','source_platform','advertiser_id','material_id'])
        dailykey=(row['report_date'],)+sourcekey
        if dailykey in seen:raise ValueError('Duplicate daily material row: '+str(dailykey))
        seen.add(dailykey)
        m=monthly.setdefault(sourcekey,{**row,'gmvCents':0})
        m['gmvCents']+=cents(row['gmv_yuan'])
        for field in ['material_name','internal_author']:
            if row.get(field):m[field]=row[field]
    ranking={}; quality=defaultdict(int); audit=[]
    for m in monthly.values():
        state,p,evidence=match(m,people)
        quality[state+'Cents']+=m['gmvCents'];quality[state+'Count']+=1
        audit.append({**m,'attribution':state,'employeeId':p['employeeId'] if p else None,'evidence':evidence})
        if not p:continue
        item=ranking.setdefault(p['employeeId'],{k:p[k] for k in ['employeeId','name','department']}|{'gmvCents':0,'materials':set(),'channels':defaultdict(int)})
        item['gmvCents']+=m['gmvCents'];item['channels'][m['channel']]+=m['gmvCents']
        dedup=re.sub(r'[^a-z0-9\u3400-\u9fff]+','',(m.get('material_name') or '').lower())
        item['materials'].add(dedup or f"{m['source_platform']}|{m['material_id']}")
    ranked=[]
    for r in ranking.values():
        r['materialCount']=len(r.pop('materials')); ranked.append(r)
    ranked.sort(key=lambda r:(-r['gmvCents'],r['employeeId']))
    quality['totalCents']=sum(m['gmvCents'] for m in monthly.values())
    assert quality['totalCents']==sum(quality[k+'Cents'] for k in ['mapped','unmapped','conflict'])
    assert sum(r['gmvCents'] for r in ranked)==quality['mappedCents']
    return ranked,dict(quality),audit

def material_trend(rows,start,end):
    by_day={};by_product=defaultdict(dict);seen=set()
    for row in rows:
        day=str(row['report_date'])[:10];name=str(row.get('product_name') or '待映射')
        if not str(start)<=day<=str(end):raise ValueError('Material trend date outside requested range')
        key=(day,name)
        if key in seen:raise ValueError('Duplicate material product/date')
        seen.add(key)
        value=Decimal(str(row['product_online']));total=Decimal(str(row['online_total']))
        if value<0 or value!=int(value) or total<0 or total!=int(total):raise ValueError('Invalid material count')
        if day in by_day and by_day[day]!=int(total):raise ValueError('Inconsistent daily material total')
        by_day[day]=int(total);by_product[name][day]=int(value)
    for day,total in by_day.items():
        if sum(values.get(day,0) for values in by_product.values())!=total:
            raise ValueError('Product counts do not reconcile with daily total')
    unmapped=sum(by_product.pop('待映射',{}).values())
    products=sorted([{'name':name,'days':{day:values.get(day,0) for day in by_day},
        'totalCount':sum(values.values())} for name,values in by_product.items()],key=lambda r:(-r['totalCount'],r['name']))
    missing=[str(start+timedelta(days=i)) for i in range((end-start).days+1) if str(start+timedelta(days=i)) not in by_day]
    return products,{'totalCount':sum(by_day.values()),'unmappedCount':unmapped,
        'mappedCount':sum(p['totalCount'] for p in products),'missingDates':missing,
        'dailyTotals':by_day,'coverageState':'partial','source':'素材过程 / 素材上线趋势'}

def build(target):
    folder=ROOT/'data'/str(target);manifest=load(folder/'complete.json')
    expected=[f'{d}-{s}' for d in [target.replace(day=1)+timedelta(days=i) for i in range(target.day)] for s in ['standard','chengfang','haitun','adq']]
    expected += ['material-online']
    if set(manifest['jobs'])!=set(expected):raise ValueError('Incomplete extraction manifest')
    rows=[];trends=[];empty=[]
    for label in expected:
        result=load(folder/(label+'.json'))
        if result.get('truncated'):raise ValueError('Truncated query')
        if not result['rows'] and not result.get('sourceCoverage',{}).get('hasSnapshot'):empty.append(label)
        (trends if label=='material-online' else rows).extend(result['rows'])
    people=people_from_base(load(ROOT/'data/creator-keyword-records.json'))
    rankings,quality,audit=aggregate(rows,people)
    freshness={r['source_name']:str(r['data_date'])[:10] for r in load(folder/'freshness.json')['rows']}
    delayed=[k for k,v in freshness.items() if v<str(target)]
    products,trend_quality=material_trend(trends,target-timedelta(days=14),target)
    report={'target':str(target),'start':str(target.replace(day=1)),'trendStart':str(target-timedelta(days=14)),
      'rankings':rankings,'quality':quality,'products':products,'peopleCount':len(people),'freshness':freshness,
      'trendType':'material-online','trendQuality':trend_quality,
      'emptyQueries':empty,'delayedSources':delayed,'ready':not delayed and not empty and not trend_quality['missingDates'],
      'keywordRevision':load(ROOT/'data/creator-keyword-records.json')['data'].get('rev')}
    out=ROOT/'output'/str(target);out.mkdir(parents=True,exist_ok=True)
    (out/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    (out/'attribution-audit.json').write_text(json.dumps(audit,ensure_ascii=False),encoding='utf-8')
    return report,out

if __name__=='__main__':
    import sys
    r,out=build(date.fromisoformat(sys.argv[1]))
    print(json.dumps({k:r[k] for k in ['target','ready','quality','emptyQueries','freshness']},ensure_ascii=False))
