# Extracted from supplied IdearRadar package; no Ark credentials or provider imports.
import math, logging
logger=logging.getLogger(__name__)

SEGMENT_BOUNDARY_TOLERANCE_SECONDS = 0.25

SEGMENT_EDGE_TOLERANCE_SECONDS = 0.75

MIN_SEGMENT_DURATION_SECONDS = 0.2

MAX_SEGMENT_COUNT = 100

VIDEO_SEGMENT_PROMPT = """
你将看到一段营销视频，以及可选的 ASR 识别结果。
请按照“语义完整 + 画面完整 + 镜头切换合理”的原则，把整条视频切分成多个可复用片段。

你的目标不是摘要，而是输出“可直接用于物理切分”的片段清单。

输出要求：
1. 每个片段必须包含以下字段：
   - 时间范围
   - 画面描述
   - 脚本
   - 场景
   - 镜头
   - 表达方式
2. 时间范围格式必须严格为：
   mm:ss.SSS-mm:ss.SSS
3. 各片段要首尾连续、语义完整，不要重叠。
4. 切分时要优先保证一个片段内部语义一致、画面阶段一致。
5. 如果画面已经明显切换，即使 ASR 句子还没结束，也要优先考虑在画面边界切开。
6. 只输出 JSON，不要输出解释、前后缀、markdown。

JSON 格式如下：
{
  "output": [
    {
      "时间范围": "00:00.000-00:03.500",
      "画面描述": "示例画面",
      "脚本": "示例口播",
      "场景": "室内客厅、光线柔和等",
      "镜头":{
        "拍摄角度": "平视",
        "景别": "中景",
        "运镜": "固定"
      },
      "表达方式": "亲切具有感染力等"
    }
  ]
}
""".strip()

def seconds_to_time_str(seconds: float) -> str:
    seconds = max(0.0, float(seconds))
    minutes = int(seconds // 60)
    remain = seconds - minutes * 60
    sec_int = int(remain)
    ms = int(round((remain - sec_int) * 1000))
    if ms >= 1000:
        sec_int += 1
        ms -= 1000
    if sec_int >= 60:
        minutes += 1
        sec_int -= 60
    return f"{minutes:02d}:{sec_int:02d}.{ms:03d}"

def ms_to_time_str(ms: int | float) -> str:
    return seconds_to_time_str(float(ms) / 1000.0)

def _parse_time_strict(time_str: str) -> float:
    value = str(time_str).strip()
    if not value:
        raise ValueError("时间为空")
    parts = value.split(":")
    if len(parts) == 2:
        minute_value = float(parts[0])
        second_value = float(parts[1])
        if minute_value < 0 or second_value < 0 or second_value >= 60:
            raise ValueError(f"时间分秒值非法: {value}")
        seconds = minute_value * 60 + second_value
    elif len(parts) == 3:
        hour_value = float(parts[0])
        minute_value = float(parts[1])
        second_value = float(parts[2])
        if hour_value < 0 or minute_value < 0 or minute_value >= 60 or second_value < 0 or second_value >= 60:
            raise ValueError(f"时间时分秒值非法: {value}")
        seconds = hour_value * 3600 + minute_value * 60 + second_value
    elif len(parts) == 1:
        seconds = float(value)
    else:
        raise ValueError(f"时间格式非法: {value}")
    if not math.isfinite(seconds) or seconds < 0:
        raise ValueError(f"时间值非法: {value}")
    return seconds

def _validate_and_finalize_ranges(normalized: list[dict], video_duration: float = 0.0) -> list[dict]:
    if not normalized:
        raise RuntimeError("模型输出无法标准化为有效时间范围列表")
    if len(normalized) > MAX_SEGMENT_COUNT:
        raise RuntimeError(f"模型输出片段过多: {len(normalized)} > {MAX_SEGMENT_COUNT}")

    normalized.sort(key=lambda item: item.pop("_start_seconds"))
    starts = [_parse_time_strict(item["时间范围"].split("-", 1)[0]) for item in normalized]
    ends = [_parse_time_strict(item["时间范围"].split("-", 1)[1]) for item in normalized]

    if starts[0] > SEGMENT_EDGE_TOLERANCE_SECONDS:
        raise RuntimeError(f"首片段未从视频起点开始: start={starts[0]:.3f}s")
    starts[0] = 0.0

    for index in range(len(normalized)):
        if ends[index] - starts[index] < MIN_SEGMENT_DURATION_SECONDS:
            raise RuntimeError(
                f"片段时长过短: index={index}, start={starts[index]:.3f}, end={ends[index]:.3f}"
            )
        if video_duration > 0 and ends[index] > video_duration + SEGMENT_EDGE_TOLERANCE_SECONDS:
            raise RuntimeError(
                f"片段结束时间越界: index={index}, end={ends[index]:.3f}, duration={video_duration:.3f}"
            )
        if index == 0:
            continue
        boundary_delta = starts[index] - ends[index - 1]
        if abs(boundary_delta) <= SEGMENT_BOUNDARY_TOLERANCE_SECONDS:
            starts[index] = ends[index - 1]
        elif boundary_delta > 0:
            raise RuntimeError(f"片段之间存在空洞: index={index}, gap={boundary_delta:.3f}s")
        else:
            raise RuntimeError(f"片段之间存在重叠: index={index}, overlap={-boundary_delta:.3f}s")

    if video_duration > 0:
        tail_delta = video_duration - ends[-1]
        if abs(tail_delta) <= SEGMENT_EDGE_TOLERANCE_SECONDS:
            ends[-1] = video_duration
        elif tail_delta > 0:
            raise RuntimeError(f"末片段未覆盖视频结尾: missing={tail_delta:.3f}s")
        else:
            raise RuntimeError(f"末片段超过视频结尾: overflow={-tail_delta:.3f}s")

    for index, item in enumerate(normalized):
        if ends[index] - starts[index] < MIN_SEGMENT_DURATION_SECONDS:
            raise RuntimeError(f"片段边界修正后时长过短: index={index}")
        item.pop("_end_seconds", None)
        item["时间范围"] = f"{seconds_to_time_str(starts[index])}-{seconds_to_time_str(ends[index])}"
    return normalized

def normalize_model_output(result: dict, video_duration: float = 0.0) -> list[dict]:
    """兼容多种返回格式，并校验整条视频的连续、无重叠和不越界。"""
    if not isinstance(result, dict):
        raise RuntimeError(f"模型输出格式错误: {type(result)}")

    raw_items = result.get("output")
    if raw_items is None:
        raw_items = result.get("clips") or result.get("segments") or result.get("list") or []

    if isinstance(raw_items, dict):
        raw_items = raw_items.get("clips") or raw_items.get("segments") or raw_items.get("list") or []

    if not isinstance(raw_items, list):
        raise RuntimeError("模型输出中未找到可用片段列表")

    normalized = []
    invalid_items = []
    for item_index, item in enumerate(raw_items):
        if not isinstance(item, dict):
            invalid_items.append(f"index={item_index}: 非对象")
            continue

        time_range = str(item.get("时间范围") or item.get("time_range") or "").strip()
        if not time_range:
            start_ms = item.get("start_time")
            end_ms = item.get("end_time")
            if start_ms is not None and end_ms is not None:
                try:
                    start_ms = int(float(start_ms))
                    end_ms = int(float(end_ms))
                    if end_ms > start_ms:
                        time_range = f"{ms_to_time_str(start_ms)}-{ms_to_time_str(end_ms)}"
                except Exception:
                    pass

        if not time_range or "-" not in time_range:
            invalid_items.append(f"index={item_index}: 缺少时间范围")
            continue

        start_str, end_str = time_range.split("-", 1)
        try:
            start_seconds = _parse_time_strict(start_str)
            end_seconds = _parse_time_strict(end_str)
        except (TypeError, ValueError) as error:
            invalid_items.append(f"index={item_index}: {error}")
            continue
        if end_seconds <= start_seconds:
            invalid_items.append(f"index={item_index}: 结束时间不大于开始时间")
            continue

        script_text = str(
            item.get("脚本")
            or item.get("口播内容")
            or item.get("broadcast_text")
            or item.get("text")
            or ""
        ).strip()
        scene_text = str(item.get("场景") or item.get("scene") or "").strip()
        expression_text = str(item.get("表达方式") or item.get("expression_style") or "").strip()
        visual_description = str(
            item.get("画面描述")
            or item.get("scene_description")
            or item.get("visual_description")
            or ""
        ).strip()
        camera_info = item.get("镜头")
        if camera_info is None:
            camera_info = {
                "拍摄角度": str(item.get("拍摄角度") or item.get("camera_angle") or "").strip(),
                "景别": str(item.get("景别") or item.get("shot_size") or "").strip(),
                "运镜": str(item.get("运镜") or item.get("camera_movement") or "").strip(),
            }
            if not any(camera_info.values()):
                camera_info = {}

        normalized.append(
            {
                "时间范围": time_range,
                "画面描述": visual_description,
                "脚本": script_text,
                "场景": scene_text,
                "镜头": camera_info if isinstance(camera_info, dict) else camera_info,
                "表达方式": expression_text,
                "_start_seconds": start_seconds,
                "_end_seconds": end_seconds,
            }
        )

    if invalid_items:
        raise RuntimeError("模型输出包含非法片段: " + "; ".join(invalid_items[:10]))

    normalized = _validate_and_finalize_ranges(normalized, video_duration=video_duration)
    logger.info("模型输出标准化完成: segment_count=%s", len(normalized))
    return normalized
