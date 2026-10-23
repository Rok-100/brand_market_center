import {VISUAL_REVIEW_VERSION} from './visual-quality.mjs';
export const hasPassedVisualReview = (assessment, sha256) => Boolean(
  sha256 && assessment?.visualReview?.status === 'passed' &&
  assessment.visualReview.sha256 === sha256 && assessment.visualReview.version === VISUAL_REVIEW_VERSION &&
  assessment.visualReview.confidence >= 0.9 &&
  Array.isArray(assessment.visualReview.issues) && assessment.visualReview.issues.length === 0,
);

const sameBoundary = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-6;
const segmentWords = segment => String(segment?.text || segment?.label || '');
// Text coverage only, NOT semantic approval. An exact ASR segment can still
// depend on omitted context; the output reviewer must judge the new sequence.
function clipTextEvidence(clip, source) {
  const segments = (source?.speechSegments || []).filter(segment =>
    Number.isFinite(segment.startSeconds) && Number.isFinite(segment.endSeconds)
      && segment.endSeconds > segment.startSeconds).slice().sort((a, b) =>
    a.startSeconds - b.startSeconds || a.endSeconds - b.endSeconds);
  const result = (selected, sourceTextComplete, sourceTextStatus) => {
    const words = selected.map(segmentWords), fullText = words.join(' ');
    const hasWords = words.length > 0 && words.every(text => text.trim());
    return {sourceText: fullText.slice(0, 1600),
      sourceTextComplete: Boolean(sourceTextComplete && hasWords && fullText.length <= 1600),
      sourceTextStatus: fullText.length > 1600 ? 'truncated_text' : !hasWords ? 'unknown_text' : sourceTextStatus};
  };
  if (!Number.isFinite(clip.startSeconds) || !Number.isFinite(clip.endSeconds)
    || clip.endSeconds <= clip.startSeconds) return result([], false, 'unknown_range');
  const within = segment => segment.startSeconds >= clip.startSeconds - 1e-6
    && segment.endSeconds <= clip.endSeconds + 1e-6;
  const boundary = clip.automaticAssessment?.boundaryIntegrity;
  const ids = Array.isArray(boundary?.segmentIds) ? boundary.segmentIds
    : boundary?.segmentId ? [boundary.segmentId] : [];
  let pointerMismatch = false;
  if (boundary?.status === 'passed' && ids.length) {
    const pointed = ids.map(id => segments.find(segment => segment.id === id));
    const ordered = pointed.filter(Boolean).sort((a, b) => a.startSeconds - b.startSeconds);
    if (new Set(ids).size === ids.length && ordered.length === ids.length
      && ordered.every(within) && !segments.some(segment => within(segment) && !ordered.includes(segment))
      && sameBoundary(ordered[0].startSeconds, clip.startSeconds)
      && sameBoundary(ordered.at(-1).endSeconds, clip.endSeconds))
      return result(ordered, true, ids.length === 1 ? 'exact_segment' : 'complete_segment_group');
    pointerMismatch = true;
  }
  const exact = segments.filter(segment => sameBoundary(segment.startSeconds, clip.startSeconds)
    && sameBoundary(segment.endSeconds, clip.endSeconds));
  if (!pointerMismatch && exact.length === 1) return result(exact, true, 'exact_segment');
  if (exact.length > 1) return {sourceText: '', sourceTextComplete: false, sourceTextStatus: 'ambiguous_segments'};

  // Old whole cuts need not have a private/ASR pointer: retain every fully
  // contained original sentence, but never promote a cropped sentence to full.
  const contained = segments.filter(within);
  const frameRate = [source?.frameRate, source?.nominalFrameRate]
    .map(Number).find(value => Number.isFinite(value) && value >= 1 && value <= 240);
  const oneFrame = frameRate ? 1 / frameRate : 0;
  const partial = segments.some(segment => !within(segment)
    && Math.min(segment.endSeconds, clip.endSeconds) - Math.max(segment.startSeconds, clip.startSeconds) > oneFrame + 1e-6);
  return result(contained, !pointerMismatch && !partial,
    pointerMismatch ? 'boundary_reference_mismatch' : partial ? 'incomplete_crop' : 'complete_segments');
}

export function visualTimeline(clips, sources) {
  const byId = new Map(sources.map(source => [source.id, source]));
  let cursor = 0;
  return clips.map(clip => {
    const source = byId.get(clip.sourceId);
    const result = {clipId:clip.id, role:clip.role, start:cursor, duration:clip.durationSeconds,
      sourceCategory:clip.productCategory, ...clipTextEvidence(clip, source)};
    cursor += clip.durationSeconds;
    return result;
  });
}

export function needsVisualAttention(variant) {
  const review = variant.automaticAssessment?.visualReview;
  return Boolean(review && (review.status !== 'passed' || review.version !== VISUAL_REVIEW_VERSION) && review.reason !== 'technical_prerequisite');
}
