"""Read-only production/return report. No collection, delivery or review writes."""
from collections import defaultdict, OrderedDict
from datetime import datetime, timedelta, time, timezone
from math import isfinite
import hashlib
import json
import time as clock
from threading import Lock, Thread

from fastapi import HTTPException
from sqlalchemy import select, or_, func
from sqlalchemy.orm import load_only

from .models import (Asset, AssetReviewSubmission,
                     QianchuanDelivery, QianchuanMetricDaily, AdqDelivery,
                     AdqMetricDaily, ChannelsDelivery, ChannelsMetricDaily,
                     VideoRequest, VideoRequestDelivery)

CHANNELS = {
    'qianchuan': {'name': '千川', 'gmv_label': '全域素材归因成交（ROI2口径）',
                  'source': '千川已核验计划素材日报；排除电商部达播账户'},
    'adq': {'name': '腾讯 ADQ', 'gmv_label': '广告归因订单金额',
            'source': '腾讯 ADQ 视频素材日报；成本及订单金额已转换为元'},
    'channels': {'name': '视频号', 'gmv_label': '视频号内容成交金额',
                 'source': '视频号已核验发布内容日报；分转换为元，不计为广告ROI'},
}
LIMIT = 25000
FACT_LIMIT = 200000
_cache = OrderedDict()
_cache_lock = Lock()
_generation_lock = Lock()
_jobs = {}
_jobs_lock = Lock()


def queued_report(session_factory, start, end, *, user_number, hold_ids, page=1, page_size=20, **filters):
    """One bounded background reader; each poll is authenticated by the route.

    No business writes or additional collectors. A visibility change gets a new
    key and can never reuse an earlier user's or held asset's report.
    """
    key = (str(user_number), start.isoformat(), end.isoformat(), tuple(sorted(hold_ids)),
           tuple(sorted(filters.items())))
    now = clock.monotonic()
    with _jobs_lock:
        for old_key, job in list(_jobs.items()):
            if job['state'] != 'running' and now - job['finished'] >= 180:
                del _jobs[old_key]
        job = _jobs.get(key)
        if job and job['state'] == 'complete':
            data = job['data']
            return {**data, 'items': data['items'][(page-1)*page_size:page*page_size],
                    'page': page, 'page_size': page_size}
        if job and job['state'] == 'failed':
            del _jobs[key]
            raise HTTPException(job['status'], job['detail'])
        if job is None:
            if any(value['state'] == 'running' for value in _jobs.values()):
                raise HTTPException(503, '投产报告生成通道正在使用，请稍后刷新', headers={'Retry-After': '10'})
            while len(_jobs) >= 4:
                del _jobs[next(iter(_jobs))]
            job = {'state': 'running', 'started': now}
            _jobs[key] = job
            def generate():
                try:
                    with session_factory() as db:
                        data = cached_report(db, start, end, user_number=user_number, hold_ids=hold_ids,
                                             page=1, page_size=LIMIT, **filters)
                    result = {'state': 'complete', 'data': data, 'finished': clock.monotonic()}
                except HTTPException as error:
                    result = {'state': 'failed', 'status': error.status_code, 'detail': error.detail,
                              'finished': clock.monotonic()}
                except Exception:
                    import logging
                    logging.getLogger(__name__).exception('Background production report failed')
                    result = {'state': 'failed', 'status': 503, 'detail': '报告暂时未能生成，请稍后重试；已有素材与报告未修改',
                              'finished': clock.monotonic()}
                with _jobs_lock:
                    _jobs[key] = result
            Thread(target=generate, name='production-report-reader', daemon=True).start()
        return {'report_state': 'generating', 'elapsed_seconds': round(now - job['started']),
                'message': '正在读取真实日报并生成报告；上传与推送可继续使用'}


def cached_report(db, start, end, *, user_number, hold_ids, page=1, page_size=20, **filters):
    """Bounded immutable snapshots prevent pagination/export rescanning facts.

    Authentication and recovery visibility are checked by the route on every
    request. Each user/visibility/filter set has its own snapshot. Never cache
    errors and never run multiple heavy reports against the shared database.
    """
    key = (str(user_number), start.isoformat(), end.isoformat(), tuple(sorted(hold_ids)),
           tuple(sorted(filters.items())))
    now = clock.monotonic()
    with _cache_lock:
        entry = _cache.get(key)
        if entry and now - entry[0] < 180:
            _cache.move_to_end(key)
            data = entry[1]
        else:
            data = None
    if data is None:
        if not _generation_lock.acquire(blocking=False):
            raise HTTPException(503, '另一个投产报告正在生成，请稍后刷新；日常上传与推送不受报告排队影响', headers={'Retry-After': '10'})
        try:
            data = build_report(db, start, end, asset_filters=[Asset.id.not_in(hold_ids)],
                                page=1, page_size=LIMIT, **filters)
            with _cache_lock:
                _cache[key] = (clock.monotonic(), data)
                _cache.move_to_end(key)
                while len(_cache) > 4:
                    _cache.popitem(last=False)
        finally:
            _generation_lock.release()
    return {**data, 'items': data['items'][(page-1)*page_size:page*page_size],
            'page': page, 'page_size': page_size, 'snapshot_max_age_seconds': 180}


def number(value):
    if isinstance(value, bool) or value is None:
        return None
    try:
        result = float(value)
        return result if isfinite(result) and result >= 0 else None
    except (TypeError, ValueError):
        return None


def stamp(value):
    return value.isoformat() + 'Z' if value else None


def amounts(channel, metrics):
    if channel == 'qianchuan':
        # Do not combine legacy general-plan values with native ROI2 values.
        if metrics.get('metric_scope') != 'uni_promotion_plan_material_roi2':
            return None, None
        gmv = number(metrics.get('total_pay_order_gmv_include_coupon_for_roi2'))
        if gmv is None:
            gmv = number(metrics.get('total_pay_order_gmv_for_roi2'))
        return number(metrics.get('stat_cost_for_roi2')), gmv
    if channel == 'adq':
        return number(metrics.get('cost_yuan')), number(metrics.get('order_amount_yuan'))
    return None, number(metrics.get('gmv_fen')) / 100 if number(metrics.get('gmv_fen')) is not None else None


def collapse(rows):
    """A platform daily fact is counted once, never once per local retry task.

    Ambiguous attribution to two local assets is omitted instead of assigning it
    twice. Latest corrected snapshot wins, even if it is lower than the old value.
    """
    owners, latest = defaultdict(set), {}
    invalid = 0
    for row in rows:
        key = (row['channel'], row['account'], row['target'], row['video'], row['day'])
        if not row['account'] or not row['video'] or (row['channel'] == 'qianchuan' and not row['target']):
            invalid += 1
            continue
        owners[key].add(row['asset_id'])
        previous = latest.get(key)
        if previous is None or (row['updated_at'] or datetime.min, row['row_id']) > (
                previous['updated_at'] or datetime.min, previous['row_id']):
            latest[key] = row
    ambiguous = {key for key, ids in owners.items() if len(ids) != 1}
    return [row for key, row in latest.items() if key not in ambiguous], len(ambiguous), invalid


def _bounded(db, statement):
    limit = FACT_LIMIT if statement.get_execution_options().get('report_daily_facts') else LIMIT
    rows = db.execute(statement.prefix_with('/*+ MAX_EXECUTION_TIME(8000) */', dialect='mysql').limit(limit + 1)).all()
    if len(rows) > limit:
        raise HTTPException(422, '数据量较大，请缩短日期后查询；未截断统计数据')
    return rows


def build_report(db, start, end, *, asset_filters, channel='all', dimension='product',
                 product='', creator='', tag='', q='', page=1, page_size=20):
    deadline = clock.monotonic() + 45
    def bounded(statement):
        if clock.monotonic() >= deadline:
            raise HTTPException(504, '报告读取超时，请缩短日期后重试')
        return _bounded(db, statement)
    offset = timedelta(hours=8)
    begin = datetime.combine(start, time.min) - offset
    finish = datetime.combine(end + timedelta(days=1), time.min) - offset
    start_text, end_text = start.isoformat(), end.isoformat()
    conditions = [*asset_filters, Asset.asset_scope == 'marketing_video', Asset.media_type == 'video',
                  Asset.deleted_at.is_(None), Asset.purged_at.is_(None),
                  ~Asset.filename.startswith('WIS-BENCHMARK-')]
    if product:
        conditions.append(Asset.category == product)
    if creator:
        conditions.append(Asset.uploaded_by_number == creator)
    if tag:
        # Exact JSON-array membership. No substring matches or LIKE wildcards.
        conditions.append(func.json_contains(Asset.tags, __import__('json').dumps(tag)))
    if q:
        conditions.append(Asset.filename.contains(q, autoescape=True))

    facts = []
    deliveries = []
    for name, delivery, metric in [('qianchuan', QianchuanDelivery, QianchuanMetricDaily),
                                    ('adq', AdqDelivery, AdqMetricDaily)]:
        if channel not in ('all', name):
            continue
        # Resolve the selected assets once below. Repeating a nested asset
        # predicate in each fact query forces expensive semijoins on the large
        # migrated catalog; date-scoped daily facts are already bounded.
        ds = [delivery.deleted_at.is_(None)]
        if name == 'qianchuan':
            ds.append(~delivery.advertiser_name.startswith('电商部达播'))
        deliveries.extend((name, row[0]) for row in bounded(select(delivery).options(load_only(
            delivery.id, delivery.asset_id, delivery.status)).where(
            *ds, delivery.created_at >= begin, delivery.created_at < finish)))
        checks = [metric.has_data == True]
        if name == 'qianchuan':
            checks.append(metric.link_verified == True)
        metric_fields = (['metric_scope', 'stat_cost_for_roi2', 'total_pay_order_gmv_include_coupon_for_roi2',
                          'total_pay_order_gmv_for_roi2'] if name == 'qianchuan' else ['cost_yuan', 'order_amount_yuan'])
        projected = func.json_object(*[value for key in metric_fields
            for value in (key, func.json_extract(metric.metrics, '$.' + key))]).label('report_metrics')
        # First scan the compact covering index. Joining every dated row to a
        # delivery and reading its LONGTEXT columns defeats the date index on
        # the migrated schema. Resolve task ownership once, then fetch only
        # matched daily primary keys in bounded batches.
        refs_statement = select(metric.id, metric.task_id).where(*checks,
            metric.stat_date >= start_text, metric.stat_date <= end_text)
        if name == 'qianchuan':
            refs_statement = refs_statement.with_hint(metric,
                'FORCE INDEX (wis_report_daily_date_state)', dialect_name='mysql')
        refs = bounded(refs_statement.execution_options(report_daily_facts=True))
        task_ids = list({r.task_id for r in refs})
        owners = {}
        for index in range(0, len(task_ids), 5000):
            ds_owner = [*ds, delivery.id.in_(task_ids[index:index+5000])]
            if name == 'adq':
                ds_owner.append(delivery.binding_verified_at.is_not(None))
            for task_id, asset_id in bounded(select(delivery.id, delivery.asset_id).where(*ds_owner)):
                owners[task_id] = asset_id
        daily_ids = [r.id for r in refs if r.task_id in owners]
        for index in range(0, len(daily_ids), 10000):
            statement = select(metric.task_id, metric.id, metric.updated_at, metric.stat_date,
            metric.advertiser_id if name == 'qianchuan' else metric.account_id,
            metric.plan_id if name == 'qianchuan' else metric.account_id,
            metric.video_id, projected).where(metric.id.in_(daily_ids[index:index+10000]), metric.status == 'success')
            for task_id, row_id, updated_at, day, account, target, video, projected_metrics in bounded(statement):
            # ADQ daily collector is account+video, not adgroup-specific. The
            # same video pushed to two adgroups must not duplicate its daily sum.
                facts.append({'channel': name, 'asset_id': owners[task_id],
                              'account': account, 'target': target if name == 'qianchuan' else '',
                              'video': video, 'day': day,
                              'metrics': json.loads(projected_metrics) if isinstance(projected_metrics, str) else projected_metrics or {},
                              'updated_at': updated_at, 'row_id': row_id})
    if channel in ('all', 'channels'):
        ds = [ChannelsDelivery.deleted_at.is_(None)]
        deliveries.extend(('channels', row[0]) for row in bounded(select(ChannelsDelivery).options(load_only(
            ChannelsDelivery.id, ChannelsDelivery.asset_id, ChannelsDelivery.status)).where(
            *ds, ChannelsDelivery.created_at >= begin, ChannelsDelivery.created_at < finish)))
        for d, m in bounded(select(ChannelsDelivery, ChannelsMetricDaily).join(
                ChannelsMetricDaily, ChannelsMetricDaily.delivery_id == ChannelsDelivery.id).where(
                *ds, ChannelsDelivery.platform_export_verified_at.is_not(None),
                ChannelsMetricDaily.data_date >= start_text, ChannelsMetricDaily.data_date <= end_text)):
            facts.append({'channel': 'channels', 'asset_id': d.asset_id, 'account': m.account_id,
                          'target': '', 'video': d.platform_content_id or d.platform_export_id,
                          'day': m.data_date, 'metrics': {'gmv_fen': m.gmv_fen},
                          'updated_at': m.collected_at, 'row_id': m.id})

    review_rows = bounded(select(AssetReviewSubmission).options(load_only(
        AssetReviewSubmission.asset_id, AssetReviewSubmission.version, AssetReviewSubmission.submitted_at,
        AssetReviewSubmission.status)).where(
        AssetReviewSubmission.submitted_at >= begin, AssetReviewSubmission.submitted_at < finish))
    active = {r['asset_id'] for r in facts} | {d.asset_id for _, d in deliveries} | {r[0].asset_id for r in review_rows}
    assets = [r[0] for r in bounded(select(Asset).options(load_only(Asset.id, Asset.filename, Asset.category,
        Asset.uploaded_by_name, Asset.uploaded_by_number, Asset.library_type, Asset.tags,
        Asset.modified_at, Asset.ingest_source)).where(*conditions, or_(
        (Asset.modified_at >= begin) & (Asset.modified_at < finish), Asset.id.in_(active))))]
    asset_map = {a.id: a for a in assets}
    # Check ownership before applying user-facing filters. Filtering out one
    # of two owners must not turn an ambiguous platform fact into attribution.
    deduped, ambiguous, invalid = collapse(facts)
    deduped = [r for r in deduped if r['asset_id'] in asset_map]
    deliveries = [(name, d) for name, d in deliveries if d.asset_id in asset_map]
    review_rows = [r for r in review_rows if r[0].asset_id in asset_map]
    # Only metadata required by the report is projected; no private storage URLs.
    tasks = defaultdict(list)
    for d, task in bounded(select(VideoRequestDelivery, VideoRequest).options(
            load_only(VideoRequestDelivery.asset_id), load_only(VideoRequest.id, VideoRequest.product)).join(
            VideoRequest, VideoRequestDelivery.request_id == VideoRequest.id).where(
            VideoRequestDelivery.asset_id.in_(asset_map))):
        tasks[d.asset_id].append({'id': task.id, 'product': task.product})

    channel_sums = {}
    day_keys = [(start + timedelta(days=i)).isoformat() for i in range((end-start).days+1)]
    trends = {day: {'date': day, 'output': 0, 'channels': {}} for day in day_keys}
    by_asset = defaultdict(lambda: defaultdict(list))
    for name, definition in CHANNELS.items():
        selected = [r for r in deduped if r['channel'] == name]
        pairs = [amounts(name, r['metrics']) for r in selected]
        spend_values = [cost for cost, _ in pairs if cost is not None]
        gmv_values = [gmv for _, gmv in pairs if gmv is not None]
        roi_pairs = [(cost, gmv) for cost, gmv in pairs if cost is not None and gmv is not None]
        roi_cost = sum(cost for cost, _ in roi_pairs)
        channel_sums[name] = {**definition, 'spend': round(sum(spend_values), 2) if spend_values else None,
                              'gmv': round(sum(gmv_values), 2) if gmv_values else None,
                              'roi': round(sum(gmv for _, gmv in roi_pairs)/roi_cost, 4) if roi_cost > 0 else None,
                              'rows': len(selected), 'spend_rows': len(spend_values), 'gmv_rows': len(gmv_values),
                              'roi_rows': len(roi_pairs), 'assets': len({r['asset_id'] for r in selected}),
                              'latest_at': stamp(max((r['updated_at'] for r in selected if r['updated_at']), default=None))}
        for row, pair in zip(selected, pairs):
            by_asset[row['asset_id']][name].append(pair)
            daily = trends[row['day']]['channels'].setdefault(name, {'spend': None, 'gmv': None})
            for field, value in zip(('spend', 'gmv'), pair):
                if value is not None:
                    daily[field] = round((daily[field] or 0) + value, 2)

    review_map = defaultdict(list)
    for r, in review_rows:
        review_map[r.asset_id].append(r)
    delivery_map = defaultdict(list)
    for name, d in deliveries:
        delivery_map[d.asset_id].append({'channel': name, 'status': d.status, 'id': d.id})
    details, groups = [], {}
    for asset in assets:
        produced = asset.ingest_source in ('oa_upload', 'workstation_return') and begin <= asset.modified_at < finish
        if produced:
            trends[(asset.modified_at + offset).date().isoformat()]['output'] += 1
        submissions = review_map[asset.id]
        latest_review = max(submissions, key=lambda s: (s.version, s.submitted_at), default=None)
        passed = bool(latest_review and latest_review.status in ('passed', 'approved'))
        ds = delivery_map[asset.id]
        sent = any(d['status'] in ('success', 'published') for d in ds)
        values = {}
        for name, pairs in by_asset[asset.id].items():
            cost = [p[0] for p in pairs if p[0] is not None]
            gmv = [p[1] for p in pairs if p[1] is not None]
            roi_pairs = [p for p in pairs if p[0] is not None and p[1] is not None]
            denominator = sum(p[0] for p in roi_pairs)
            values[name] = {'spend': round(sum(cost), 2) if cost else None,
                            'gmv': round(sum(gmv), 2) if gmv else None,
                            'roi': round(sum(p[1] for p in roi_pairs)/denominator, 4) if denominator > 0 else None}
        item = {'id': asset.id, 'filename': asset.filename, 'product': asset.category or '未分类',
                'creator': asset.uploaded_by_name or '未识别上传人', 'creator_number': asset.uploaded_by_number,
                'library_type': asset.library_type, 'tags': asset.tags or [], 'tasks': tasks[asset.id],
                'produced': produced, 'reviewed': bool(submissions), 'passed': passed,
                'delivered': sent, 'delivery_tasks': ds, 'channels': values}
        details.append(item)
        keys = ([asset.category or '未分类'] if dimension == 'product' else
                [asset.uploaded_by_number or '未识别上传人'] if dimension == 'creator' else
                asset.tags or ['无标签'] if dimension == 'tag' else
                [t['id'] for t in tasks[asset.id]] or ['未关联提需'] if dimension == 'task' else
                list(set(values) | {d['channel'] for d in ds}) or ['未推送 / 待回流'] if dimension == 'channel' else [str(asset.id)])
        for key in set(keys):
            group = groups.setdefault(key, {'key': key, 'label': item['creator'] if dimension == 'creator' else CHANNELS.get(key, {}).get('name', key) if dimension == 'channel' else key,
                                           'assets': 0, 'output': 0, 'reviewed': 0, 'passed': 0, 'delivered': 0,
                                           'returned': 0, 'channels': {}})
            group['assets'] += 1
            for field, value in [('output', produced), ('reviewed', bool(submissions)), ('passed', passed),
                                 ('delivered', sent), ('returned', bool(values))]:
                group[field] += int(value)
            for name, vals in values.items():
                if dimension == 'channel' and key != name:
                    continue
                dest = group['channels'].setdefault(name, {'spend': None, 'gmv': None})
                for field in ('spend', 'gmv'):
                    if vals[field] is not None:
                        dest[field] = round((dest[field] or 0) + vals[field], 2)
    details.sort(key=lambda x: (-sum(v['spend'] or 0 for v in x['channels'].values()), -x['id']))
    output = sum(d['produced'] for d in details)
    return {'range': {'start_date': start_text, 'end_date': end_text}, 'channel': channel, 'dimension': dimension,
            'generated_at': stamp(datetime.now(timezone.utc).replace(tzinfo=None)),
            'snapshot_id': hashlib.sha256(json.dumps(details, sort_keys=True, ensure_ascii=False).encode()).hexdigest(),
            'summary': {'assets': len(details), 'output': output,
                        'source': sum(d['produced'] and d['library_type'] != 'remix' for d in details),
                        'remix': sum(d['produced'] and d['library_type'] == 'remix' for d in details),
                        'reviewed': sum(d['reviewed'] for d in details), 'passed': sum(d['passed'] for d in details),
                        'delivered': sum(d['delivered'] for d in details), 'returned': len({r['asset_id'] for r in deduped}),
                        'delivery_tasks': len(deliveries)},
            'channels': channel_sums, 'daily': list(trends.values()),
            'groups': sorted(groups.values(), key=lambda r: (-r['output'], -r['assets'], r['label'])),
            'items': details[(page-1)*page_size:page*page_size], 'total': len(details), 'page': page, 'page_size': page_size,
            'coverage': {'daily_rows': len(deduped), 'ambiguous_rows': ambiguous, 'invalid_rows': invalid,
                         'quality_score': None, 'quality_message': '尚无统一质量评分口径；审核通过不等于素材有效',
                         'notes': ['产出以所选日期内原文件完成入库时间计；回流包含历史素材在所选日期的表现。',
                                   '上传人代表素材入库贡献，不代表销售额个人归属；成本仅含平台消耗，不代表制作总成本。',
                                   '不同渠道成交口径独立展示，不合并成部门GMV；ROI仅计算同一渠道同时具有成本与金额的日报行。',
                                   '标签和提需可多选，分组有重叠，不可相加；无回流及未核验数据不补0。',
                                   '审核按周期内提交的版本；推送按周期内创建的任务，成功素材去重，不表示广告已起量。']}}
