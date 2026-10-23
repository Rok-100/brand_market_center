import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeMaterialUpload} from './material-upload-policy.mjs';
const body=(kind,name,bytes=Buffer.from('fixture'),mime='')=>({kind,name,dataUrl:`data:${mime};base64,${bytes.toString('base64')}`});
test('office and text files without browser MIME work for all document libraries',()=>{
 for(const kind of ['communication','competitor','prohibited-word'])for(const ext of ['docx','pdf','txt','xlsx','pptx'])assert.equal(decodeMaterialUpload(body(kind,'资料.'+ext)).extension,'.'+ext);
});
test('empty, oversized, executable, forged images and unknown categories are rejected',()=>{
 for(const b of [body('competitor','x.exe'),body('communication','x.html'),body('cue-card','x.png'),body('unknown','x.txt'),body('competitor','x.txt',Buffer.alloc(0))])assert.throws(()=>decodeMaterialUpload(b));
 assert.throws(()=>decodeMaterialUpload(body('competitor','large.pdf',Buffer.alloc(10*1024*1024+1))),{status:413});
});
