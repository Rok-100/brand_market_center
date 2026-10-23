import os
os.environ['DATABASE_URL'] = 'sqlite:///:memory:'
import unittest
from unittest.mock import patch
from app.auth import user_allowed
from app.database import Base, SessionLocal, engine
from app.models import OaAccessGrant


class DirectorySyncTests(unittest.TestCase):
    def setUp(self):
        Base.metadata.create_all(engine)
        with SessionLocal() as db:
            db.query(OaAccessGrant).delete()
            db.add(OaAccessGrant(identifier='number:FD-TEST-001', identifier_type='number',
                               user_number='FD-TEST-001', real_name='验收人员',
                               department='', center='', active=True))
            db.commit()
        self.policy = patch.dict(os.environ, {'OA_ENFORCE_DEPARTMENT':'true',
            'OA_ALLOWED_DEPARTMENTS':'品牌营销,品牌管理部-WIS品牌中心', 'OA_ALLOWED_USERS':''})
        self.policy.start()
        self.addCleanup(self.policy.stop)

    def user(self, **fields):
        return dict(number='FD-TEST-001', realName='验收人员', status='normal',
                    parentDept='品牌营销部', groupName='AI营销中心', **fields)

    def test_existing_active_grant_metadata_is_filled_by_department_login(self):
        self.assertTrue(user_allowed(self.user()))
        with SessionLocal() as db:
            row = db.get(OaAccessGrant, 'number:FD-TEST-001')
            self.assertEqual((row.department, row.center), ('品牌营销部', 'AI营销中心'))
            self.assertTrue(row.active)
            self.assertEqual(db.query(OaAccessGrant).count(), 1)

    def test_frozen_user_neither_admitted_nor_enriched(self):
        user = self.user(); user['status'] = 'freeze'
        self.assertFalse(user_allowed(user))
        with SessionLocal() as db:
            self.assertEqual(db.get(OaAccessGrant, 'number:FD-TEST-001').department, '')

    def test_stale_inactive_exception_is_not_reactivated(self):
        with SessionLocal() as db:
            row = db.get(OaAccessGrant, 'number:FD-TEST-001'); row.active = False; db.commit()
        self.assertTrue(user_allowed(self.user()))
        with SessionLocal() as db:
            row = db.get(OaAccessGrant, 'number:FD-TEST-001')
            self.assertFalse(row.active)
            self.assertEqual(row.department, '')

    def test_department_login_does_not_create_grant_or_admit_unknown_department(self):
        user = self.user(); user['number'] = 'FD-TEST-002'; user['realName'] = '另一人员'
        self.assertTrue(user_allowed(user))
        user['parentDept'] = '其他部门'; user['groupName'] = '其他中心'
        self.assertFalse(user_allowed(user))
        with SessionLocal() as db:
            self.assertEqual(db.query(OaAccessGrant).count(), 1)

if __name__ == '__main__':
    unittest.main()
