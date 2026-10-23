import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
const source=await readFile(new URL('./public/coco-links.js',import.meta.url),'utf8');
for(const pathname of ['/yxb/wis-marketing-hub/modules/live-room-management/modules/materials/material-scripts.html','/fd-027340/live-center-workbench/modules/materials/material-scripts.html']){
 test('Feishu documents stay inside live module: '+pathname,()=>{
  const link={href:'https://jqx28l0j4lx.feishu.cn/wiki/TestDocument',dataset:{}};
  const document={readyState:'complete',documentElement:{},querySelectorAll:s=>s==='a[href]'?[link]:[]};
  runInNewContext(source,{document,location:{pathname,href:'https://hub.fandow.com'+pathname},URL,MutationObserver:class{observe(){}}});
  assert.equal(link.href,pathname.slice(0,pathname.lastIndexOf('/modules/'))+'/api/feishu/view?url='+encodeURIComponent('https://jqx28l0j4lx.feishu.cn/wiki/TestDocument'));
 });
}
