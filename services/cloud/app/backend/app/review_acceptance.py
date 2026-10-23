"""Local read-only acceptance scenarios; real list SQL/serialization, isolated SQLite.
No production connection, worker registration or mutation endpoint uses this database.
"""
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from .database import Base
from . import models, company_audit

@contextmanager
def acceptance_database(live_db):
    sample = live_db.scalar(select(models.Asset).where(models.Asset.media_type == 'video',
        models.Asset.deleted_at.is_(None), models.Asset.purged_at.is_(None)).order_by(models.Asset.id))
    engine = create_engine('sqlite://')
    Base.metadata.create_all(engine)
    try:
        with Session(engine) as db:
            now = datetime.now(timezone(timedelta(hours=8))).replace(tzinfo=None, hour=10, minute=0, second=0, microsecond=0) - timedelta(hours=8)
            asset = models.Asset(id=sample.id if sample else 1,
                object_key=sample.object_key if sample else 'acceptance/no-video.mp4',
                filename='验收示例视频.mp4', media_type='video', size=sample.size if sample else 0,
                etag=sample.etag if sample else '', category=sample.category if sample else '验收产品',
                asset_scope='marketing_video', library_type='remix')
            db.add(asset)
            db.add(models.ReviewWorkflowConfig(id=1, enabled=True, naming_enabled=False,
                ai_redline_enabled=False, required_roles=['team_lead']))
            db.add(models.AppMeta(key=company_audit.CONTROL_KEY, value='{"enabled":true}'))
            # title, company state/verdict, human state, submitted days ago, issue
            scenarios = [
                ('等待送审', 'queued', 'unknown', None, 0, ''),
                ('公司审核中', 'processing', 'unknown', None, 0, ''),
                ('公司通过', 'success', 'pass', None, 0, ''),
                ('疑似违规待复核', 'success', 'manual_required', 'pending', 0, '画面存在轻微水印，需人工确认授权'),
                ('疑似违规复核通过', 'success', 'manual_required', 'approved', 1, '可能存在敏感表达，已补充人工复核说明'),
                ('违规复核不通过', 'success', 'reject', 'rejected', 1, '标题涉及夸大宣传'),
                ('公司通过人工不通过', 'success', 'pass', 'rejected', 2, '未命中违规问题'),
                ('公司不通过待复核', 'success', 'reject', 'pending', 2, '存在未确认的品牌授权画面'),
                ('审核服务异常', 'failed', 'unknown', None, 7, '审核服务暂时异常，等待处理'),
                ('公司与人工均通过', 'success', 'pass', 'approved', 7, ''),
            ]
            for index, (title, state, verdict, human, days, issue) in enumerate(scenarios, 1):
                at = now - timedelta(days=days, minutes=index)
                sid = f'acceptance-review-{index:02d}'
                status = 'rejected' if human == 'rejected' else 'approved' if human == 'approved' or verdict == 'pass' and human is None else 'pending'
                db.add(models.AssetReviewSubmission(id=sid, asset_id=asset.id, version=index, status=status,
                    submitted_by_name='产品验收员', submitted_by_number='ACCEPTANCE-ONLY',
                    filename_snapshot=f'【验收示例】{index:02d}-{title}.mp4',
                    route_center='本地验收', route_group='审核展示组', submitted_at=at,
                    completed_at=at+timedelta(minutes=3) if human in ('approved','rejected') else None,
                    note='仅供产品验收：使用本地视频展示，审核结论为隔离场景数据，不代表真实公司审核结果。'))
                if human:
                    db.add(models.AssetReviewDecision(submission_id=sid, role_code='team_lead', status=human,
                        reviewer_name='验收复核员' if human != 'pending' else '',
                        candidate_reviewers=[{'user_name':'验收复核员','user_number':'ACCEPTANCE-ONLY','center':'本地验收','group_name':'审核展示组'}],
                        note='已核对画面和授权，复核通过。' if human == 'approved' else '问题成立，请修改后重新提交。' if human == 'rejected' else '',
                        quality_total=85 if human == 'approved' else 45 if human == 'rejected' else None,
                        decided_at=at+timedelta(minutes=3) if human != 'pending' else None))
                findings = [{'rule_code':'acceptance-rule','rule_name':'授权与宣传规范','tier':'red' if verdict == 'reject' else 'yellow',
                    'evidence':issue,'time_start_ms':1000,'time_end_ms':2000}] if verdict in ('reject','manual_required') else []
                task_id = f'acceptance-task-{index:02d}' if state != 'queued' else None
                if task_id:
                    db.add(company_audit.CompanyAuditRemoteTask(task_id=task_id, status=state, verdict=verdict,
                        ready=state=='success', requested_revision=1, verified_revision=1, result_revision=1,
                        raw_result={'summary': issue or ('未命中违规问题' if verdict=='pass' else '等待公司审核结论'), 'findings':findings},
                        last_verified_at=at+timedelta(minutes=2) if state=='success' else None,
                        created_at=at, updated_at=at+timedelta(minutes=2)))
                db.add(company_audit.CompanyAuditJob(id=f'acceptance-job-{index:02d}', submission_id=sid,
                    asset_id=asset.id, version=index, task_id=task_id, status=state,
                    object_key_snapshot=asset.object_key, size_snapshot=asset.size, etag_snapshot=asset.etag,
                    category_snapshot=asset.category, product_id='ACCEPTANCE-PRODUCT', channel='抖音',
                    video_url='https://example.invalid/acceptance-only', created_at=at, updated_at=at))
            db.commit()
            yield db
    finally:
        engine.dispose()
