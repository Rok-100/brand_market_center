"""Compatible asset traceability and timecoded notes, using existing metadata."""
import json
from datetime import datetime
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from fastapi import HTTPException
from .models import (AppMeta, AssetReviewSubmission, VideoRequestDelivery,
                     WorkstationReturn, QianchuanDelivery, AdqDelivery, ChannelsDelivery)


def read_notes(db, asset_id):
    value = db.get(AppMeta, f'asset.timecode-notes.v1:{asset_id}')
    if not value:
        return {'revision': 0, 'items': []}
    try:
        record = json.loads(value.value)
        if (not isinstance(record, dict) or type(record.get('revision')) is not int
                or record['revision'] < 0 or not isinstance(record.get('items'), list)
                or any(not isinstance(item, dict) or not all(key in item for key in
                    ('id', 'actor_number', 'text', 'time_ms', 'etag', 'created_at'))
                    for item in record['items'])):
            raise ValueError()
        return record
    except (ValueError, TypeError):
        # Corrupt history is never overwritten or quietly treated as empty.
        raise HTTPException(409, '历史备注暂无法读取，请联系管理员核验；不会覆盖原记录')


def append_note(db, asset, payload, user_number, user_name):
    key = f'asset.timecode-notes.v1:{asset.id}'
    row = db.get(AppMeta, key)
    state = read_notes(db, asset.id)
    previous = next((n for n in state['items'] if n['id'] == payload.client_request_id), None)
    if previous:
        if (previous['actor_number'] != user_number or previous['text'] != payload.text.strip()
                or previous['time_ms'] != payload.time_ms):
            raise HTTPException(409, '该备注请求标识已用于其他内容')
        return {**state, 'replayed': True}
    if state['revision'] != payload.expected_revision:
        raise HTTPException(409, '其他人已更新备注，请刷新后再保存；当前输入已保留')
    if len(state['items']) >= 40:
        raise HTTPException(422, '单份素材最多保存40条时间点备注；历史记录已保留')
    item = {'id': payload.client_request_id, 'text': payload.text.strip(), 'time_ms': payload.time_ms,
            'actor_number': user_number, 'actor_name': user_name,
            'etag': asset.etag or '', 'created_at': datetime.utcnow().isoformat()+'Z'}
    updated = {'revision': state['revision']+1, 'items': [*state['items'], item]}
    encoded = json.dumps(updated, ensure_ascii=False)
    if len(encoded.encode('utf8')) > 48000:
        raise HTTPException(422, '备注记录已达到容量上限；历史记录已保留')
    if row:
        original = row.value
        result = db.execute(update(AppMeta).where(AppMeta.key == key, AppMeta.value == original).values(value=encoded))
        if result.rowcount != 1:
            db.rollback()
            raise HTTPException(409, '备注已被更新，请刷新后再保存')
    else:
        db.add(AppMeta(key=key, value=encoded))
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, '其他人已保存备注，请刷新后再保存')
    return updated


def context(db, asset):
    reviews = [{'id': r.id, 'version': r.version, 'status': r.status,
                'filename': r.filename_snapshot,
                'submitted_at': r.submitted_at.isoformat()+'Z' if r.submitted_at else None}
               for r in db.scalars(select(AssetReviewSubmission).where(
                   AssetReviewSubmission.asset_id == asset.id).order_by(AssetReviewSubmission.version.desc()).limit(30))]
    task_versions = [{'task_id': r.request_id, 'version': r.version, 'asset_id': r.asset_id,
                      'created_at': r.created_at.isoformat()+'Z'}
                     for r in db.scalars(select(VideoRequestDelivery).where(
                         VideoRequestDelivery.asset_id == asset.id).order_by(VideoRequestDelivery.created_at.desc()).limit(30))]
    pushes = []
    for name, model in [('千川', QianchuanDelivery), ('腾讯 ADQ', AdqDelivery), ('视频号', ChannelsDelivery)]:
        pushes.extend({'channel': name, 'id': d.id, 'status': d.status,
                       'created_at': d.created_at.isoformat()+'Z'}
                      for d in db.scalars(select(model).where(model.asset_id == asset.id,
                         model.deleted_at.is_(None)).order_by(model.created_at.desc()).limit(20)))
    returns = []
    for r in db.scalars(select(WorkstationReturn).where(WorkstationReturn.asset_id == asset.id).limit(10)):
        provenance = r.provenance or {}
        # Do not expose auth/configuration, signed URLs or arbitrary raw JSON.
        returns.append({'status': r.status, 'sha256': r.sha256,
                        'workstation_type': str(provenance.get('workstation_type') or '')[:80],
                        'remix_task_id': str(provenance.get('remix_task_id') or '')[:120],
                        'completed_at': r.completed_at.isoformat()+'Z' if r.completed_at else None})
    return {'asset_id': asset.id, 'etag': asset.etag, 'reviews': reviews, 'task_versions': task_versions,
            'pushes': sorted(pushes, key=lambda d: d['created_at'], reverse=True), 'returns': returns,
            'notes': read_notes(db, asset.id), 'history_note': '审核版本与提需交付版本分别保留；不代表原视频文件被替换。'}
