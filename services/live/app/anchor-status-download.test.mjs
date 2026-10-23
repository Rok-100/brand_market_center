import test from 'node:test';
import assert from 'node:assert/strict';
import {downloadRecordingResource} from './anchor-status-download.mjs';

function fixture({reject=true,total=10,broken='',code=234037}={}){
  const calls=[],bytes=Uint8Array.from({length:total},(_,i)=>i);
  const fetchImpl=async(url,options)=>{
    calls.push(options.headers.Range);assert.equal(options.redirect,'manual');assert.equal(options.headers.Authorization,'Bearer fixture');
    if(!options.headers.Range)return reject?Response.json({code},{status:400}):new Response(bytes);
    const [,a,b]=options.headers.Range.match(/^bytes=(\d+)-(\d+)$/u),start=+a,end=+b;
    const body=bytes.slice(start,end+1);
    return new Response(broken==='truncated'&&start>0?body.slice(0,-1):body,{status:206,headers:{'content-range':`bytes ${broken==='range'&&start>0?0:start}-${end}/${total}`,'content-type':'video/mp4'}});
  };
  return {calls,bytes,fetchImpl};
}
test('ordinary recordings keep their original full response and bytes',async()=>{
  const f=fixture({reject:false});const response=await downloadRecordingResource('https://fixture/video','fixture',{fetchImpl:f.fetchImpl});assert.deepEqual(new Uint8Array(await response.arrayBuffer()),f.bytes);assert.deepEqual(f.calls,[undefined]);
});
test('explicit Feishu size rejection uses verified bounded ranges and reconstructs every original byte',async()=>{
  const f=fixture();const response=await downloadRecordingResource('https://fixture/video','fixture',{fetchImpl:f.fetchImpl,chunkBytes:4});assert.equal(response.status,200);assert.equal(response.headers.get('content-length'),'10');assert.deepEqual(new Uint8Array(await response.arrayBuffer()),f.bytes);assert.deepEqual(f.calls,[undefined,'bytes=0-0','bytes=0-3','bytes=4-7','bytes=8-9']);
});
test('wrong ranges, truncated chunks and oversized originals cannot masquerade as a complete video',async()=>{
  for(const broken of ['range','truncated']){const f=fixture({broken});const response=await downloadRecordingResource('https://fixture/video','fixture',{fetchImpl:f.fetchImpl,chunkBytes:4});await assert.rejects(response.arrayBuffer(),{code:'download_error'});}
  const f=fixture();await assert.rejects(downloadRecordingResource('https://fixture/video','fixture',{fetchImpl:f.fetchImpl,maxBytes:9}),{code:'media_quality'});assert.deepEqual(f.calls,[undefined,'bytes=0-0']);
});
test('permission errors do not trigger range retries; abort and cancellation stop further chunks',async()=>{
  const denied=fixture({code:230001});await assert.rejects(downloadRecordingResource('https://fixture/video','fixture',{fetchImpl:denied.fetchImpl}),{code:'download_error'});assert.equal(denied.calls.length,1);
  const f=fixture(),abort=new AbortController();const response=await downloadRecordingResource('https://fixture/video','fixture',{fetchImpl:f.fetchImpl,chunkBytes:4,signal:abort.signal});abort.abort();await assert.rejects(response.arrayBuffer());assert.equal(f.calls.length,2);
  const cancelled=fixture();const other=await downloadRecordingResource('https://fixture/video','fixture',{fetchImpl:cancelled.fetchImpl,chunkBytes:4});await other.body.cancel();assert.equal(cancelled.calls.length,2);
});
