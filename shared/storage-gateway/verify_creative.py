"""Compare authenticated business reads without logging sessions or row contents."""
import hashlib
import json
from pathlib import Path
import urllib.request
import urllib.error
import sys

session = json.loads(Path('/run/secrets/browser-session.json').read_text())
cookie = '; '.join(item['name'] + '=' + item['value'] for item in session['cookies'] if item['domain'].lstrip('.') in {'hub.fandow.com','fandow.com'})
old, candidate = sys.argv[1:3]


def read(base, path):
    request = urllib.request.Request(base + path, headers={'Cookie':cookie,'Accept':'application/json'})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as error:
        data = error.read()
        try: data = json.loads(data)
        except ValueError: data = {'error': 'Non-JSON response'}
        return error.code, {'error':data.get('error',data.get('detail','Request failed'))}


def identities(value):
    if isinstance(value, list):
        return sorted((json.dumps(identities(item),sort_keys=True) for item in value))
    if isinstance(value, dict):
        if 'id' in value:
            return {'id': value['id']}
        return {key:identities(item) for key,item in value.items() if isinstance(item,(list,dict))}
    return value


evidence = []
for path in ['/api/cases','/api/scripts','/api/creative-workbench','/api/collaborations','/api/competitor-cases']:
    old_status, old_body = read(old, path)
    new_status, new_body = read(candidate, path)
    same = old_status == new_status == 200 and identities(old_body) == identities(new_body)
    item = {'path':path,'oldStatus':old_status,'candidateStatus':new_status,'entityIdsMatch':same,
            'oldDigest':hashlib.sha256(json.dumps(identities(old_body),sort_keys=True).encode()).hexdigest(),
            'candidateDigest':hashlib.sha256(json.dumps(identities(new_body),sort_keys=True).encode()).hexdigest()}
    if new_status != 200: item['error'] = new_body
    evidence.append(item)
    print(json.dumps(item),flush=True)
Path('/state/creative-api-verified.json').write_text(json.dumps(evidence,indent=2))
if not all(item['entityIdsMatch'] for item in evidence): raise SystemExit(1)
