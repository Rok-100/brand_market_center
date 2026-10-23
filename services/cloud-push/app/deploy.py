"""Run on the server as brand-marketing. Reuses secrets locally, never prints them."""
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path('/home/brand-marketing/fandow-apps/fd-026222')
RELEASE = ROOT / 'releases/cloud-push-cards-20260929-v1'
STATE = ROOT / 'persistent/cloud-push-cards-20260929-v1'
NAME = 'brand-marketing-fd-026222-cloud-push-cards-20260929-v1'


def inspect(name):
    return json.loads(subprocess.check_output(['docker', 'inspect', name]))[0]


def main():
    os.umask(0o077)
    cloud = inspect('brand-marketing-fd-026222-cloud-manager')
    notices = inspect('brand-marketing-fd-026222-service-notifications-perf-20260924')
    env = dict(s.split('=', 1) for s in notices['Config']['Env'])
    cloud_env = dict(s.split('=', 1) for s in cloud['Config']['Env'])
    assert env.get('FEISHU_APP_ID') == 'cli_aa9c744d6ffa1cc4', 'Unexpected Feishu app'
    assert env.get('FEISHU_APP_SECRET'), 'Missing existing app secret'
    assert cloud_env.get('DATABASE_URL') == 'sqlite:////data/wis_video_center.db', 'Unexpected database location'
    source = next(m['Source'] for m in cloud['Mounts'] if m['Destination'] == '/data')
    assert Path(source).resolve().is_relative_to(ROOT / 'persistent/cloud-manager'), 'Unexpected source mount'
    network = 'fd-026222-unified-candidate-20260919'
    assert network in notices['NetworkSettings']['Networks'], 'Notification network unavailable'
    url = env.get('CLOUD_NOTIFICATION_PUBLIC_URL') or 'https://hub.fandow.com/yxb/wis-marketing-hub/modules/cloud-manager/'
    parsed = urlparse(url)
    assert parsed.scheme == 'https' and not parsed.username and not parsed.password, 'Invalid public URL'
    config = {'enabled': False, 'app_id': env['FEISHU_APP_ID'], 'app_secret': env['FEISHU_APP_SECRET'],
              'recipient_mode': 'operator', 'receive_id_type': env.get('FEISHU_RECEIVE_ID_TYPE') or 'open_id',
              'recipient_map': json.loads(env.get('FEISHU_RECIPIENT_MAP_JSON', '{}')), 'public_url': url}
    assert config['recipient_map'], 'No verified recipients'
    STATE.mkdir(mode=0o700, exist_ok=True)
    config_file = STATE / 'config.json'
    if config_file.exists():
        previous = json.loads(config_file.read_text(encoding='utf-8'))
        assert previous.get('enabled') is False, 'Existing activation must be reviewed before redeploying'
    security = json.loads(subprocess.check_output(['docker', 'info', '--format', '{{json .SecurityOptions}}']))
    assert 'name=rootless' in security, 'This release is prepared for rootless Docker'
    assert cloud['Config']['User'] in {'10001', '10001:10001'}, 'Unexpected source container user'
    container_user = '10001:10001'
    config_file.write_text(json.dumps(config, ensure_ascii=False), encoding='utf-8')
    config_file.chmod(0o600)
    # Give only the existing cloud service group access to this new directory.
    # This one-shot helper has no network and mounts no production source data.
    permission_script = "import os; os.chown('/state',0,10001); os.chmod('/state',0o770); os.chown('/state/config.json',0,10001); os.chmod('/state/config.json',0o640)"
    subprocess.run(['docker', 'run', '--rm', '--network', 'none', '--read-only', '--user', '0:0',
                    '--cap-drop', 'ALL', '--cap-add', 'CHOWN', '--security-opt', 'no-new-privileges',
                    '-v', f'{STATE}:/state:rw', '--entrypoint', 'python', cloud['Image'], '-c', permission_script], check=True)
    common = ['docker', 'run', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
              '--user', container_user, '--network', network,
              '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m', '--memory', '192m', '--cpus', '0.5',
              '-v', f'{RELEASE}:/work:ro', '-v', f'{source}:/source:ro',
              '-v', f'{STATE}:/notifications:rw', '-w', '/work',
              '-e', 'PUSH_NOTIFICATION_CONFIG=/notifications/config.json',
              '-e', 'PUSH_NOTIFICATION_SOURCE_DB=/source/wis_video_center.db',
              '-e', 'PUSH_NOTIFICATION_STATE=/notifications', '--entrypoint', 'python']
    # Read-only source and token authentication preflight: sends no messages.
    preflight = """
import json
from app.video_push_notifications import read_tasks,FeishuSender,recipient
c=json.load(open('/notifications/config.json'))
tasks=read_tasks('/source/wis_video_center.db')
FeishuSender(c).tenant_token()
counts={p:sum(t['platform']==p for t in tasks) for p in ['qianchuan','adq','channels']}
missing=set()
for t in tasks:
 try: recipient(t,c)
 except ValueError: missing.add(t['created_by_number'])
print(json.dumps({'source_readable':True,'app_authentication':True,'task_counts':counts,'unmapped_historical_operator_count':len(missing)}))
"""
    subprocess.run(common + ['--rm', cloud['Image'], '-c', preflight], check=True)
    if '--activate' not in sys.argv:
        print('Preflight passed. Sending is disabled. Activation requires --activate on the initial deployment.')
        return
    # Source baseline is established by the worker before any sending is possible.
    config['enabled'] = True
    config_file.write_text(json.dumps(config, ensure_ascii=False), encoding='utf-8')
    health = "import json,time; d=json.load(open('/notifications/health.json')); assert d['ok'] and time.time()-d['checked_at']<300"
    subprocess.run(common + ['-d', '--name', NAME, '--restart', 'unless-stopped',
                            '--health-cmd', 'python -c ' + __import__('shlex').quote(health),
                            '--health-interval', '30s', '--health-timeout', '5s', '--health-retries', '3',
                            '--health-start-period', '30s', cloud['Image'], '-m', 'app.video_push_notifications'], check=True, stdout=subprocess.DEVNULL)
    record = {'container': NAME, 'source_container': cloud['Name'], 'base_image': cloud['Image'],
              'recipient_mode': 'operator', 'app_id': config['app_id'],
              'source_read_only': True, 'business_container_restarted': False,
              'code_sha256': hashlib.sha256((RELEASE / 'app/video_push_notifications.py').read_bytes()).hexdigest()}
    (RELEASE / 'activated.json').write_text(json.dumps(record, indent=2), encoding='utf-8')
    print(json.dumps(record))


if __name__ == '__main__':
    main()
