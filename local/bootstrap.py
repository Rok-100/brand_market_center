"""Initialize only the isolated local database and writable application volumes."""
import json
import os
from pathlib import Path
import sys

import pymysql


def main():
    if os.environ.get('LOCAL_SIMULATION') != '1':
        raise RuntimeError('LOCAL_SIMULATION=1 is required')
    host = os.environ.get('MYSQL_HOST', 'mysql')
    database = os.environ.get('MYSQL_DATABASE', 'wis_local')
    user = os.environ.get('MYSQL_USER', 'wis_local')
    if (host, database, user) != ('mysql', 'wis_local', 'wis_local'):
        raise RuntimeError('Bootstrap only permits the bundled local MySQL instance')
    password = os.environ['MYSQL_ROOT_PASSWORD']
    connection = pymysql.connect(host=host, port=int(os.environ.get('MYSQL_PORT', '3306')),
        user='root', password=password, database=database, charset='utf8mb4', autocommit=True)
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT GET_LOCK('brand-market-full-bootstrap', 120)")
            if cursor.fetchone()[0] != 1:
                raise RuntimeError('Another local bootstrap is still running')
            # The independent remix library shares the asset schema but keeps
            # its own identities, generated uniqueness column and indexes.
            cursor.execute('CREATE TABLE IF NOT EXISTS py_cloud_remix_assets LIKE py_cloud_assets')
            registry = json.loads(Path('/local-schemas/migration-registry.json').read_text(encoding='utf-8-sig'))
            for scope, schema in registry.items():
                cursor.execute('INSERT IGNORE INTO pinying_storage_schemas(scope,source_path,schema_json,updated_at) VALUES (%s,%s,%s,NOW(6))',
                    (scope, 'local-schema-only', json.dumps(schema, ensure_ascii=False)))
            cursor.execute('INSERT IGNORE INTO py_cloud_app_meta (`key`,`value`) VALUES (%s,%s)',
                ('database.instance_id', 'brand-hub-local-simulation'))
            cursor.execute('SELECT @@server_uuid')
            server_uuid = cursor.fetchone()[0]
            config_path = Path('/run/secrets/cloud-mysql.json')
            config = json.loads(config_path.read_text(encoding='utf-8'))
            existing = config.get('expectedMysqlServerUuid')
            if existing and existing != '__MYSQL_UUID__' and existing != server_uuid:
                raise RuntimeError('Local MySQL identity changed; configuration was not overwritten')
            config['expectedMysqlServerUuid'] = server_uuid
            temporary = config_path.with_suffix('.json.tmp')
            temporary.write_text(json.dumps(config, indent=2) + '\n', encoding='utf-8')
            temporary.chmod(0o600)
            # Application containers use UID 10001 and need read access to this config.
            os.chown(temporary, 10001, 10001)
            temporary.replace(config_path)
            cursor.execute('SELECT `value` FROM py_cloud_app_meta WHERE `key`=%s', ('local.bootstrap.analytical.v1',))
            if cursor.fetchone() is None:
                seed_path = Path(os.environ.get('LOCAL_SEED_SCRIPT', '/local/seed-analytical.py'))
                seed = seed_path.read_text(encoding='utf-8')
                # Replace a bare placeholder with a variable name, never credentials
                # embedded in shell commands or emitted in diagnostic output.
                seed = seed.replace('__LOCAL_ROOT_PASSWORD__', '_local_root_password')
                namespace = {'__name__': '__local_seed__', '__file__': str(seed_path), '_local_root_password': password}
                exec(compile(seed, str(seed_path), 'exec'), namespace)
                cursor.execute('INSERT INTO py_cloud_app_meta (`key`,`value`) VALUES (%s,%s)',
                    ('local.bootstrap.analytical.v1', 'complete'))
            cursor.execute("GRANT SELECT ON d_root_project_mid_db_brandmarketing.* TO 'wis_local'@'%'")
        # Never touch database engine volumes: compose mounts application volumes
        # only beneath this dedicated directory.
        volumes = Path('/local-volumes')
        if volumes.exists():
            for folder, directories, files in os.walk(volumes, followlinks=False):
                os.chown(folder, 10001, 10001, follow_symlinks=False)
                for name in directories + files:
                    os.chown(Path(folder) / name, 10001, 10001, follow_symlinks=False)
        for item in Path('/run/secrets').iterdir():
            if item.is_file() and not item.is_symlink():
                os.chown(item, 10001, 10001)
                item.chmod(0o600)
        print('Local schema metadata, database binding and application permissions initialized.')
    finally:
        connection.close()


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Database exceptions may include SQL values; never log their message.
        print('Local bootstrap failed: ' + type(error).__name__ + '. Check bundled database health and local configuration.', file=sys.stderr)
        raise SystemExit(1)
