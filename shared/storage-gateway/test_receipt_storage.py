import base64
import copy
import hashlib
import json
import os
import unittest
import uuid
import zlib
from receipt_storage import MARKER, ReceiptResultExpired, decode_receipt, encode_receipt, envelope


class ReceiptStorageTests(unittest.TestCase):
    def setUp(self):
        self.scope = 'remix_files'
        self.identity = str(uuid.uuid4())
        self.fingerprint = 'a' * 64
        self.response = {'clips': [{'id': str(i), 'name': '完整画面 中文😀', 'tags': ['黑晶面膜', '已完成']} for i in range(6000)],
                         'approved': True, 'missing': None, 'duration': 90.01}

    def encode(self, value=None, **options):
        return encode_receipt(value if value is not None else self.response, self.scope, self.identity,
                              self.fingerprint, project='FD-026222', **options)

    def decode(self, value):
        return decode_receipt(value, self.scope, self.identity, self.fingerprint)

    def test_large_result_roundtrips_and_reduces_storage(self):
        saved = self.encode()
        self.assertEqual(self.decode(saved), self.response)
        self.assertLess(len(saved.encode()), len(json.dumps(self.response).encode()) / 10)
        self.assertEqual(envelope(json.loads(saved))['committed'], True)

    def test_legacy_and_small_results_remain_compatible(self):
        for value in [{'version': 4709, 'sha256': 'b' * 64}, [1, '中文'], False, None]:
            self.assertEqual(decode_receipt(json.dumps(value), self.scope, self.identity), value)
        saved = self.encode({'version': 4710})
        self.assertIsNone(envelope(json.loads(saved)))

    def test_compression_disabled_keeps_old_result_format_but_reader_supports_new(self):
        self.assertEqual(self.decode(self.encode(compression=False)), self.response)
        self.assertEqual(self.decode(self.encode(compression=True)), self.response)

    def test_incompressible_response_is_not_expanded_by_base64(self):
        value = {'random': base64.b64encode(os.urandom(160000)).decode()}
        saved = self.encode(value)
        self.assertEqual(envelope(json.loads(saved))['codec'], 'json')
        self.assertEqual(self.decode(saved), value)
        self.assertLess(len(saved), len(json.dumps(value)) + 1000)

    def test_identity_and_fingerprint_are_verified_before_replay(self):
        saved = self.encode()
        with self.assertRaises(ValueError):
            decode_receipt(saved, 'another_scope', self.identity, self.fingerprint)
        with self.assertRaises(ValueError):
            decode_receipt(saved, self.scope, str(uuid.uuid4()), self.fingerprint)
        with self.assertRaises(ValueError):
            decode_receipt(saved, self.scope, self.identity, 'c' * 64)

    def test_tampered_result_is_rejected(self):
        value = json.loads(self.encode())
        value[MARKER]['sha256'] = '0' * 64
        with self.assertRaisesRegex(ValueError, 'verification'):
            self.decode(value)

    def test_truncated_or_concatenated_compression_is_rejected(self):
        original = json.loads(self.encode())
        compressed = base64.b64decode(original[MARKER]['content'])
        for replacement in [compressed[:-5], compressed + zlib.compress(b'{}')]:
            changed = copy.deepcopy(original)
            changed[MARKER]['content'] = base64.b64encode(replacement).decode()
            with self.assertRaises(ValueError):
                self.decode(changed)

    def test_decompression_is_bounded_by_original_bytes(self):
        value = json.loads(self.encode())
        value[MARKER]['original_bytes'] = 8
        with self.assertRaises(ValueError):
            self.decode(value)

    def test_expired_result_retains_committed_proof_and_refuses_execution(self):
        value = json.loads(self.encode())
        record = value[MARKER]
        record['expired'] = True
        record.pop('content', None)
        with self.assertRaises(ReceiptResultExpired) as caught:
            self.decode(value)
        self.assertEqual(caught.exception.request_id, self.identity)
        self.assertTrue(record['committed'])
        self.assertEqual(record['fingerprint'], self.fingerprint)
        self.assertEqual(record['sha256'], hashlib.sha256(json.dumps(self.response, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest())


if __name__ == '__main__':
    unittest.main()
