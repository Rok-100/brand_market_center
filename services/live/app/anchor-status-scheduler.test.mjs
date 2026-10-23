import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const server=await readFile(new URL('./server.js',import.meta.url),'utf8');
const start=server.indexOf('    const statusWork = () =>');
const end=server.indexOf('    setTimeout(statusWork,',start);
const callback=server.slice(start,end);
test('background catch-up advances with the current hour even if profile recording refresh is blocked at an old slot',async()=>{
  let slot='2026-10-07T09:15';const seen=[];
  const service={status:()=>({lastSlot:'2026-10-07T00:15'}),tick:async value=>seen.push(value)};
  const work=new Function('anchorStatusService','anchorRecordingSlot',callback+'return statusWork;')(service,()=>slot);
  await work();slot='2026-10-07T10:15';await work();
  assert.deepEqual(seen,['2026-10-07T09:15','2026-10-07T10:15']);
});
