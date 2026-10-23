"""Compare native MySQL candidates with existing authorized business interfaces."""
import json
from pathlib import Path
import sys
import urllib.request
import urllib.error
from urllib.parse import unquote

session = json.loads(Path('/run/secrets/browser-session.json').read_text())
cookies = {item['name']:item['value'] for item in session['cookies'] if item['domain'].lstrip('.') in {'hub.fandow.com','fandow.com'}}
cookie = '; '.join(name + '=' + value for name,value in cookies.items())
token = unquote(cookies.get('wis_oa_session',cookies.get('authorization',''))).removeprefix('Bearer ')


def read(base,path):
    request = urllib.request.Request(base+path,headers={'Cookie':cookie,'X-OA-Token':token,'Accept':'application/json'})
    try:
        with urllib.request.urlopen(request,timeout=90) as response:
            return response.status,json.loads(response.read())
    except urllib.error.HTTPError as error:
        return error.code, {'error':'Request failed'}


def ids(value):
    if isinstance(value,list): return sorted(json.dumps(ids(item),sort_keys=True) for item in value)
    if isinstance(value,dict):
        if 'id' in value: return {'id':value['id']}
        return {key:ids(item) for key,item in value.items() if isinstance(item,(dict,list))}
    return value


kind,old,new = sys.argv[1:4]
paths = ['/api/central-auth/me','/api/workstation/access-authorize?module=creative-hub'] if kind=='auth' else ['/api/assets?page=1&page_size=5','/api/notifications','/api/workspace/roles','/api/central-auth/me']
evidence = []
for path in paths:
    old_status, old_body = read(old,path)
    new_status, new_body = read(new,path)
    # Some interfaces are not part of an older surface. They must agree on
    # explicit denial or absence, while core authenticated reads must work.
    same = old_status == new_status and (old_body == new_body if path.endswith('/central-auth/me') else ids(old_body)==ids(new_body))
    item = {'path':path,'oldStatus':old_status,'candidateStatus':new_status,'sameIdentityAndAccess':same}
    evidence.append(item)
    print(json.dumps(item),flush=True)
Path('/state/'+kind+'-api-verified.json').write_text(json.dumps(evidence,indent=2))
if not all(item['sameIdentityAndAccess'] for item in evidence) or not any(item['candidateStatus']==200 for item in evidence):raise SystemExit(1)
