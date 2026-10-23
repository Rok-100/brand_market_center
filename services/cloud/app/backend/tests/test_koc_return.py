import ast
import pathlib
import types
import unittest
from datetime import datetime
from app.schemas import WorkstationReturnCreate, WorkstationReturnComplete, UploadComplete
from app.workstation_return_profile import workstation_return_profile

class KocReturnTest(unittest.TestCase):
    def payload(self, **kwargs):
        return dict(idempotency_key="fixture-return", filename="complete.mp4", size=100, sha256="a"*64, render_id="job-koc", variant_id="final", maker_id="FD-TEST", maker_name="制作人", review_status="approved", **kwargs)

    def test_remix_contract_remains_approved(self):
        data = self.payload()
        self.assertEqual(WorkstationReturnCreate(**data).workstation_type, "remix")
        data["review_status"] = "pending"
        with self.assertRaises(ValueError): WorkstationReturnCreate(**data)

    def test_koc_is_pending_and_cannot_claim_automatic_content_approval(self):
        data = self.payload(workstation_type="koc")
        data["review_status"] = "pending"
        self.assertEqual(WorkstationReturnCreate(**data).workstation_type, "koc")
        data["automatic_review_enabled"] = True
        with self.assertRaises(ValueError): WorkstationReturnCreate(**data)
        data["automatic_review_enabled"] = False
        data["maker_id"] = ""
        with self.assertRaises(ValueError): WorkstationReturnCreate(**data)

    def test_real_completion_registers_source_video_and_preserves_creator(self):
        source = pathlib.Path("app/main.py").read_text()
        tree = ast.parse(source)
        function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "workstation_return_complete")
        function.decorator_list = []
        record = types.SimpleNamespace(status="pending", file_size=100, object_key="yxb/uploads/final.mp4", filename="complete.mp4", provenance={**self.payload(workstation_type="koc"), "review_status":"pending", "source_url":"https://example.com/koc?task=job-koc"}, asset_id=None)
        asset = types.SimpleNamespace(id=123)
        ReturnType = type("Return", (), {})
        AssetType = type("Asset", (), {})
        calls = []
        reviews = []
        def complete(upload, actor, db, **kwargs):
            calls.append((upload, actor, kwargs))
            return asset
        namespace = {"__name__":"app.main", "__package__":"app", "WorkstationReturnComplete":WorkstationReturnComplete, "Session":object,
            "Depends":lambda f: None, "get_db":lambda: None, "require_workstation":lambda: None,
            "WorkstationReturn":ReturnType, "Asset":AssetType, "UploadComplete":UploadComplete,
            "datetime":datetime, "oss_service":types.SimpleNamespace(head_asset=lambda key:{"size":100}),
            "_complete_upload_for_user":complete, "_register_workstation_automatic_review":lambda *args,**kwargs:reviews.append(True),
            "_audit_asset":lambda *args,**kwargs:None, "_workstation_return_payload":lambda record,db:{"asset_id":record.asset_id,"status":record.status}}
        namespace["_invalidate_catalog_cache"] = lambda: None
        exec(compile(ast.Module(body=[function],type_ignores=[]),"workstation-completion","exec"),namespace)
        db = types.SimpleNamespace(get=lambda model,key:record if model is ReturnType else asset, commit=lambda:None)
        payload = WorkstationReturnComplete(idempotency_key="fixture-return")
        result = namespace["workstation_return_complete"](payload, db, {})
        self.assertEqual(result["asset_id"],123)
        upload,actor,kwargs = calls[0]
        self.assertEqual(upload.library_type,"source")
        self.assertEqual(upload.folder_name,"AI KOC")
        self.assertEqual(upload.asset_subtype,"AI原创素材")
        self.assertEqual(actor["number"],"FD-TEST")
        self.assertEqual(kwargs["source"],"ai_koc_workstation")
        self.assertNotIn("审核通过",upload.tags)
        self.assertFalse(reviews)
        namespace["workstation_return_complete"](payload,db,{})
        self.assertEqual(len(calls),1)

    def test_previous_version_must_belong_to_the_same_creator_and_task(self):
        from app.koc_versioning import koc_previous_asset, archive_koc_previous
        previous = types.SimpleNamespace(id=99, purged_at=None, source="ai_koc_workstation", uploaded_by_number="FD-TEST", reference_url="https://example.com/koc?task=fixture", folder_name="AI KOC", status="待整理", tags=[])
        db = types.SimpleNamespace(get=lambda model,key:previous)
        data = {"workstation_type":"koc", "supersedes_asset_id":99, "maker_id":"FD-TEST", "source_url":previous.reference_url}
        self.assertIs(koc_previous_asset(data,db),previous)
        for changed in [{"maker_id":"FD-OTHER"}, {"source_url":"https://example.com/koc?task=another"}]:
            with self.assertRaises(Exception): koc_previous_asset({**data,**changed},db)
        audit=[]
        archive_koc_previous(previous,types.SimpleNamespace(id=123),{"number":"FD-TEST","realName":"制作人"},db,lambda *args,**kwargs:audit.append(True))
        self.assertEqual(previous.folder_name,"AI KOC历史版本")
        self.assertEqual(previous.status,"已替换")
        self.assertTrue(audit)

if __name__ == "__main__": unittest.main()
