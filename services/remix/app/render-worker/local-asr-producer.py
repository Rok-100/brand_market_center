"""Offline ASR evidence producer; not a content/SKU/permission approval.

Requires Python 3.11/3.12, faster-whisper 1.2.1, ctranslate2 4.8.2 and local FFmpeg.
Only explicitly supplied local source/model paths are accepted. No installation,
download, upload, credentials, application database or existing output is used.
Run: python -B local-asr-producer.py --input ABS_VIDEO --model-dir ABS_MODEL
     --output-dir ABS_NEW_DIRECTORY [--ffmpeg ABS_EXE --ffprobe ABS_EXE]
"""
from __future__ import annotations

import argparse
from bisect import bisect_right
import dataclasses
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import platform
import shutil
import stat
import subprocess
import sys
from datetime import datetime, timezone
from fractions import Fraction
import uuid
import wave

SCHEMA = "wis-local-asr-v1"
MODEL_FILES = ("config.json", "model.bin", "tokenizer.json", "vocabulary.txt")
MAX_SOURCE_BYTES = 2 * 1024**3
MAX_DURATION_SECONDS = 3600
MAX_PROBE_BYTES = 64 * 1024**2
AUDIO_MAPPING_RULE = "decoded_samples_to_native_audio_pts_piecewise_v1"


class EvidenceError(RuntimeError):
    pass


def require(condition, reason):
    if not condition:
        raise EvidenceError(reason)


def now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def number(value, reason):
    try:
        result = float(value)
    except (TypeError, ValueError):
        raise EvidenceError(reason) from None
    require(math.isfinite(result), reason)
    return result


def absolute_local_path(value, *, directory=False, new=False):
    item = Path(value)
    require(item.is_absolute() and "\0" not in str(item), "absolute_local_path_required")
    # UNC shares and reparse-point/symlink paths are not an offline local input.
    require(not str(item).startswith(("\\\\", "//")), "network_path_not_allowed")
    require(".." not in item.parts, "parent_path_not_allowed")
    for part in (item, *item.parents):
        if not part.exists() and not part.is_symlink():
            continue
        info = part.lstat()
        require(not stat.S_ISLNK(info.st_mode)
                and not (getattr(info, "st_file_attributes", 0) & 0x400), "linked_path_not_allowed")
    if new:
        require(not item.exists() and not item.is_symlink(), "output_directory_already_exists")
        require(item.parent.is_dir(), "output_parent_missing")
    elif directory:
        require(item.is_dir(), "local_model_directory_missing")
    else:
        require(item.is_file(), "local_source_file_missing")
    return item


def fingerprint(file):
    info = file.stat()
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns)


def hash_file(file):
    file = Path(file)
    info = file.lstat()
    require(stat.S_ISREG(info.st_mode) and not file.is_symlink(), "not_regular_evidence_file")
    before = fingerprint(file)
    digest = hashlib.sha256()
    with file.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    require(fingerprint(file) == before, "file_changed_during_hash")
    return {"sha256": digest.hexdigest(), "size": before[2]}


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, allow_nan=False, indent=2) + "\n").encode("utf-8")


def write_new(file, content):
    data = content if isinstance(content, bytes) else json_bytes(content)
    with file.open("xb") as handle:
        handle.write(data)
        handle.flush()
        os.fsync(handle.fileno())


def model_manifest(model_dir):
    files = {}
    # These are the exact four files used by the local WhisperModel loader.
    # A local tokenizer is mandatory, so no fallback can ask the Hub for one.
    for name in MODEL_FILES:
        file = absolute_local_path(str(model_dir / name))
        files[name] = hash_file(file)
        require(files[name]["size"] > 0, "empty_model_file")
    canonical = json.dumps(files, sort_keys=True, separators=(",", ":")).encode()
    return {"directory": str(model_dir), "files": files,
            "fingerprintSha256": hashlib.sha256(canonical).hexdigest(), "localFilesOnly": True}


def offline_environment():
    env = os.environ.copy()
    env.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_DATASETS_OFFLINE="1",
               HF_HUB_DISABLE_TELEMETRY="1", DO_NOT_TRACK="1")
    return env


def executable(value):
    result = shutil.which(value)
    require(result is not None, "media_executable_missing")
    return str(Path(result).absolute())


def command(args, *, timeout=300):
    try:
        process = subprocess.run(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                 stderr=subprocess.PIPE, shell=False, timeout=timeout,
                                 env=offline_environment())
    except (OSError, subprocess.TimeoutExpired):
        raise EvidenceError("media_command_unavailable_or_timed_out") from None
    require(process.returncode == 0, "media_command_failed")
    require(len(process.stdout) <= MAX_PROBE_BYTES, "media_probe_too_large")
    return process.stdout


def probe_json(ffprobe, source, *options):
    raw = command([ffprobe, "-v", "error", "-protocol_whitelist", "file,pipe",
                   *options, "-of", "json", "-i", str(source)])
    try:
        payload = json.loads(raw)
    except (ValueError, UnicodeError):
        raise EvidenceError("invalid_media_probe_json") from None
    require(isinstance(payload, dict), "invalid_media_probe_json")
    return raw, payload


def native_frames(probe, source_sha, video, duration):
    frames = probe.get("frames")
    require(isinstance(frames, list) and 2 <= len(frames) <= 500000, "native_video_frames_missing")
    starts = [number(frame.get("best_effort_timestamp_time"), "video_frame_pts_missing") for frame in frames]
    require(all(value >= 0 and (i == 0 or value > starts[i-1]) for i, value in enumerate(starts)),
            "nonmonotonic_video_frame_pts")
    last_duration = frames[-1].get("duration_time", frames[-1].get("pkt_duration_time"))
    if last_duration is not None:
        delta = number(last_duration, "video_frame_duration_missing")
        require(delta > 0, "video_frame_duration_missing")
        end, basis = starts[-1] + delta, "last_decoded_frame_duration"
    else:
        end = number(video.get("start_time"), "video_stream_start_missing") + number(video.get("duration"), "video_stream_duration_missing")
        basis = "video_stream_start_plus_duration"
    require(end > starts[-1] and end <= duration + .1, "video_frame_end_outside_source")
    return {"sourceSha256": source_sha, "starts": starts, "end": end,
            "timeBasis": "native_best_effort_timestamp_time_seconds",
            "endBasis": basis, "rawProbeFile": "ffprobe.frames.json"}


def native_audio_duration(frame):
    # FFprobe 5.x prints the native decoded-frame ticks as pkt_duration;
    # newer versions print duration. Retain raw evidence and never infer a
    # duration from samples. If both fields exist, neither can hide the other.
    values = [frame[key] for key in ("duration", "pkt_duration") if key in frame]
    require(values and all(isinstance(value, int) and not isinstance(value, bool) and value > 0
                           for value in values), "unsupported_audio_integer_duration")
    require(all(value == values[0] for value in values), "unsupported_audio_duration_field_conflict")
    return values[0]


def terminal_audio_discard(frames, audio):
    """Recognize only an evidenced AAC terminal presentation trim.

    A decoded AAC frame can contain codec padding beyond its packet's native
    presentation interval. Do not stretch those samples onto the shorter PTS
    interval: trim them before resampling, keeping both counts in the receipt.
    The stream's integer end must independently corroborate the final frame.
    """
    if not frames or audio.get("codec_name") != "aac":
        return 0
    last = frames[-1]
    if not isinstance(last, dict):
        return 0
    count, pts = last.get("nb_samples"), last.get("best_effort_timestamp")
    start, length = audio.get("start_pts"), audio.get("duration_ts")
    if not all(isinstance(x, int) and not isinstance(x, bool) for x in (count, pts, start, length)):
        return 0
    if count not in (960, 1024, 1920, 2048) or start < 0 or length <= 0:
        return 0
    ticks = native_audio_duration(last)
    try:
        presented_ticks = start + length - pts
        presented = Fraction(audio["time_base"]) * presented_ticks * int(audio["sample_rate"])
    except (KeyError, ValueError, TypeError, ZeroDivisionError):
        return 0
    if not 0 < presented_ticks <= ticks or presented.denominator != 1 or not 0 < presented < count:
        return 0
    return count - int(presented)


def native_audio_timeline(probe, audio, duration):
    """Require a continuous native audio timeline before decoding to WAV.

    FFmpeg's ordinary WAV conversion concatenates decoded samples; it does not
    preserve missing source PTS intervals. Require integer source frames to
    connect exactly, and sample/container clocks to differ only by proven,
    bounded sub-millisecond quantization. No silence is inserted.
    """
    frames = probe.get("frames")
    require(isinstance(frames, list) and 0 < len(frames) <= 500000,
            "decoded_audio_start_missing")
    terminal_discard = terminal_audio_discard(frames, audio)
    sample_rate = number(audio.get("sample_rate"), "unsupported_audio_sample_rate")
    require(sample_rate.is_integer() and 8000 <= sample_rate <= 384000,
            "unsupported_audio_sample_rate")
    try:
        tick = float(Fraction(audio.get("time_base", "")))
    except (ValueError, TypeError, ZeroDivisionError, OverflowError):
        raise EvidenceError("unsupported_audio_timestamp_precision") from None
    require(math.isfinite(tick) and 0 < tick <= .001,
            "unsupported_audio_timestamp_precision")
    precision = 1e-6  # ffprobe's decimal seconds serialization, not a gap budget.
    frame_tolerance = tick + precision
    require(isinstance(frames[0], dict), "unsupported_audio_frame")
    first_pts = frames[0].get("best_effort_timestamp")
    require(isinstance(first_pts, int) and not isinstance(first_pts, bool), "unsupported_audio_integer_pts")
    origin = first_pts * tick
    require(0 <= origin < duration, "unsupported_audio_presentation_origin")
    total_samples = 0
    previous_end_ticks = None
    max_skew = 0.0
    adjusted_frame_count = 0
    for index, frame in enumerate(frames):
        require(isinstance(frame, dict), "unsupported_audio_frame")
        pts_ticks, duration_ticks = frame.get("best_effort_timestamp"), native_audio_duration(frame)
        require(isinstance(pts_ticks, int) and not isinstance(pts_ticks, bool),
                "unsupported_audio_integer_pts")
        if terminal_discard and index == len(frames) - 1:
            duration_ticks = audio["start_pts"] + audio["duration_ts"] - pts_ticks
        pts = pts_ticks * tick
        decimal_pts = number(frame.get("best_effort_timestamp_time"), "unsupported_audio_frame_pts")
        require(abs(pts - decimal_pts) <= precision, "unsupported_audio_pts_serialization")
        count = frame.get("nb_samples")
        require(isinstance(count, int) and not isinstance(count, bool) and count > 0,
                "unsupported_audio_sample_count")
        if index == len(frames) - 1:
            count -= terminal_discard
        rate = number(frame.get("sample_rate", sample_rate), "unsupported_audio_sample_rate")
        require(rate == sample_rate, "unsupported_audio_sample_rate_change")
        require(previous_end_ticks is None or pts_ticks == previous_end_ticks,
                "unsupported_audio_pts_discontinuity_no_padding")
        native_duration = duration_ticks * tick
        duration_skew = native_duration - count / sample_rate
        require(abs(duration_skew) <= frame_tolerance, "unsupported_audio_frame_duration_sample_mismatch")
        adjusted_frame_count += int(abs(duration_skew) > precision)
        # Check every prefix, not only the net end drift: opposing clock errors
        # must never hide an intermediate displacement larger than one ms.
        max_skew = max(max_skew, abs(pts - (origin + total_samples / sample_rate)))
        total_samples += count
        previous_end_ticks = pts_ticks + duration_ticks
        max_skew = max(max_skew, abs(previous_end_ticks * tick - (origin + total_samples / sample_rate)))
        require(max_skew <= .001, "unsupported_audio_cumulative_clock_drift")
    decoded_duration = total_samples / sample_rate
    require(0 < decoded_duration <= duration + .2, "unsupported_audio_timeline_duration")
    validation = {"version": "wis-audio-pts-continuity-v2", "status": "continuous",
            "rawProbeScope": "full_stream", "gapPolicy": "reject_no_padding",
            "clockModel": "native_frame_duration_with_bounded_sample_clock_drift",
            "frameCount": len(frames), "sourceSampleRate": int(sample_rate),
            "timeBaseSeconds": tick, "toleranceSeconds": precision,
            "frameDurationToleranceSeconds": frame_tolerance,
            "maxCumulativeDriftSeconds": max_skew, "maxCumulativeDriftLimitSeconds": .001,
            "adjustedFrameCount": adjusted_frame_count,
            "totalSamples": total_samples, "decodedDurationSeconds": decoded_duration,
            "sourceStartSeconds": origin, "sourceEndSeconds": previous_end_ticks * tick}
    if terminal_discard:
        validation.update(rawDecodedTotalSamples=total_samples + terminal_discard,
                          terminalDiscardSamples=terminal_discard,
                          rawTerminalDurationTicks=native_audio_duration(frames[-1]),
                          terminalPresentedDurationTicks=duration_ticks,
                          terminalDiscardBasis="aac_final_frame_integer_presentation_and_stream_end",
                          decodedSamplePolicy="trim_evidenced_terminal_padding_before_resample")
    return validation


def native_audio_mapping(probe, sample_rate, time_base, terminal_discard_samples=0, terminal_duration_ticks=None):
    """Canonical integer-only mapping; raw ffprobe evidence can recreate it."""
    entries = []
    total = 0
    for index, frame in enumerate(probe["frames"]):
        count = frame["nb_samples"] - (terminal_discard_samples if index == len(probe["frames"]) - 1 else 0)
        require(isinstance(count, int) and count > 0, "unsupported_audio_sample_count")
        ticks = (terminal_duration_ticks if terminal_duration_ticks is not None and index == len(probe["frames"]) - 1
                 else native_audio_duration(frame))
        entries.append([total, count, frame["best_effort_timestamp"], ticks])
        total += count
    mapping = {"frames": entries, "sampleRate": sample_rate,
               "timeBase": str(Fraction(time_base)), "rule": AUDIO_MAPPING_RULE}
    canonical = json.dumps(mapping, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return mapping, hashlib.sha256(canonical).hexdigest()


def audio_time_mapper(mapping):
    entries = mapping["frames"]
    starts = [entry[0] for entry in entries]
    sample_rate = mapping["sampleRate"]
    total_samples = entries[-1][0] + entries[-1][1]
    tick = float(Fraction(mapping["timeBase"]))

    def map_time(seconds):
        require(finite(seconds) and 0 <= seconds <= total_samples / sample_rate,
                "asr_time_outside_decoded_audio_mapping")
        position = seconds * sample_rate
        index = min(bisect_right(starts, position) - 1, len(entries) - 1)
        decoded_start, sample_count, pts, duration_ticks = entries[index]
        # This operation order is the evidence contract. Consumer independently
        # reconstructs it; no source gap is clamped, filled or extrapolated.
        return (pts + (position - decoded_start) / sample_count * duration_ticks) * tick

    return map_time


def plain(value, *, metadata=False):
    if dataclasses.is_dataclass(value):
        return plain(dataclasses.asdict(value), metadata=metadata)
    if hasattr(value, "_asdict"):
        return plain(value._asdict(), metadata=metadata)
    if isinstance(value, dict):
        return {str(key): plain(item, metadata=metadata) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [plain(item, metadata=metadata) for item in value]
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        if metadata and not math.isfinite(value):
            # Whisper's VAD configuration uses +inf for an unlimited window.
            # Preserve that exact metadata meaning in standards-compliant JSON,
            # never turn it into zero or accept it as a timestamp/probability.
            return {"__nonfinite_float__": "NaN" if math.isnan(value) else "Infinity" if value > 0 else "-Infinity"}
        require(math.isfinite(value), "nonfinite_engine_result")
        return value
    # numpy scalar values have an exact Python scalar conversion.
    if hasattr(value, "item"):
        return plain(value.item(), metadata=metadata)
    raise EvidenceError("unsupported_engine_result_type")


def load_backend(model_dir, cpu_threads):
    # Set offline flags before importing Hugging Face dependencies. Model path
    # and tokenizer are existing local files; this cannot select a remote name.
    os.environ.update({key: value for key, value in offline_environment().items()
                       if key in {"HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE", "HF_DATASETS_OFFLINE",
                                  "HF_HUB_DISABLE_TELEMETRY", "DO_NOT_TRACK"}})
    try:
        from faster_whisper import WhisperModel
        from faster_whisper.utils import get_assets_path
        model = WhisperModel(str(model_dir), device="cpu", compute_type="int8",
                             local_files_only=True, cpu_threads=cpu_threads, num_workers=1)
        engine = {"name": "faster-whisper", "version": importlib.metadata.version("faster-whisper"),
                  "ctranslate2Version": importlib.metadata.version("ctranslate2"),
                  "pythonVersion": platform.python_version(), "device": model.model.device,
                  "computeType": model.model.compute_type,
                  "dependencies": {name: importlib.metadata.version(name)
                                   for name in ("onnxruntime", "tokenizers", "av")}}
        vad_file = absolute_local_path(str(Path(get_assets_path()) / "silero_vad_v6.onnx"))
        engine["vadModel"] = {"path": str(vad_file), **hash_file(vad_file)}
        return model, engine
    except (ImportError, importlib.metadata.PackageNotFoundError):
        raise EvidenceError("local_asr_dependencies_missing") from None


def srt_timestamp(seconds):
    milliseconds = round(seconds * 1000)
    hours, rest = divmod(milliseconds, 3600000)
    minutes, rest = divmod(rest, 60000)
    secs, ms = divmod(rest, 1000)
    return f"{hours:02}:{minutes:02}:{secs:02},{ms:03}"


def recognition_result(segments, audio_duration, source_offset, source_duration, *, map_source_time):
    previous_end = 0.0
    has_words = True
    blocks = []
    for index, segment in enumerate(segments, 1):
        require(isinstance(segment, dict), "invalid_asr_segment")
        start, end, text = segment.get("start"), segment.get("end"), segment.get("text")
        require(finite(start) and finite(end) and 0 <= start < end <= audio_duration + .1,
                "invalid_asr_segment_bounds")
        require(start >= previous_end - 1e-6, "overlapping_asr_segments")
        mapped_start, mapped_end = map_source_time(start), map_source_time(end)
        require(0 <= mapped_start < mapped_end <= source_duration + .1, "asr_outside_source")
        require(isinstance(text, str) and "\r" not in text and "\n" not in text,
                "invalid_asr_segment_text")
        previous_end = end
        words = segment.get("words")
        if not text.strip() or not isinstance(words, list) or not words:
            has_words = False
        previous_word_end = start
        for word in words or []:
            begin, finish, probability = word.get("start"), word.get("end"), word.get("probability")
            require(finite(begin) and finite(finish) and start - .05 <= begin <= finish <= end + .05
                    and begin >= previous_word_end - .05, "invalid_asr_word_bounds")
            require(isinstance(word.get("word"), str) and finite(probability) and 0 <= probability <= 1,
                    "invalid_asr_word_result")
            require(0 <= map_source_time(begin) <= map_source_time(finish) <= source_duration + .1,
                    "asr_word_outside_source")
            previous_word_end = finish
        # Keep engine text and raw segment/word times unchanged. SRT explicitly
        # maps decoded sample positions through verified native frame clocks.
        blocks.append(f"{index}\n{srt_timestamp(mapped_start)} --> {srt_timestamp(mapped_end)}\n{text}\n")
    sufficient = bool(segments) and has_words
    return sufficient, "\n".join(blocks).encode("utf-8")


def produce(input_path, model_path, output_path, *, ffmpeg="ffmpeg", ffprobe="ffprobe", cpu_threads=2):
    source = absolute_local_path(input_path)
    model_dir = absolute_local_path(model_path, directory=True)
    output = absolute_local_path(output_path, new=True)
    require(isinstance(cpu_threads, int) and 1 <= cpu_threads <= 16, "invalid_cpu_thread_count")
    source_initial_stat = fingerprint(source)
    require(0 < source_initial_stat[2] <= MAX_SOURCE_BYTES, "source_size_out_of_bounds")
    source_before = hash_file(source)
    model_before = model_manifest(model_dir)
    ffmpeg, ffprobe = executable(ffmpeg), executable(ffprobe)
    output.mkdir(mode=0o700, exist_ok=False)
    receipt = {"schema": SCHEMA, "taskId": str(uuid.uuid4()), "createdAt": now(), "status": "processing",
               "reviewRequired": True, "autoApproved": False, "noSpeechConfirmed": False,
               "source": {"path": str(source), **source_before}, "model": model_before,
               "files": {}, "networkUsed": False}
    try:
        media_raw, media = probe_json(ffprobe, source, "-show_streams", "-show_format")
        write_new(output / "ffprobe.media.json", media_raw)
        streams = media.get("streams", [])
        video = next((s for s in streams if s.get("codec_type") == "video"), None)
        audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
        require(video is not None, "source_video_stream_missing")
        require(audio is not None, "source_audio_stream_missing_not_speech_approval")
        duration = number(media.get("format", {}).get("duration"), "source_duration_missing")
        require(0 < duration <= MAX_DURATION_SECONDS, "source_duration_out_of_bounds")
        receipt["source"].update(durationSeconds=duration, videoStreamIndex=video["index"], audioStreamIndex=audio["index"])
        frames_raw, frames_probe = probe_json(ffprobe, source, "-select_streams", "v:0", "-show_frames",
            "-show_entries", "frame=best_effort_timestamp_time,duration_time,pkt_duration_time")
        write_new(output / "ffprobe.frames.json", frames_raw)
        frames = native_frames(frames_probe, source_before["sha256"], video, duration)
        write_new(output / "frames.json", frames)
        audio_raw, audio_probe = probe_json(ffprobe, source, "-select_streams", "a:0",
            "-show_frames", "-show_entries", "frame=best_effort_timestamp,best_effort_timestamp_time,duration,pkt_duration,nb_samples,sample_rate")
        write_new(output / "ffprobe.audio.json", audio_raw)
        audio_timeline = native_audio_timeline(audio_probe, audio, duration)
        audio_mapping, mapping_sha = native_audio_mapping(audio_probe, audio_timeline["sourceSampleRate"], audio["time_base"],
                                                       audio_timeline.get("terminalDiscardSamples", 0),
                                                       audio_timeline.get("terminalPresentedDurationTicks"))
        audio_timeline.update(mappingRule=AUDIO_MAPPING_RULE, mappingSha256=mapping_sha)
        map_source_time = audio_time_mapper(audio_mapping)
        source_offset = audio_timeline["sourceStartSeconds"]
        audio_file = output / "audio.wav"
        trim_options = (["-af", "atrim=end_sample=" + str(audio_timeline["totalSamples"])]
                        if audio_timeline.get("terminalDiscardSamples") else [])
        command([ffmpeg, "-nostdin", "-hide_banner", "-loglevel", "error", "-n", "-threads", "2",
                 "-protocol_whitelist", "file,pipe", "-i", str(source), "-map", "0:a:0", "-vn", "-sn", "-dn",
                 *trim_options, "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(audio_file)])
        with wave.open(str(audio_file), "rb") as handle:
            require(handle.getframerate() == 16000 and handle.getnchannels() == 1 and handle.getsampwidth() == 2,
                    "invalid_decoded_audio_format")
            audio_duration = handle.getnframes() / handle.getframerate()
        require(0 < audio_duration <= duration + .2, "invalid_decoded_audio_duration")
        require(abs(audio_duration - audio_timeline["decodedDurationSeconds"])
                <= 1 / 16000 + 1 / audio_timeline["sourceSampleRate"],
                "unsupported_decoded_audio_duration_mismatch")
        receipt["audio"] = {"file": "audio.wav", **hash_file(audio_file), "sampleRate": 16000, "channels": 1,
                            "durationSeconds": audio_duration, "sourceTimeOffsetSeconds": source_offset,
                            "timeOriginBasis": "first_decoded_audio_frame_best_effort_timestamp_time",
                            "rawProbeFile": "ffprobe.audio.json", "timelineValidation": audio_timeline}
        model, engine = load_backend(model_dir, cpu_threads)
        engine.update(ffmpegVersion=command([ffmpeg, "-version"]).decode("utf-8", "replace").splitlines()[0],
                      ffprobeVersion=command([ffprobe, "-version"]).decode("utf-8", "replace").splitlines()[0],
                      producerSha256=hash_file(Path(__file__).absolute())["sha256"])
        receipt["engine"] = engine
        settings = {"language": "zh", "beam_size": 5, "word_timestamps": True, "vad_filter": True,
                    "condition_on_previous_text": False, "temperature": 0.0,
                    "initial_prompt": None, "hotwords": None}
        results, info = model.transcribe(str(audio_file), **settings)
        segments = [plain(segment) for segment in results]
        require(len(segments) <= 10000, "too_many_asr_segments")
        transcript = {"schema": "wis-local-asr-transcript-v1", "taskId": receipt["taskId"],
                      "sourceSha256": source_before["sha256"], "audioSha256": receipt["audio"]["sha256"],
                      "modelFingerprintSha256": model_before["fingerprintSha256"],
                      "timeBasis": "decoded_audio_seconds", "sourceTimeOffsetSeconds": source_offset,
                      "sourceTimeMappingRule": AUDIO_MAPPING_RULE, "sourceTimeMappingSha256": mapping_sha,
                      "segments": segments, "info": plain(info, metadata=True), "textRewritten": False}
        write_new(output / "transcript.json", transcript)
        sufficient, srt = recognition_result(segments, audio_duration, source_offset, duration,
                                            map_source_time=map_source_time)
        write_new(output / "transcript.srt", srt)
        receipt["recognition"] = {"settings": settings, "segmentCount": len(segments),
                                  "wordCount": sum(len(segment.get("words") or []) for segment in segments),
                                  "srtTimeBasis": "source_native_audio_frame_piecewise_seconds", "textRewritten": False}
        source_after = hash_file(source)
        receipt["source"].update(sha256After=source_after["sha256"], unchanged=source_after == source_before
                                 and fingerprint(source) == source_initial_stat)
        require(receipt["source"]["unchanged"], "source_changed_during_recognition")
        require(model_manifest(model_dir) == model_before, "model_changed_during_recognition")
        require(hash_file(audio_file) == {"sha256": receipt["audio"]["sha256"], "size": receipt["audio"]["size"]},
                "decoded_audio_changed_during_recognition")
        vad = engine["vadModel"]
        require(hash_file(Path(vad["path"])) == {"sha256": vad["sha256"], "size": vad["size"]},
                "vad_model_changed_during_recognition")
        receipt["model"]["verifiedAfterRecognition"] = True
        receipt["status"] = "completed" if sufficient else "insufficient_recognition"
        receipt["reason"] = None if sufficient else "empty_or_missing_word_timestamp_result_not_no_speech_approval"
        receipt["completedAt"] = now()
        receipt["files"] = {file.name: hash_file(file) for file in sorted(output.iterdir()) if file.is_file()}
        write_new(output / "receipt.json", receipt)
        return receipt
    except Exception as error:
        receipt.update(status="failed", completedAt=now(),
                       reason=str(error) if isinstance(error, EvidenceError) else type(error).__name__)
        # Preserve partial raw evidence. Never erase a directory or overwrite a
        # receipt; consumers must reject failed or incomplete evidence bundles.
        if not (output / "receipt.json").exists():
            write_new(output / "receipt.json", receipt)
        raise


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True)
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--ffmpeg", default="ffmpeg")
    parser.add_argument("--ffprobe", default="ffprobe")
    parser.add_argument("--cpu-threads", type=int, default=2)
    args = parser.parse_args(argv)
    try:
        receipt = produce(args.input, args.model_dir, args.output_dir,
                          ffmpeg=args.ffmpeg, ffprobe=args.ffprobe, cpu_threads=args.cpu_threads)
    except Exception as error:
        print(json.dumps({"schema": SCHEMA, "status": "failed", "reviewRequired": True,
                          "autoApproved": False, "reason": str(error) if isinstance(error, EvidenceError)
                          else type(error).__name__}, ensure_ascii=False), file=sys.stderr)
        return 1
    print(json.dumps({key: receipt[key] for key in ("schema", "taskId", "status", "reviewRequired", "autoApproved")}, ensure_ascii=False))
    return 0 if receipt["status"] == "completed" else 2


if __name__ == "__main__":
    raise SystemExit(main())
