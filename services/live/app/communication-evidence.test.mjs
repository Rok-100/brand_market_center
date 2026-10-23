import test from 'node:test';import assert from 'node:assert/strict';
import {communicationEvidenceText} from './communication-evidence.mjs';
test('historical price cannot override missing current price',()=>{
 const text=communicationEvidenceText('日常价169元，40片。售价：199。￥128。产品保湿说明。');
 assert.doesNotMatch(text,/169|199|128/);assert.match(text,/保湿说明/);
});
test('verified operator input keeps evidence while absent gifts are omitted',()=>{
 assert.equal(communicationEvidenceText('日常价169元。',{price:'169元'}),'日常价169元。');
 assert.doesNotMatch(communicationEvidenceText('加赠2支小样。产品说明。'),/2支/);
});
