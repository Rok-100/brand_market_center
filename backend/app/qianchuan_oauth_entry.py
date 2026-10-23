"""Keep Qianchuan authorization on its existing official business entry."""
from urllib.parse import urlsplit, urlunsplit

AUTHORIZE_URL = 'https://qianchuan.jinritemai.com/openapi/qc/audit/oauth.html'
LEGACY_ENTRIES = {
    ('ad.oceanengine.com', '/openapi/audit/oauth.html'),
    ('open.oceanengine.com', '/audit/oauth.html'),
}


def authorization_entry(configured_url=''):
    raw = (configured_url or '').strip() or AUTHORIZE_URL
    parsed = urlsplit(raw)
    if (parsed.scheme != 'https' or parsed.username or parsed.password
            or parsed.port not in (None, 443) or parsed.fragment):
        raise ValueError('千川授权入口配置无效：必须使用官方 HTTPS 授权页')
    identity = (parsed.hostname, parsed.path)
    official = urlsplit(AUTHORIZE_URL)
    if identity not in LEGACY_ENTRIES | {(official.hostname, official.path)}:
        raise ValueError('千川授权入口不属于已核验的官方业务页面')
    # Keep scope/material_auth exactly as configured. No extra account or
    # material permission is added while repairing the wrong business host.
    return urlunsplit((official.scheme, official.netloc, official.path, parsed.query, ''))
