import test from 'node:test';import assert from 'node:assert/strict';
import {createFeishuMediaFetcher} from './feishu-media-range.mjs';
test('browser open range and tail seek are converted to bounded Feishu ranges',async()=>{
 const ranges=[];let cancelled=0;const fetcher=createFeishuMediaFetcher({fetchImpl:async(_url,o)=>{ranges.push(o.headers.Range);assert.match(o.headers.Range,/^bytes=\d+-\d+$/);return {ok:true,status:206,headers:new Headers({'content-range':'bytes 0-0/10000000'}),body:{cancel:async()=>cancelled++}}}});
 await fetcher('https://open.feishu.cn/media','fixture','bytes=0-');
 await fetcher('https://open.feishu.cn/media','fixture','bytes=9999000-');
 await fetcher('https://open.feishu.cn/media','fixture','bytes=-100');
 assert.deepEqual(ranges,['bytes=0-0','bytes=0-4194303','bytes=9999000-9999999','bytes=9999900-9999999']);assert.equal(cancelled,1);
});
test('explicit ranges and full downloads are preserved; invalid ranges fail',async()=>{
 const ranges=[];const fetcher=createFeishuMediaFetcher({fetchImpl:async(_u,o)=>{ranges.push(o.headers.Range);return {ok:true}}});
 await fetcher('https://open.feishu.cn/media','fixture','bytes=1-1024');await fetcher('https://open.feishu.cn/media','fixture');assert.deepEqual(ranges,['bytes=1-1024',undefined]);
 await assert.rejects(fetcher('url','fixture','bytes=0-1,4-9'),{status:416});
});
