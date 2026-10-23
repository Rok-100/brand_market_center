import {createHash} from 'node:crypto';

export const LOCAL_ASR_PROVIDER = 'faster-whisper';
export const LOCAL_AUDIO_MAPPING_RULE = 'decoded_samples_to_native_audio_pts_piecewise_v1';
export const LOCAL_ASR_FILES = ['source.json', 'transcript.srt', 'receipt.json', 'frames.json',
  'transcript.json', 'ffprobe.media.json', 'ffprobe.frames.json', 'ffprobe.audio.json', 'audio.wav'];
export const LOCAL_MODEL_FILES = ['config.json', 'model.bin', 'tokenizer.json', 'vocabulary.txt'];
export const LOCAL_ASR_HASH_KEYS = ['receiptSha256', 'rawTranscriptSha256', 'modelFingerprintSha256',
  'producerSha256', 'videoProbeSha256', 'audioProbeSha256', 'mediaProbeSha256', 'audioSha256', 'vadModelSha256'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const validSha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const requireValue = (value, reason) => {if (!value) throw Error(reason);};
const close = (left, right, tolerance = 1e-7) => Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance;
const numeric = value => {
  requireValue(typeof value === 'number' || typeof value === 'string' && value.trim() !== '', 'local_probe_number_missing');
  const result = Number(value); requireValue(Number.isFinite(result), 'local_probe_number_invalid'); return result;
};
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const modelFingerprint = files => sha(JSON.stringify(canonical(files)));
export const hasLocalAsrProviderEvidence = evidence => Boolean(evidence?.provider === LOCAL_ASR_PROVIDER &&
  typeof evidence.taskId === 'string' && /^[a-f0-9-]{36}$/i.test(evidence.taskId) &&
  LOCAL_ASR_HASH_KEYS.every(key => validSha(evidence[key])));

function timestamp(seconds) {
  // Python producer uses round(seconds * 1000), including ties-to-even.
  const scaled = seconds * 1000, floor = Math.floor(scaled);
  let ms = scaled - floor === .5 ? floor + floor % 2 : Math.round(scaled);
  const hours = Math.floor(ms / 3600000); ms %= 3600000;
  const minutes = Math.floor(ms / 60000); ms %= 60000;
  const secs = Math.floor(ms / 1000); ms %= 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

function wavDuration(bytes) {
  requireValue(bytes.length >= 44 && bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WAVE' && bytes.readUInt32LE(4) + 8 === bytes.length, 'local_audio_invalid_wav');
  let format = false, dataSize = null;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const name = bytes.toString('ascii', offset, offset + 4), size = bytes.readUInt32LE(offset + 4), start = offset + 8;
    requireValue(start + size <= bytes.length, 'local_audio_invalid_chunk');
    if (name === 'fmt ') {
      requireValue(size >= 16 && !format && bytes.readUInt16LE(start) === 1 && bytes.readUInt16LE(start + 2) === 1 &&
        bytes.readUInt32LE(start + 4) === 16000 && bytes.readUInt32LE(start + 8) === 32000 &&
        bytes.readUInt16LE(start + 12) === 2 && bytes.readUInt16LE(start + 14) === 16, 'local_audio_format_mismatch');
      format = true;
    }
    if (name === 'data') {requireValue(dataSize === null && size > 0 && size % 2 === 0, 'local_audio_data_invalid'); dataSize = size;}
    offset = start + size + size % 2;
  }
  requireValue(format && dataSize !== null, 'local_audio_missing_data');
  return dataSize / 32000;
}

function nativeAudioDuration(frame) {
  // FFprobe 5.x exposes native frame ticks under pkt_duration. Both spellings
  // still require original positive integers; conflicting fields fail closed.
  const values = ['duration', 'pkt_duration'].filter(key => Object.hasOwn(frame, key)).map(key => frame[key]);
  requireValue(values.length > 0 && values.every(value => Number.isSafeInteger(value) && value > 0),
    'local_asr_audio_integer_duration_missing');
  requireValue(values.every(value => value === values[0]), 'local_asr_audio_duration_field_conflict');
  return values[0];
}

function terminalAudioDiscard(frames, stream, numerator, denominator, rate) {
  if (stream.codec_name !== 'aac') return 0;
  const last = frames.at(-1), {start_pts: start, duration_ts: length} = stream;
  if (!last || ![last.nb_samples, last.best_effort_timestamp, start, length].every(Number.isSafeInteger) ||
    ![960, 1024, 1920, 2048].includes(last.nb_samples) || start < 0 || length <= 0) return 0;
  const ticks = nativeAudioDuration(last);
  // BigInt keeps divisibility an exact integer proof, not floating tolerance.
  const presentedTicks = start + length - last.best_effort_timestamp;
  if (!Number.isSafeInteger(presentedTicks) || presentedTicks <= 0 || presentedTicks > ticks) return 0;
  const samplesNumerator = BigInt(presentedTicks) * BigInt(numerator) * BigInt(rate), divisor = BigInt(denominator);
  if (samplesNumerator % divisor !== 0n) return 0;
  const presented = Number(samplesNumerator / divisor);
  return presented > 0 && presented < last.nb_samples ? last.nb_samples - presented : 0;
}

function audioTimeline(frames, stream, sourceDuration, wavSeconds) {
  requireValue(Array.isArray(frames) && frames.length > 0 && frames.length <= 500000, 'local_asr_audio_frames_missing');
  const rate = numeric(stream.sample_rate), timeBase = /^(\d+)\/(\d+)$/.exec(stream.time_base || '');
  requireValue(Number.isSafeInteger(rate) && rate >= 8000 && rate <= 384000 && timeBase && Number(timeBase[2]) > 0,
    'local_asr_audio_clock_invalid');
  const numerator = Number(timeBase[1]), denominator = Number(timeBase[2]);
  requireValue(Number.isSafeInteger(numerator) && numerator > 0 && Number.isSafeInteger(denominator), 'local_asr_audio_clock_invalid');
  const tick = numerator / denominator;
  requireValue(Number.isFinite(tick) && tick > 0 && tick <= .001, 'local_asr_audio_clock_too_coarse');
  const tolerance = 1e-6, durationTolerance = tick + 1e-6, driftLimit = .001;
  const terminalDiscard = terminalAudioDiscard(frames, stream, numerator, denominator, rate);
  const firstPts = frames[0].best_effort_timestamp;
  requireValue(Number.isSafeInteger(firstPts), 'local_asr_audio_integer_pts_missing');
  const start = firstPts * tick;
  requireValue(start >= 0 && start < sourceDuration, 'local_asr_audio_origin_invalid');
  let totalSamples = 0, previousEndPts = null, maxDrift = 0, adjustedFrameCount = 0;
  const mapping = [];
  for (const [index, frame] of frames.entries()) {
    const pts = frame.best_effort_timestamp, rawDurationTicks = nativeAudioDuration(frame);
    const durationTicks = terminalDiscard && index === frames.length - 1 ? stream.start_pts + stream.duration_ts - pts : rawDurationTicks;
    requireValue(Number.isSafeInteger(frame.nb_samples) && frame.nb_samples > 0, 'local_asr_audio_frame_invalid');
    const count = frame.nb_samples - (index === frames.length - 1 ? terminalDiscard : 0);
    const frameRate = frame.sample_rate === undefined ? rate : numeric(frame.sample_rate);
    requireValue(Number.isSafeInteger(pts) && Number.isSafeInteger(durationTicks) && durationTicks > 0 &&
      Number.isSafeInteger(count) && count > 0 && frameRate === rate && Number.isSafeInteger(pts + durationTicks),
      'local_asr_audio_frame_invalid');
    requireValue(close(numeric(frame.best_effort_timestamp_time), pts * tick, tolerance), 'local_asr_audio_decimal_pts_mismatch');
    // Native integer PTS must join exactly. An evidenced one-tick frame clock
    // difference is not permission to tolerate a gap, overlap, or growing skew.
    requireValue(previousEndPts === null || pts === previousEndPts,
      'local_asr_audio_pts_discontinuous');
    requireValue(close(durationTicks * tick, count / rate, durationTolerance), 'local_asr_audio_frame_duration_mismatch');
    if (Math.abs(durationTicks * tick - count / rate) > 1e-6) adjustedFrameCount++;
    maxDrift = Math.max(maxDrift, Math.abs(pts * tick - (start + totalSamples / rate)),
      Math.abs((pts + durationTicks) * tick - (start + (totalSamples + count) / rate)));
    requireValue(maxDrift <= driftLimit, 'local_asr_audio_cumulative_drift_exceeded');
    mapping.push({pts, durationTicks, count, startSample: totalSamples});
    totalSamples += count;
    requireValue(Number.isSafeInteger(totalSamples), 'local_asr_audio_samples_invalid');
    previousEndPts = pts + durationTicks;
  }
  const duration = totalSamples / rate, end = previousEndPts * tick;
  requireValue(end <= sourceDuration + .2 && close(duration, wavSeconds, 1 / 16000 + 1 / rate),
    'local_asr_audio_sample_duration_mismatch');
  let divisor = numerator, remainder = denominator;
  while (remainder) [divisor, remainder] = [remainder, divisor % remainder];
  const rationalTimeBase = denominator / divisor === 1 ? String(numerator / divisor) : `${numerator / divisor}/${denominator / divisor}`;
  const mappingSha256 = sha(JSON.stringify(canonical({frames: mapping.map(frame => [frame.startSample, frame.count, frame.pts, frame.durationTicks]),
    sampleRate: rate, timeBase: rationalTimeBase, rule: LOCAL_AUDIO_MAPPING_RULE})));
  const validation = {version: 'wis-audio-pts-continuity-v2', status: 'continuous', rawProbeScope: 'full_stream',
    gapPolicy: 'reject_no_padding', frameCount: frames.length, sourceSampleRate: rate, timeBaseSeconds: tick,
    toleranceSeconds: tolerance, totalSamples, decodedDurationSeconds: duration, sourceStartSeconds: start, sourceEndSeconds: end,
    clockModel: 'native_frame_duration_with_bounded_sample_clock_drift', frameDurationToleranceSeconds: durationTolerance,
    maxCumulativeDriftSeconds: maxDrift, maxCumulativeDriftLimitSeconds: driftLimit,
    mappingRule: LOCAL_AUDIO_MAPPING_RULE, mappingSha256, adjustedFrameCount};
  if (terminalDiscard) Object.assign(validation, {rawDecodedTotalSamples: totalSamples + terminalDiscard,
    terminalDiscardSamples: terminalDiscard, rawTerminalDurationTicks: nativeAudioDuration(frames.at(-1)),
    terminalPresentedDurationTicks: mapping.at(-1).durationTicks,
    terminalDiscardBasis: 'aac_final_frame_integer_presentation_and_stream_end',
    decodedSamplePolicy: 'trim_evidenced_terminal_padding_before_resample'});
  const mapSeconds = seconds => {
    requireValue(Number.isFinite(seconds) && seconds >= 0 && seconds <= duration, 'local_asr_time_outside_decoded_audio');
    const sample = seconds * rate;
    let low = 0, high = mapping.length - 1;
    while (low < high) {
      const middle = (low + high) >> 1, frame = mapping[middle];
      if (sample < frame.startSample + frame.count) high = middle; else low = middle + 1;
    }
    const frame = mapping[low];
    return (frame.pts + (sample - frame.startSample) / frame.count * frame.durationTicks) * tick;
  };
  return {validation, mapSeconds};
}

// Pure verification of bytes returned by the private store. modelVerification
// is supplied only by its server-configured allowlist reader, never by HTTP or
// by a receipt path. This is provenance/integrity, not speech or SKU approval.
export function verifyLocalAsrEvidence({source, sourceBytes, srtBytes, receipts: receipt, frameMap, localFiles, modelVerification}) {
  requireValue(source?.provider === LOCAL_ASR_PROVIDER && localFiles && modelVerification, 'local_asr_trusted_inputs_missing');
  requireValue(receipt?.schema === 'wis-local-asr-v1' && receipt.status === 'completed' && receipt.reason === null &&
    receipt.reviewRequired === true && receipt.autoApproved === false && receipt.noSpeechConfirmed === false &&
    receipt.networkUsed === false, 'local_asr_receipt_not_completed');
  requireValue(typeof receipt.taskId === 'string' && /^[a-f0-9-]{36}$/i.test(receipt.taskId) && source.asrTaskId === receipt.taskId,
    'local_asr_task_mismatch');
  requireValue(receipt.source?.sha256 === source.sha256 && receipt.source.sha256After === source.sha256 &&
    receipt.source.unchanged === true && receipt.source.size === sourceBytes.length && sha(sourceBytes) === source.sha256 &&
    close(receipt.source.durationSeconds, source.durationSeconds), 'local_asr_source_mismatch');
  requireValue(receipt.engine?.name === LOCAL_ASR_PROVIDER && typeof receipt.engine.version === 'string' && receipt.engine.version &&
    typeof receipt.engine.ctranslate2Version === 'string' && receipt.engine.ctranslate2Version &&
    receipt.engine.device === 'cpu' && ['int8', 'int8_float32'].includes(receipt.engine.computeType) &&
    validSha(receipt.engine.producerSha256) && receipt.engine.producerSha256 === modelVerification.producerSha256,
    'local_asr_engine_mismatch');
  const dataFiles = LOCAL_ASR_FILES.filter(name => !['source.json', 'receipt.json'].includes(name));
  requireValue(Object.keys(receipt.files || {}).sort().join('|') === [...dataFiles].sort().join('|'), 'local_asr_file_set_mismatch');
  for (const name of dataFiles) {
    const bytes = localFiles[name], expected = receipt.files[name];
    requireValue(Buffer.isBuffer(bytes) && validSha(expected?.sha256) && expected.size === bytes.length && sha(bytes) === expected.sha256,
      'local_asr_file_hash_mismatch');
  }
  requireValue(Buffer.isBuffer(localFiles['receipt.json']) &&
    JSON.stringify(JSON.parse(localFiles['receipt.json'])) === JSON.stringify(receipt) &&
    sha(localFiles['transcript.srt']) === sha(srtBytes) && sha(srtBytes) === source.srtSha256 &&
    JSON.stringify(JSON.parse(localFiles['frames.json'])) === JSON.stringify(frameMap), 'local_asr_input_substitution');
  requireValue(receipt.model?.localFilesOnly === true && receipt.model.verifiedAfterRecognition === true &&
    Object.keys(receipt.model.files || {}).sort().join('|') === [...LOCAL_MODEL_FILES].sort().join('|') &&
    LOCAL_MODEL_FILES.every(name => validSha(receipt.model.files[name]?.sha256) &&
      Number.isSafeInteger(receipt.model.files[name].size) && receipt.model.files[name].size > 0) &&
    modelFingerprint(receipt.model.files) === receipt.model.fingerprintSha256 &&
    receipt.model.fingerprintSha256 === modelVerification.fingerprintSha256 &&
    modelFingerprint(modelVerification.files) === modelVerification.fingerprintSha256 &&
    JSON.stringify(canonical(receipt.model.files)) === JSON.stringify(canonical(modelVerification.files)), 'local_asr_model_mismatch');
  requireValue(validSha(receipt.engine.vadModel?.sha256) && receipt.engine.vadModel.sha256 === modelVerification.vadSha256 &&
    receipt.engine.vadModel.size === modelVerification.vadSize, 'local_asr_vad_mismatch');

  const media = JSON.parse(localFiles['ffprobe.media.json']);
  const video = media.streams?.find(item => item.codec_type === 'video'), audio = media.streams?.find(item => item.codec_type === 'audio');
  requireValue(video && audio && close(numeric(media.format?.duration), source.durationSeconds) &&
    video.index === receipt.source.videoStreamIndex && audio.index === receipt.source.audioStreamIndex, 'local_asr_media_mismatch');
  const decoded = JSON.parse(localFiles['ffprobe.frames.json']).frames;
  requireValue(Array.isArray(decoded) && decoded.length >= 2 && decoded.length <= 500000, 'local_asr_video_frames_missing');
  const starts = decoded.map(frame => numeric(frame.best_effort_timestamp_time));
  requireValue(starts.every((value, index) => value >= 0 && (!index || value > starts[index - 1])), 'local_asr_video_pts_invalid');
  const durationValue = decoded.at(-1).duration_time ?? decoded.at(-1).pkt_duration_time;
  const lastDuration = durationValue === undefined ? null : numeric(durationValue);
  requireValue(lastDuration === null || lastDuration > 0, 'local_asr_video_duration_invalid');
  const end = lastDuration === null ? numeric(video.start_time) + numeric(video.duration) : starts.at(-1) + lastDuration;
  const endBasis = lastDuration === null ? 'video_stream_start_plus_duration' : 'last_decoded_frame_duration';
  requireValue(frameMap?.sourceSha256 === source.sha256 && frameMap.timeBasis === 'native_best_effort_timestamp_time_seconds' &&
    frameMap.rawProbeFile === 'ffprobe.frames.json' && frameMap.endBasis === endBasis &&
    Array.isArray(frameMap.starts) && frameMap.starts.length === starts.length &&
    starts.every((value, index) => close(value, frameMap.starts[index])) && close(end, frameMap.end) &&
    end > starts.at(-1) && end <= source.durationSeconds + .1, 'local_asr_frame_map_mismatch');
  const audioFrames = JSON.parse(localFiles['ffprobe.audio.json']).frames;
  const audioDuration = wavDuration(localFiles['audio.wav']);
  const {validation: timeline, mapSeconds} = audioTimeline(audioFrames, audio, source.durationSeconds, audioDuration);
  for (const key of ['rawDecodedTotalSamples', 'terminalDiscardSamples', 'rawTerminalDurationTicks',
    'terminalPresentedDurationTicks', 'terminalDiscardBasis', 'decodedSamplePolicy']) {
    requireValue(Object.hasOwn(receipt.audio?.timelineValidation || {}, key) === Object.hasOwn(timeline, key),
      'local_asr_audio_terminal_trim_claim_mismatch');
  }
  requireValue(receipt.audio?.timelineValidation && Object.entries(timeline).every(([key, value]) =>
    typeof value === 'number' ? close(value, receipt.audio.timelineValidation[key]) : receipt.audio.timelineValidation[key] === value),
    'local_asr_audio_timeline_receipt_mismatch');
  const offset = timeline.sourceStartSeconds;
  requireValue(offset >= 0 && offset < source.durationSeconds && audioDuration > 0 && audioDuration <= source.durationSeconds + .2 &&
    receipt.audio?.file === 'audio.wav' && receipt.audio.sampleRate === 16000 && receipt.audio.channels === 1 &&
    close(receipt.audio.durationSeconds, audioDuration, 1 / 16000) && close(receipt.audio.sourceTimeOffsetSeconds, offset) &&
    receipt.audio.rawProbeFile === 'ffprobe.audio.json' &&
    receipt.audio.timeOriginBasis === 'first_decoded_audio_frame_best_effort_timestamp_time' &&
    receipt.audio.sha256 === sha(localFiles['audio.wav']) && receipt.audio.size === localFiles['audio.wav'].length,
    'local_asr_audio_mismatch');
  const transcript = JSON.parse(localFiles['transcript.json']);
  requireValue(transcript.schema === 'wis-local-asr-transcript-v1' && transcript.taskId === receipt.taskId &&
    transcript.sourceSha256 === source.sha256 && transcript.audioSha256 === receipt.audio.sha256 &&
    transcript.modelFingerprintSha256 === receipt.model.fingerprintSha256 && transcript.timeBasis === 'decoded_audio_seconds' &&
    transcript.textRewritten === false && close(transcript.sourceTimeOffsetSeconds, offset) &&
    transcript.sourceTimeMappingRule === LOCAL_AUDIO_MAPPING_RULE && transcript.sourceTimeMappingSha256 === timeline.mappingSha256,
    'local_asr_transcript_binding_mismatch');
  const settings = receipt.recognition?.settings;
  requireValue(settings?.language === 'zh' && settings.beam_size === 5 && settings.word_timestamps === true &&
    settings.vad_filter === true && settings.condition_on_previous_text === false && settings.temperature === 0 &&
    settings.initial_prompt === null && settings.hotwords === null && receipt.recognition.textRewritten === false &&
    receipt.recognition.srtTimeBasis === 'source_native_audio_frame_piecewise_seconds', 'local_asr_recognition_settings_mismatch');
  requireValue(Array.isArray(transcript.segments) && transcript.segments.length > 0 && transcript.segments.length <= 5000,
    'local_asr_segments_missing');
  let previousEnd = 0, wordCount = 0;
  const srt = transcript.segments.map((segment, index) => {
    const {start, end, text, words} = segment;
    requireValue(Number.isFinite(start) && Number.isFinite(end) && start >= 0 && start < end &&
      start >= previousEnd - 1e-6 && end <= audioDuration &&
      typeof text === 'string' && text.trim() && !/[\r\n]/.test(text), 'local_asr_segment_invalid');
    previousEnd = end;
    const sourceStart = mapSeconds(start), sourceEnd = mapSeconds(end);
    requireValue(sourceStart >= 0 && sourceEnd <= source.durationSeconds + .1, 'local_asr_segment_outside_source');
    requireValue(Array.isArray(words) && words.length > 0 && words.length <= 10000, 'local_asr_words_missing');
    let previousWordEnd = start;
    for (const word of words) {
      requireValue(Number.isFinite(word.start) && Number.isFinite(word.end) && start - .05 <= word.start &&
        word.start <= word.end && word.end <= end + .05 && word.start >= previousWordEnd - .05 &&
        typeof word.word === 'string' && Number.isFinite(word.probability) && word.probability >= 0 && word.probability <= 1,
        'local_asr_word_invalid');
      // Word times remain raw ASR output, but every endpoint must be mappable
      // to an actual decoded sample; never clamp/extrapolate an overhang.
      requireValue(mapSeconds(word.start) >= 0 && mapSeconds(word.end) <= source.durationSeconds + .1,
        'local_asr_word_outside_source');
      previousWordEnd = word.end; wordCount++;
    }
    requireValue(words.map(word => word.word).join('').replace(/\s/g, '') === text.replace(/\s/g, ''), 'local_asr_word_text_mismatch');
    return `${index + 1}\n${timestamp(sourceStart)} --> ${timestamp(sourceEnd)}\n${text}\n`;
  }).join('\n');
  requireValue(Buffer.from(srt).equals(srtBytes) && receipt.recognition.segmentCount === transcript.segments.length &&
    receipt.recognition.wordCount === wordCount, 'local_asr_srt_word_mismatch');
  return {provider: LOCAL_ASR_PROVIDER, taskId: receipt.taskId, receiptSha256: sha(localFiles['receipt.json']),
    rawTranscriptSha256: sha(localFiles['transcript.json']), modelFingerprintSha256: receipt.model.fingerprintSha256,
    producerSha256: receipt.engine.producerSha256, videoProbeSha256: sha(localFiles['ffprobe.frames.json']),
    audioProbeSha256: sha(localFiles['ffprobe.audio.json']), mediaProbeSha256: sha(localFiles['ffprobe.media.json']),
    audioSha256: receipt.audio.sha256, vadModelSha256: receipt.engine.vadModel.sha256};
}
