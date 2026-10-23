"""Bound new recovery history and payloads; pre-release records are protected."""
import datetime
import hashlib
import json
import os
import threading
import time
from receipt_storage import MARKER, PRODUCER

GUARD = threading.Lock()
STATUS = {'enabled': False, 'runs': 0, 'history_deleted': 0, 'receipt_payloads_expired': 0,
          'last_error': None, 'last_finished_at': None}


def utc_cutover(value):
    if not value:
        raise ValueError('Maintenance requires a fixed release cutover; legacy data stays protected')
    parsed = datetime.datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.tzinfo is None:
        raise ValueError('Release cutover must include a timezone')
    return parsed.astimezone(datetime.timezone.utc).replace(tzinfo=None)


def policy_from_env():
    paths = json.loads(os.environ.get('PINYING_HISTORY_PATHS_JSON', '{}'))
    checkpoints = json.loads(os.environ.get('PINYING_HISTORY_CHECKPOINTS_JSON', '{}'))
    floors = json.loads(os.environ.get('PINYING_HISTORY_PRUNE_MIN_VERSIONS_JSON', '{}'))
    if not isinstance(paths, dict) or not isinstance(checkpoints, dict) or not isinstance(floors, dict):
        raise ValueError('History maintenance allowlist must be an object')
    for scope, names in paths.items():
        if not isinstance(scope, str) or not isinstance(names, list) or len(names) > 8:
            raise ValueError('History maintenance scope is invalid')
        for name in names:
            if not isinstance(name, str) or not name.startswith('/') or len(name) > 1024:
                raise ValueError('History maintenance path is invalid')
            floor = floors.get(scope, {}).get(name)
            if type(floor) is not int or floor < 1:
                raise ValueError('Every history path requires its release baseline version')
            protected = checkpoints.get(scope, {}).get(name, [])
            if not isinstance(protected, list) or len(protected) > 8:
                raise ValueError('At most eight history checkpoints are allowed')
            for version in protected:
                if type(version) is not int or version < 1:
                    raise ValueError('Protected history checkpoint is invalid')
    project = os.environ.get('PINYING_STORAGE_PROJECT', '')
    if not project:
        raise ValueError('Maintenance requires an explicit project')
    return {'project': project, 'cutover': utc_cutover(os.environ.get('PINYING_GROWTH_CUTOVER_UTC', '')),
            'paths': paths, 'checkpoints': checkpoints, 'floors': floors, 'retain': 32, 'batch': 8,
            'byte_budget': 256 * 1024 * 1024, 'payload_days': int(os.environ.get('PINYING_RECEIPT_PAYLOAD_DAYS', '1')), 'interval': 15,
            'legacy_authorized': os.environ.get('PINYING_HISTORY_LEGACY_PRUNE_AUTHORIZED', 'false').lower() == 'true'}


def history_batch(db, scope, path, policy):
    digest = hashlib.sha256(path.encode()).digest()
    protected = policy['checkpoints'].get(scope, {}).get(path, [])
    floor = policy['floors'][scope][path]
    cutover = policy['cutover']
    # Explicitly authorize bounded retention of the two incident history paths.
    incident_paths = {('hub_documents', '/app/data/task-center.json'),
                      ('remix_files', '/data/clip-remix/library.json')}
    if policy.get('legacy_authorized') and policy['project'] == 'FD-026222' and (scope, path) in incident_paths:
        floor = 2
        cutover = datetime.datetime(1970, 1, 1)
    excluded = (' AND version NOT IN (' + ','.join(['%s'] * len(protected)) + ')') if protected else ''
    with db.cursor() as cursor:
        cursor.execute('SELECT version FROM pinying_documents WHERE scope=%s AND path_hash=%s', (scope, digest))
        current = cursor.fetchone()
        if not current:
            return 0
        # Versions have gaps after sampling: preserve actual newest ordinary snapshots.
        cursor.execute('SELECT version FROM pinying_document_history WHERE scope=%s AND path_hash=%s '
                       'AND version>1' + excluded + ' ORDER BY version DESC LIMIT %s',
                       (scope, digest, *protected, policy['retain']))
        recent = cursor.fetchall()
        if len(recent) < policy['retain']:
            return 0
        boundary = recent[-1][0]
        # The indexed scope/path/version range stays exact. No body is transferred.
        cursor.execute('SELECT version,OCTET_LENGTH(body) FROM pinying_document_history WHERE scope=%s AND path_hash=%s '
                       'AND version>1 AND version>=%s AND version<%s AND captured_at>=%s' + excluded + ' ORDER BY version LIMIT %s',
                       (scope, digest, floor, boundary, cutover, *protected, policy['batch']))
        candidates = cursor.fetchall()
        selected = []
        total = 0
        for version, size in candidates:
            if total + size > policy['byte_budget']:
                break
            selected.append(version)
            total += size
        if not selected:
            return 0
        placeholders = ','.join(['%s'] * len(selected))
        # Recheck every retention constraint in DELETE, including cutover.
        cursor.execute('DELETE FROM pinying_document_history WHERE scope=%s AND path_hash=%s '
                       'AND version IN (' + placeholders + ') AND version>1 AND version>=%s AND version<%s AND captured_at>=%s' + excluded,
                       (scope, digest, *selected, floor, boundary, cutover, *protected))
        return cursor.rowcount


def receipt_batch(db, scope, policy, now=None):
    now = now or datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
    expires_before = now - datetime.timedelta(days=policy['payload_days'])
    if expires_before <= policy['cutover']:
        return 0
    root = '$.' + MARKER
    with db.cursor() as cursor:
        # created_at uses the existing expiry index; legacy rows precede cutover.
        cursor.execute('SELECT request_id,fingerprint,OCTET_LENGTH(response_json) FROM pinying_rpc_receipts '
                       'WHERE scope=%s AND created_at>=%s AND created_at<%s '
                       'AND JSON_UNQUOTE(JSON_EXTRACT(response_json,%s))=%s '
                       'AND JSON_UNQUOTE(JSON_EXTRACT(response_json,%s))=%s '
                       'AND JSON_EXTRACT(response_json,%s)=CAST(%s AS JSON) '
                       'AND JSON_EXTRACT(response_json,%s)=CAST(%s AS JSON) ORDER BY created_at,request_id LIMIT %s',
                       (scope, policy['cutover'], expires_before, root + '.producer', PRODUCER,
                        root + '.project', policy['project'], root + '.committed', 'true', root + '.expired', 'false', policy['batch']))
        candidates = cursor.fetchall()
        total = changed = 0
        for request_id, fingerprint, size in candidates:
            if total + size > policy['byte_budget']:
                break
            total += size
            # Preserve scope/id/fingerprint and committed evidence indefinitely.
            cursor.execute('UPDATE pinying_rpc_receipts SET response_json=JSON_SET(JSON_REMOVE(response_json,%s,%s),'
                           '%s,CAST(%s AS JSON),%s,%s) WHERE scope=%s AND request_id=%s AND fingerprint=%s '
                           'AND created_at>=%s AND created_at<%s '
                           'AND JSON_UNQUOTE(JSON_EXTRACT(response_json,%s))=%s '
                           'AND JSON_UNQUOTE(JSON_EXTRACT(response_json,%s))=%s '
                           'AND JSON_EXTRACT(response_json,%s)=CAST(%s AS JSON)',
                           (root + '.content', root + '.data', root + '.expired', 'true', root + '.expired_at', now.isoformat() + 'Z',
                            scope, request_id, fingerprint, policy['cutover'], expires_before,
                            root + '.producer', PRODUCER, root + '.project', policy['project'], root + '.committed', 'true'))
            changed += cursor.rowcount
        return changed


def one_cycle(connection, history_scopes, receipt_scopes, policy):
    deleted = expired = 0
    # Use the same scope locks as writes; contention skips instead of queueing.
    scopes = sorted(set(history_scopes) | set(receipt_scopes))
    for scope in scopes:
        db = connection(autocommit=False)
        locked = False
        try:
            with db.cursor() as cursor:
                cursor.execute('SELECT GET_LOCK(%s,0)', ('pinying:scope:' + scope,))
                locked = cursor.fetchone()[0] == 1
            if not locked:
                continue
            h = r = 0
            if scope in history_scopes:
                for path in policy['paths'].get(scope, []):
                    h += history_batch(db, scope, path, policy)
            if scope in receipt_scopes:
                r += receipt_batch(db, scope, policy)
            db.commit()
            deleted += h
            expired += r
        except Exception:
            db.rollback()
            raise
        finally:
            if locked:
                with db.cursor() as cursor:
                    cursor.execute('SELECT RELEASE_LOCK(%s)', ('pinying:scope:' + scope,))
            db.close()
    return deleted, expired


def snapshot_status():
    with GUARD:
        return dict(STATUS)


def start_growth_maintenance(history_scopes, receipt_scopes):
    from common import mysql_connection
    policy = policy_from_env()
    with GUARD:
        STATUS.update(enabled=True, cutover=policy['cutover'].isoformat() + 'Z', retain=32, payload_days=policy['payload_days'])
    def maintain():
        while True:
            time.sleep(policy['interval'])
            try:
                deleted, expired = one_cycle(mysql_connection, history_scopes, receipt_scopes, policy)
                with GUARD:
                    STATUS['runs'] += 1
                    STATUS['history_deleted'] += deleted
                    STATUS['receipt_payloads_expired'] += expired
                    STATUS['last_error'] = None
                    STATUS['last_finished_at'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
                if deleted or expired:
                    print(json.dumps({'event': 'storage_growth_maintenance', 'history_deleted': deleted,
                                      'receipt_payloads_expired': expired}), flush=True)
            except Exception as error:
                # Log code/type only; connection details and business data stay private.
                code = error.args[0] if error.args and isinstance(error.args[0], int) else None
                with GUARD:
                    STATUS['last_error'] = {'type': type(error).__name__, 'code': code}
                print(json.dumps({'event': 'storage_growth_maintenance_failed', 'type': type(error).__name__, 'code': code}), flush=True)
    threading.Thread(target=maintain, daemon=True, name='bounded-storage-maintenance').start()
