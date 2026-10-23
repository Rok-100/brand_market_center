"""Exact-path transactional recovery policy. Legacy migration is never implicit."""
import json
import os
from pathlib import Path

RETAIN = 32
MAX_CHECKPOINTS = 8
SAMPLE_SECONDS = 300
INCIDENT_PATHS = {('hub_documents', '/app/data/task-center.json'),
                  ('remix_files', '/data/clip-remix/library.json')}


# This opt-in file is installed only in the isolated local simulator. The
# watermark protects every existing version; no implicit legacy migration runs.
LOCAL_POLICY_PATH = Path(__file__).with_name('history-retention.local.json')
LOCAL_PATHS = {('remix_documents', '/data/clip-remix/library.json')}


def local_policy_for(scope, path):
    if os.environ.get('LOCAL_SIMULATION') != '1' or (scope, path) not in LOCAL_PATHS:
        return None
    if not LOCAL_POLICY_PATH.exists():
        return None
    config = json.loads(LOCAL_POLICY_PATH.read_text(encoding='utf-8'))
    if (not isinstance(config, dict) or type(config.get('schema_version')) is not int or
            config.get('schema_version') != 1 or config.get('mode') != 'new_versions_only'):
        raise ValueError('Invalid local history policy mode')
    entry = config.get('paths', {}).get(scope, {}).get(path)
    if entry is None:
        raise ValueError('Local history policy is missing the exact target path')
    if not isinstance(entry, dict):
        raise ValueError('Invalid local history path policy')
    floor = entry.get('migration_floor')
    if type(floor) is not int or floor < 1:
        raise ValueError('Local history requires a positive explicit watermark')
    checkpoints = entry.get('checkpoints', [])
    if (not isinstance(checkpoints, list) or len(checkpoints) > MAX_CHECKPOINTS or
            any(type(v) is not int or v < 1 or v > floor for v in checkpoints)):
        raise ValueError('Invalid local history checkpoints')
    return {'retain': RETAIN, 'protected': sorted(set([1, floor, *checkpoints])),
            'sample_seconds': SAMPLE_SECONDS, 'migration_floor': floor,
            'new_versions_only': True}


def policy_for(scope, path):
    local_policy = local_policy_for(scope, path)
    if local_policy is not None:
        return local_policy
    if os.environ.get('PINYING_HISTORY_TRANSACTION_ENABLED', 'false').lower() != 'true':
        return None
    if os.environ.get('PINYING_STORAGE_PROJECT') != 'FD-026222':
        raise ValueError('Transactional history requires the approved project')
    paths = json.loads(os.environ.get('PINYING_HISTORY_PATHS_JSON', '{}'))
    if (scope, path) not in INCIDENT_PATHS or path not in paths.get(scope, []):
        return None
    checkpoints = json.loads(os.environ.get('PINYING_HISTORY_CHECKPOINTS_JSON', '{}')).get(scope, {}).get(path, [])
    if not isinstance(checkpoints, list) or len(checkpoints) > MAX_CHECKPOINTS or any(type(v) is not int or v < 1 for v in checkpoints):
        raise ValueError('At most eight positive recovery checkpoints are allowed')
    floors = json.loads(os.environ.get('PINYING_HISTORY_MIGRATION_FLOORS_JSON', '{}'))
    floor = floors.get(scope, {}).get(path, 0)
    if type(floor) is not int or floor < 0:
        raise ValueError('Invalid explicit migration watermark')
    return {'retain': RETAIN, 'protected': sorted(set([1, *checkpoints])), 'sample_seconds': SAMPLE_SECONDS,
            'migration_floor': floor}


def ordinary_versions(cursor, scope, digest, policy):
    protected = policy['protected']
    cursor.execute('SELECT version FROM pinying_document_history WHERE scope=%s AND path_hash=%s '
                   'AND version>%s AND version NOT IN (' + ','.join(['%s'] * len(protected)) + ') '
                   'ORDER BY version DESC LIMIT %s',
                   (scope, digest, policy.get('migration_floor', 0), *protected, policy['retain'] + 9))
    return [row[0] for row in cursor.fetchall()]


def before_write(cursor, scope, digest, previous, policy, force=False):
    # Called under the document row lock and caller-owned transaction.
    # More than eight excess versions is a legacy migration, not a request-time cleanup.
    versions = ordinary_versions(cursor, scope, digest, policy)
    if len(versions) > policy['retain'] + 8:
        raise ValueError('HISTORY_MIGRATION_REQUIRED: backup and authorize legacy history first')
    if not previous:
        return
    if policy.get('new_versions_only'):
        if previous[2] < policy['migration_floor']:
            raise ValueError('Local history watermark exceeds current document version')
        # Use the scope/path/version primary key instead of scanning all legacy
        # captured_at values on every write.
        cursor.execute('SELECT TIMESTAMPDIFF(MICROSECOND,captured_at,UTC_TIMESTAMP(6)) '
                       'FROM pinying_document_history WHERE scope=%s AND path_hash=%s '
                       'ORDER BY version DESC LIMIT 1', (scope, digest))
        row = cursor.fetchone()
        elapsed = row[0] if row else None
    else:
        cursor.execute('SELECT TIMESTAMPDIFF(MICROSECOND,MAX(captured_at),UTC_TIMESTAMP(6)) '
                       'FROM pinying_document_history WHERE scope=%s AND path_hash=%s', (scope, digest))
        elapsed = cursor.fetchone()[0]
    if force or previous[2] in policy['protected'] or elapsed is None or elapsed >= policy['sample_seconds'] * 1000000:
        cursor.execute('INSERT IGNORE INTO pinying_document_history '
                       'SELECT scope,path_hash,version,body,sha256,UTC_TIMESTAMP(6) FROM pinying_documents '
                       'WHERE scope=%s AND path_hash=%s', (scope, digest))


def after_write(cursor, scope, digest, policy):
    versions = ordinary_versions(cursor, scope, digest, policy)
    excess = versions[policy['retain']:]
    if len(excess) > 8:
        raise ValueError('HISTORY_MIGRATION_REQUIRED: transaction rolled back')
    if excess:
        cursor.execute('DELETE FROM pinying_document_history WHERE scope=%s AND path_hash=%s '
                       'AND version>%s AND version IN (' + ','.join(['%s'] * len(excess)) + ')',
                       (scope, digest, policy.get('migration_floor', 0), *excess))
        if cursor.rowcount != len(excess):
            raise ValueError('History retention conflict; transaction must roll back')
    if len(ordinary_versions(cursor, scope, digest, policy)) > policy['retain']:
        raise ValueError('History hard limit not satisfied; transaction must roll back')
