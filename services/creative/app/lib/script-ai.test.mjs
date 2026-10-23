import test from 'node:test';
import assert from 'node:assert/strict';
import {generateAiScripts} from './script-ai.mjs';
const content='镜头1：梳妆台前\n画面：拿起产品\n口播：'+('根据真实产品资料介绍日常护理步骤，口吻自然，不承诺未经确认的效果。'.repeat(4));
test('generation forwards full case, requirements, rewrite mode and caller OA',async()=>{
  const input={product:'眼膜',scriptType:'付费KOC脚本',templateCopy:'完整参考稿'.repeat(100),requirements:'晚间场景',previousContent:'old draft'};
  const result=await generateAiScripts(input,{count:1,rewriteMode:'same-direction',avoidContents:['older draft']},new Headers({'cookie':'authorization=Bearer%20caller'}),{
    model:'fixture-model',generate:async(instruction,payload,opts)=>{
      assert.equal(payload.templateCopy,input.templateCopy);assert.equal(payload.requirements,'晚间场景');assert.equal(payload.previousContent,'old draft');assert.equal(payload.rewriteMode,'same-direction');assert.equal(opts.token,'caller');
      return {analysis:'模型分析',drafts:[{title:'新稿',content,creativeRoute:'新路线'}]};
    }
  });
  assert.equal(result.drafts[0].content,content);assert.equal(result.analysis,'模型分析');assert.equal(result.model,'fixture-model');
});
test('failed, empty or short generation never falls back to local templates',async()=>{
  const h=new Headers({'x-oa-token':'caller'});
  for(const result of [{drafts:[]},{drafts:[{title:'x',content:'too short'}]}]){
    await assert.rejects(generateAiScripts({}, {count:1}, h,{generate:async()=>result}),{status:502});
  }
  await assert.rejects(generateAiScripts({}, {count:1}, h,{generate:async()=>{throw Error('offline')}}),/offline/);
});
