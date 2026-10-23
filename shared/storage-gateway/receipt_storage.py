"""Lossless write receipts; an expired payload never permits a second write."""
import base64
import hashlib
import json
import os
import zlib

MARKER = '__pinying_write_receipt_v1__'
PRODUCER = 'wis-storage-growth-20261007-r1'
MAX_RESPONSE_BYTES = 256 * 1024 * 1024
LARGE_RESPONSE_BYTES = 64 * 1024


class ReceiptResultExpired(ValueError):
    def __init__(self, request_id):
        super().__init__('此请求已提交，原结果载荷已过保留期；请读取当前业务结果，勿重复提交。')
        self.request_id = request_id


def envelope(value):
    if not isinstance(value, dict) or set(value) != {MARKER}:
        return None
    record = value[MARKER]
    if not isinstance(record, dict) or record.get('version') != 1 or record.get('producer') != PRODUCER:
        return None
    return record


def encode_receipt(response, scope, request_id, fingerprint, project=None, compression=None, operation=None):
    """Keep existing small/legacy receipt semantics; compress large new results."""
    project = project if project is not None else os.environ.get('PINYING_STORAGE_PROJECT', '')
    enabled = compression if compression is not None else os.environ.get('PINYING_RECEIPT_COMPRESSION_ENABLED', 'true') == 'true'
    raw = json.dumps(response, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf8')
    if len(raw) > MAX_RESPONSE_BYTES:
        raise ValueError('Write result exceeds the supported recoverable receipt size')
    if not project or not enabled or len(raw) <= LARGE_RESPONSE_BYTES:
        return json.dumps(response, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
    compressed = zlib.compress(raw, 1)
    # Incompressible responses stay exact without base64 expansion.
    record = {'version': 1, 'producer': PRODUCER, 'project': project, 'scope': scope,
              'request_id': request_id, 'fingerprint': fingerprint, 'committed': True,
              'sha256': hashlib.sha256(raw).hexdigest(), 'original_bytes': len(raw),
              'operation': str(operation or 'write')[:100], 'expired': False}
    if len(compressed) * 4 / 3 < len(raw) * 0.9:
        record.update(codec='zlib-base64', content=base64.b64encode(compressed).decode('ascii'))
    else:
        record.update(codec='json', data=response)
    return json.dumps({MARKER: record}, ensure_ascii=False, separators=(',', ':'), allow_nan=False)


def decode_receipt(stored, scope, request_id, fingerprint=None):
    value = json.loads(stored) if isinstance(stored, (str, bytes)) else stored
    record = envelope(value)
    if record is None:
        return value
    if record.get('scope') != scope or record.get('request_id') != request_id or record.get('committed') is not True:
        raise ValueError('Write receipt identity verification failed')
    if fingerprint is not None and record.get('fingerprint') != fingerprint:
        raise ValueError('Request ID reused with different contents')
    if record.get('expired') is True:
        raise ReceiptResultExpired(request_id)
    size = record.get('original_bytes')
    if type(size) is not int or not 0 < size <= MAX_RESPONSE_BYTES:
        raise ValueError('Write receipt size is invalid')
    if record.get('codec') == 'zlib-base64':
        compressed = base64.b64decode(record['content'], validate=True)
        decoder = zlib.decompressobj()
        raw = decoder.decompress(compressed, size + 1)
        if not decoder.eof or decoder.unused_data or decoder.unconsumed_tail or len(raw) != size:
            raise ValueError('Write receipt compression integrity failed')
        response = json.loads(raw)
    elif record.get('codec') == 'json':
        response = record['data']
        raw = json.dumps(response, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf8')
    else:
        raise ValueError('Unknown write receipt encoding')
    if len(raw) != size or hashlib.sha256(raw).hexdigest() != record.get('sha256'):
        raise ValueError('Write receipt content verification failed')
    return response
