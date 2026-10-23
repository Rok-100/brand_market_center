import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {brotliDecompressSync,gunzipSync} from 'node:zlib';
import {join} from 'node:path';
const root='/app/dist';
test('public HTML compression variants match the actual entry file',{skip:!existsSync(root)},()=>{
  const raw=readFileSync(join(root,'index.html'));
  for(const [suffix,decode] of [['.br',brotliDecompressSync],['.gz',gunzipSync]]){
    assert.ok(existsSync(join(root,'index.html'+suffix)),'Every release must ship HTML compression variants');
    assert.deepEqual(decode(readFileSync(join(root,'index.html'+suffix))),raw,'Compressed HTML served an older navigation');
  }
});
test('all actual HTTP encodings load the dissection frontend',{skip:!existsSync(root)},async()=>{
  const expected=readFileSync(join(root,'index.html'),'utf8');
  const asset=/src="\.\/([^"]+\.js)"/u.exec(expected)?.[1];assert.ok(asset);assert.ok(readFileSync(join(root,asset),'utf8').includes('dissection-review'));
  for(const encoding of ['identity','gzip','br']){
    const r=await fetch('http://127.0.0.1:3000/',{headers:{'accept-encoding':encoding}});assert.equal(r.status,200);assert.equal(await r.text(),expected,'Wrong page returned for '+encoding);
  }
});
