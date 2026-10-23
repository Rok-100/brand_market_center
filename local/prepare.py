"""Generate private local configuration without Docker, builds or network access."""
import json
import os
from pathlib import Path
import re
import secrets
import importlib.util

ROOT = Path(__file__).resolve().parents[1]
KIT = ROOT / 'local'
RUNTIME = ROOT / '.local'


def dotenv():
    values = {}
    path = ROOT / '.env'
    if path.exists():
        for line in path.read_text(encoding='utf-8-sig').splitlines():
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            if line.startswith('export '):
                line = line[7:]
            key, separator, value = line.partition('=')
            if not separator or not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', key.strip()):
                raise ValueError('Invalid .env assignment')
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in '\"\'':
                value = value[1:-1]
            else:
                value = re.split(r'\s+#', value, maxsplit=1)[0].rstrip()
            values[key.strip()] = value
    values.update(os.environ)
    return values


def write_private(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.tmp')
    temporary.write_text(content, encoding='utf-8', newline='\n')
    temporary.chmod(0o600)
    temporary.replace(path)


def main():
    values = dotenv()
    port = int(values.get('HUB_PORT', '8095'))
    if not 1024 <= port <= 65535:
        raise ValueError('HUB_PORT must be between 1024 and 65535')
    project = values.get('COMPOSE_PROJECT_NAME', 'brand-market-full')
    if not re.fullmatch(r'[a-z0-9][a-z0-9_-]*', project):
        raise ValueError('Invalid COMPOSE_PROJECT_NAME')
    RUNTIME.mkdir(exist_ok=True)
    config_dir = RUNTIME / 'config'
    config_dir.mkdir(exist_ok=True)
    templates = sorted((KIT / 'config-templates').iterdir())
    compose_text = (KIT / 'compose.template.json').read_text(encoding='utf-8')
    texts = [compose_text] + [p.read_text(encoding='utf-8') for p in templates if p.is_file()]
    secret_file = config_dir / 'generated-values.json'
    secret_values = json.loads(secret_file.read_text(encoding='utf-8')) if secret_file.exists() else {}
    for slot in set(re.findall(r'__LOCAL_SECRET_\d+__', '\n'.join(texts))):
        secret_values.setdefault(slot, secrets.token_hex(24))
    write_private(secret_file, json.dumps(secret_values, indent=2) + '\n')

    def expand(text):
        for key, value in secret_values.items():
            text = text.replace(key, value)
        text = text.replace('__RUNTIME__', '.')
        text = text.replace('__HUB_PORT__', str(port)).replace('__PROJECT_NAME__', project)
        return text

    for template in templates:
        if not template.is_file():
            continue
        filename = 'flow-personnel-overrides.json' if template.name == 'flow-overrides.template.json' else template.name
        destination = config_dir / filename
        content = expand(template.read_text(encoding='utf-8'))
        if filename == 'cloud-mysql.json' and destination.exists():
            old = json.loads(destination.read_text(encoding='utf-8'))
            new = json.loads(content)
            if old.get('expectedMysqlServerUuid'):
                new['expectedMysqlServerUuid'] = old['expectedMysqlServerUuid']
            content = json.dumps(new, ensure_ascii=False, indent=2) + '\n'
        write_private(destination, content)
    compose = json.loads(expand(compose_text))
    compose['name'] = project
    for entry in compose.get('services', {}).get('gateway', {}).get('ports', []):
        if isinstance(entry, dict) and int(entry.get('target', 0)) == 8080:
            entry['published'] = str(port)
    gateway = compose.get('services', {}).get('gateway', {})
    gateway.setdefault('environment', {})['HUB_PORT'] = str(port)
    # Resolve ordinary Compose substitutions here: a generated compose file must
    # work independently of where its caller's .env happens to be located.
    serialized = json.dumps(compose, ensure_ascii=False, indent=2)

    def substitute(match):
        key, default = match.group(1), match.group(2)
        value = values.get(key)
        if value is None or value == '':
            if default is None:
                raise ValueError('Missing environment setting: ' + key)
            value = default
        return json.dumps(value.replace('$', '$$'))[1:-1]

    serialized = re.sub(r'\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-(.*?))?\}', substitute, serialized)
    json.loads(serialized)
    write_private(RUNTIME / 'compose.yaml', serialized + '\n')
    spec = importlib.util.spec_from_file_location('local_synthetic_fixtures', KIT / 'synthetic-fixtures.py')
    fixtures = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fixtures)
    fixtures.create(config_dir)
    print('Prepared .local/compose.yaml and private local configuration. Existing passwords and database binding retained.')


if __name__ == '__main__':
    main()
