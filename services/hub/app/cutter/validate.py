import json, sys
from normalization import normalize_model_output

try:
    payload = json.load(sys.stdin)
    segments = normalize_model_output(payload['result'], payload['duration'])
    results = [{
        'time_range': s['时间范围'], 'scene_description': s['画面描述'],
        'script_text': s['脚本'], 'scene_text': s['场景'],
        'camera_angle': (s['镜头'] or {}).get('拍摄角度', ''),
        'shot_size': (s['镜头'] or {}).get('景别', ''),
        'camera_movement': (s['镜头'] or {}).get('运镜', ''),
        'expression_style': s['表达方式'],
    } for s in segments]
    print(json.dumps({'results': results}, ensure_ascii=False))
except Exception as error:
    print(json.dumps({'error': str(error)[:700]}, ensure_ascii=False))
    sys.exit(1)
