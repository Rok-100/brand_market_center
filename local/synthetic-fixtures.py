"""Generate small, labelled examples, never copies of personal or production data."""
import datetime as dt
import json


def create(directory):
    now = dt.datetime.now(dt.timezone(dt.timedelta(hours=8)))
    rows = []
    for day in range(90):
        date = now.date() - dt.timedelta(days=day)
        for member in range(2):
            rows.append({'id': str(day * 2 + member + 1), 'consumedAt': f'{date} 10:00:00.000000',
                'team_member': '模拟成员' + ('甲' if member == 0 else '乙'),
                'model_name': '模拟视频模型' if member == 0 else '模拟图像模型',
                'points': f'{1000 + day * 200 + member * 500}.0000'})
    snapshot = {'localSimulation': True, 'table': 'd_root_project_mid_db_brandmarketing.libtv_points_consumption',
        'capturedAt': now.isoformat(), 'historyStart': str(now.date() - dt.timedelta(days=150)) + ' 00:00:00',
        'latestConsumedAt': str(now.date()) + ' 10:00:00', 'rows': rows}
    (directory / 'libtv-points-snapshot.json').write_text(json.dumps(snapshot, ensure_ascii=False), encoding='utf-8')
    previous = (now.date().replace(day=1) - dt.timedelta(days=1)).strftime('%Y-%m')
    rooms = []
    for room in ['flagship', 'premium', 'select', 'beauty']:
        records = [{'record_id': f'local-{room}-{n}', 'fields': {'评价月份': previous,
            '直播助理': f'模拟助理{n}', '汇总得分': 95 - n * 3,
            '日期': int((now - dt.timedelta(days=2)).timestamp() * 1000)}} for n in range(1, 4)]
        rooms.append({'room': room, 'records': records})
    (directory / 'assistant-capture.json').write_text(json.dumps({'localSimulation': True,
        'checkedAt': now.isoformat(), 'rooms': rooms}, ensure_ascii=False), encoding='utf-8')
