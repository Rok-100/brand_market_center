import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {runInNewContext} from 'node:vm';
import {assessRecognizedText, parseOcrTsv, generatedClipNaming, clipNamePresentation, mergeOcrEvidence} from './recognized-text-quality.mjs';
import {mergeOcrSamples, normalizeSpeechCandidates} from './clip-remix-analysis.mjs';

const source = {originalName:'后座喷zy.mp4',speechSegments:[]};
const noisy = {id:'segment-7',label:'nae ee I} NV WZ \\ a',transcriptSource:'ocr',transcriptConfidence:null,
  startSeconds:9,endSeconds:10,boundaryConfidence:'high',requiresReview:false};
const tsv = words => ['level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext',
  ...words.map(([text,confidence],i)=>`5\t1\t1\t1\t1\t${i+1}\t${i*12}\t10\t12\t20\t${confidence}\t${text}`)].join('\n');

test('known OCR garbage fails text quality despite a high-confidence boundary', () => {
  const before = structuredClone(noisy);
  const name = generatedClipNaming(source, noisy);
  assert.equal(name.name,'后座喷zy · 9–10秒');
  assert.equal(name.nameOrigin,'neutral_fallback');
  assert.equal(name.textQuality.status,'noise');
  assert.deepEqual(noisy,before);
});

for (const value of ['敷一敷淡纹紧致','好','水润','WIS','SK-II','SPF50+','H2O','Hydrating Mask']) {
  test(`normal Chinese, short words and brands remain usable: ${value}`, () => {
    assert.equal(assessRecognizedText({text:value,source:'ocr',confidence:null}).usable,true);
    assert.equal(generatedClipNaming(source,{...noisy,label:value}).name,value);
  });
}

test('blank and narration placeholders are unavailable without requiring company review', () => {
  for (const text of ['', ' \n\t ', '无旁白', '口播段 01']) {
    const quality=assessRecognizedText({text,source:'ocr'});
    assert.equal(quality.status,'empty');
    assert.equal(quality.usable,false);
    assert.equal('requiresReview' in quality,false);
  }
});

test('actual low OCR confidence is distinct from missing historical confidence', () => {
  assert.equal(assessRecognizedText({text:'水润面膜',source:'ocr',confidence:0}).status,'noise');
  assert.equal(assessRecognizedText({text:'水润面膜',source:'ocr',confidence:44}).status,'noise');
  assert.equal(assessRecognizedText({text:'水润面膜',source:'ocr',confidence:95}).usable,true);
  assert.equal(assessRecognizedText({text:'水润面膜',source:'ocr',confidence:null}).usable,true);
});

test('semantic ASR guesses are not rewritten as correct business facts', () => {
  const segment={...noisy,label:'五美颜五绿镜',transcriptSource:'faster-whisper'};
  assert.equal(generatedClipNaming(source,segment).name,'五美颜五绿镜');
});

test('TSV extraction retains confidence, original text, locations and digest', () => {
  const result=parseOcrTsv(tsv([['WIS',92],['水润',88]]),{frame:'frame-0001.jpg',atSeconds:0});
  assert.equal(result.text,'WIS 水润');
  assert.equal(result.confidence,90.4);
  assert.equal(result.evidence.rawText,'WIS 水润');
  assert.deepEqual(result.evidence.words.map(word=>word.confidence),[92,88]);
  assert.equal(result.evidence.words[1].left,12);
  assert.match(result.evidence.sha256,/^[a-f0-9]{64}$/);
  assert.throws(()=>parseOcrTsv('plain words without a TSV header'),/missing confidence/);
});

test('service explicitly enables TSV without requiring an optional tsv config file', async () => {
  const service = await readFile(new URL('./clip-remix-service.mjs', import.meta.url), 'utf8');
  const call = service.match(/runProcess\(\s*tesseractPath,\s*(\[[\s\S]*?\]),\s*\{\s*timeoutMs:\s*30000,\s*resourceClass:\s*'ocr'\s*\}/u);
  assert.ok(call, 'actual OCR invocation must be covered by the TSV contract');
  const tempDir = path.join('synthetic', 'ocr'), frame = 'frame-0001.jpg';
  const args = Array.from(runInNewContext(call[1], {path, tempDir, frame}));
  assert.deepEqual(args, [path.join(tempDir, frame), 'stdout', '-l', 'chi_sim+eng', '--psm', '11', '-c', 'tessedit_create_tsv=1']);
  assert.equal(args.includes('tsv'), false);
  // Tesseract may exit zero when a named config is missing. Plain text remains
  // a contract failure, never invented confidence or a silent OCR fallback.
  assert.throws(() => parseOcrTsv('WIS 水润面膜\n'), /missing confidence/);
});

test('OCR evidence stays bounded for noisy frames', () => {
  const result=parseOcrTsv(tsv(Array.from({length:1000},(_,i)=>['word'+i,80])));
  assert.equal(result.evidence.words.length,8);
  assert.equal(result.evidence.rawText.length,500);
  assert.equal(result.evidence.wordCount,1000);
  assert.equal(result.evidence.truncated,true);
});

test('merged OCR candidates retain evidence through boundary normalization', () => {
  const a=parseOcrTsv(tsv([['水润面膜',90]]),{frame:'frame-0001.jpg',atSeconds:0});
  const b=parseOcrTsv(tsv([['水润面膜',85]]),{frame:'frame-0002.jpg',atSeconds:2});
  const candidates=mergeOcrSamples([{...a,startSeconds:0,endSeconds:2},{...b,startSeconds:2,endSeconds:4}],2);
  assert.equal(candidates.length,1);
  assert.equal(candidates[0].transcriptConfidence,85);
  assert.equal(candidates[0].ocrEvidence.length,2);
  const normalized=normalizeSpeechCandidates({candidates,durationSeconds:4,frameRate:30});
  assert.equal(normalized[0].ocrEvidence.length,2);
  assert.equal(normalized[0].transcriptConfidence,85);
  assert.equal(mergeOcrEvidence(candidates[0],candidates[0]).ocrEvidence.length,2);
  assert.equal(mergeOcrEvidence({transcriptConfidence:80},{transcriptConfidence:90}).transcriptConfidence,80);
});

test('historical generated noise gets a read-only title without changing identity or records', () => {
  const original={...source,speechSegments:[noisy]};
  const clip={id:'known-clip',name:'nae ee I} NV WZ a',sourceId:'known-source',startSeconds:9,endSeconds:10,
    approvalSource:'continuous_clip_supply',reviewStatus:'approved'};
  const before=JSON.stringify({clip,original});
  const presented={...clip,...clipNamePresentation(clip,original)};
  assert.equal(presented.id,clip.id);
  assert.equal(presented.name,'后座喷zy · 9–10秒');
  assert.equal(presented.storedNameTitle,clip.name);
  assert.equal(presented.reviewStatus,'approved');
  assert.equal(JSON.stringify({clip,original}),before);
});

test('manual and ambiguous historical names are never replaced', () => {
  const original={...source,speechSegments:[noisy]};
  const clip={id:'clip',name:'nae ee I} NV WZ a',startSeconds:9,endSeconds:10,approvalSource:'continuous_clip_supply'};
  for(const protectedClip of [{...clip,nameOrigin:'manual'},{...clip,metadataUpdatedAt:'2026-10-07'},
    {...clip,name:'人工命名产品镜'},{...clip,approvalSource:''}]) assert.deepEqual(clipNamePresentation(protectedClip,original),{});
  assert.deepEqual(clipNamePresentation(clip,{...original,speechSegments:[{...noisy,manualEditedAt:'2026-10-07'}]}),{});
  assert.equal(generatedClipNaming(source,{...noisy,clipName:'人工名称',manualEditedAt:'2026-10-07'}).name,'人工名称');
});
