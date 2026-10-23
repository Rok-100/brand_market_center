import { createHash } from 'node:crypto';

export const TEXT_QUALITY_VERSION = 'recognized-text-quality-v1';
const normalizeText = value => String(value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
const confidenceValue = value => value !== null && value !== undefined && value !== '' &&
  Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100 ? Number(value) : null;
const titleText = value => normalizeText(value).replace(/[<>:"/\\|?*\u0000-\u001f]/gu, '').replace(/\s+/gu, ' ').trim().slice(0, 60);

// This is a basic transcription quality check, not semantic or company review.
// Missing historical confidence alone must not reject Chinese, short words or brands.
export function assessRecognizedText({text, source = '', confidence = null} = {}) {
  const value = normalizeText(text), reasons = [], score = confidenceValue(confidence);
  const empty = !value || /^(?:口播段\s*\d+|无旁白|无字幕|no\s+(?:speech|narration|subtitles))$/iu.test(value);
  if (empty) reasons.push('no_recognized_text');
  if (/\ufffd|(?:[ÃÂ][\u0080-\u00bf])/u.test(value)) reasons.push('invalid_text_encoding');
  const letters = value.match(/[\p{L}\p{N}]/gu) || [];
  if (value && (!letters.length || letters.length / value.replace(/\s/gu, '').length < 0.35)) reasons.push('symbol_noise');
  if (source === 'ocr') {
    if (score !== null && score < 45) reasons.push('low_ocr_confidence');
    if (!/\p{Script=Han}/u.test(value) && /[{}\[\]\\|_~^]/u.test(value) && /[A-Za-z]/u.test(value)) reasons.push('ocr_latin_symbol_noise');
    if (/^(\p{L})(?:\s*\1){5,}$/iu.test(value)) reasons.push('ocr_repeated_character_noise');
  }
  const status = empty ? 'empty' : reasons.length ? 'noise' : 'usable';
  return {version:TEXT_QUALITY_VERSION, status, usable:status === 'usable', confidence:score, reasons};
}

// TSV retains actual engine confidence and word locations. Evidence is bounded
// per frame; a digest still identifies the complete unmodified engine response.
export function parseOcrTsv(raw, {frame, atSeconds, languages = 'chi_sim+eng', psm = 11} = {}) {
  const body = String(raw || ''), lines = body.split(/\r?\n/u), header = lines.shift()?.split('\t') || [];
  const fields = new Map(header.map((name, index) => [name, index]));
  if (!['level', 'conf', 'text'].every(name => fields.has(name))) throw new Error('OCR TSV response is missing confidence fields');
  const words = [];
  for (const line of lines) {
    const values = line.split('\t');
    if (values[fields.get('level')] !== '5') continue;
    const text = values.slice(fields.get('text')).join('\t').trim();
    if (!text) continue;
    words.push({text:text.slice(0, 240), confidence:confidenceValue(values[fields.get('conf')]),
      block:Number(values[fields.get('block_num')]) || 0, paragraph:Number(values[fields.get('par_num')]) || 0,
      line:Number(values[fields.get('line_num')]) || 0,
      left:Number(values[fields.get('left')]) || 0, top:Number(values[fields.get('top')]) || 0,
      width:Number(values[fields.get('width')]) || 0, height:Number(values[fields.get('height')]) || 0});
  }
  const grouped = [];
  for (const word of words) {
    const key = `${word.block}:${word.paragraph}:${word.line}`;
    const previous = grouped.at(-1);
    if (previous?.key === key) previous.words.push(word.text);
    else grouped.push({key, words:[word.text]});
  }
  const text = grouped.map(group => group.words.join(' ')).join('\n');
  const scored = words.filter(word => word.confidence !== null);
  const weight = scored.reduce((sum, word) => sum + word.text.length, 0);
  const confidence = weight ? Number((scored.reduce((sum, word) => sum + word.confidence * word.text.length, 0) / weight).toFixed(2)) : null;
  return {text, confidence, evidence:{engine:'tesseract', format:'tsv', languages, psm, frame, atSeconds,
    sha256:createHash('sha256').update(body).digest('hex'), rawText:text.slice(0, 500),
    confidence, wordCount:words.length, words:words.slice(0, 8), truncated:words.length > 8 || text.length > 500}};
}

export function mergeOcrEvidence(left = {}, right = {}) {
  const samples = [...(left.ocrEvidence || []), ...(right.ocrEvidence || [])];
  const unique = [...new Map(samples.map(sample => [`${sample.frame}:${sample.atSeconds}:${sample.sha256}`, sample])).values()].slice(0, 48);
  const confidence = [...unique.map(sample => sample.confidence), left.transcriptConfidence, right.transcriptConfidence]
    .map(confidenceValue).filter(value => value !== null);
  return {ocrEvidence:unique, transcriptConfidence:confidence.length ? Math.min(...confidence) : null};
}

const timestamp = value => {
  if (value === null || value === undefined || !Number.isFinite(Number(value)) || Number(value) < 0) return '未知';
  return String(Math.round(Number(value) * 100) / 100);
};
export const neutralClipName = (source, segment) => {
  const base = titleText(String(source?.originalName || '未命名原片').replace(/\.[^.]+$/u, '')).slice(0, 34) || '未命名原片';
  return `${base} · ${timestamp(segment?.startSeconds)}–${timestamp(segment?.endSeconds)}秒`;
};

export function generatedClipNaming(source, segment) {
  const manual = Boolean(segment?.manualEditedAt || segment?.transcriptSource === 'manual');
  const quality = assessRecognizedText({text:segment?.label, source:segment?.transcriptSource, confidence:segment?.transcriptConfidence});
  const recognized = titleText(segment?.clipName || segment?.label);
  return {name:(manual || quality.usable) && recognized ? recognized : neutralClipName(source, segment),
    nameOrigin:manual ? 'manual' : quality.usable && recognized ? 'recognized' : 'neutral_fallback', textQuality:quality};
}

// Read-time presentation only. Never rewrite historical data or guess at a
// human name: metadata edits, manual segments and unmatched names are preserved.
export function clipNamePresentation(clip, source) {
  if (!source || clip.nameOrigin === 'manual' || clip.metadataUpdatedAt) return {};
  const automatic = ['continuous_clip_supply', 'automatic_replenishment', 'material_center_effective'].includes(clip.approvalSource) ||
    clip.tags?.includes('自动切片') || clip.nameOrigin === 'recognized';
  if (!automatic) return {};
  const segment = source.speechSegments?.find(item => Math.abs(Number(item.startSeconds) - Number(clip.startSeconds)) < 0.05 &&
    Math.abs(Number(item.endSeconds) - Number(clip.endSeconds)) < 0.05);
  if (!segment || segment.manualEditedAt || segment.transcriptSource === 'manual') return {};
  if (![segment.label, segment.clipName].filter(Boolean).some(value => titleText(value) === clip.name)) return {};
  const naming = generatedClipNaming(source, segment);
  return naming.textQuality.usable ? {} : {...naming, storedNameTitle:clip.name, namePresentationOnly:true};
}
