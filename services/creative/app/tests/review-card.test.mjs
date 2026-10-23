import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';

const page=readFileSync('app/page.tsx','utf8');
function sourceFunction(name) {const start=page.indexOf(`function ${name}(`);const next=page.indexOf('\nfunction ',start+1);return page.slice(start,next<0?undefined:next);}
const code=ts.transpileModule(sourceFunction('Tag')+'\n'+sourceFunction('ReviewCard'),{compilerOptions:{jsx:ts.JsxEmit.React,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const ReviewCard=new Function('React','useState','useEffect','appUrl',code+'\nreturn ReviewCard;')(React,React.useState,React.useEffect,url=>url);
function render(status='pending_supervisor',viewer='USR-REVIEWER') {
 return renderToStaticMarkup(React.createElement(ReviewCard,{item:{id:'DR-PREVIEW',title:'眼膜体验分享脚本',content:'先从日常护肤体验聊起，分享自己的使用感受。\n\n这是用于检查终审界面的示例全文。',version:2,status,product:'眼膜',scriptType:'AI脚本',creatorId:'USR-AUTHOR',creatorName:'作者',authorName:'作者',teamLeadReviewerName:'组长',supervisorReviewerName:'主管',currentReviewerId:'USR-REVIEWER'},currentUser:{id:viewer,name:'主管',role:'supervisor'},onUpdate(){},onDeleted(){},onApproved(){},showToast(){}}));
}
test('the real review component renders the optional group field only for final reviewers',()=>{
 const html=render();assert.match(html,/终审通过后通知飞书群（可选）/);assert.match(html,/<datalist id="notify-chat-options-DR-PREVIEW"/);assert.match(html,/主管终审并归档/);
 assert.ok(!render('generated').includes('notify-chat-options'));
 assert.ok(!render('pending_supervisor','OTHER').includes('notify-chat-options'));
 if(process.env.REVIEW_PREVIEW_OUTPUT)writeFileSync(process.env.REVIEW_PREVIEW_OUTPUT,`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>终审群通知 · 界面验收</title><style>${readFileSync('app/globals.css','utf8')}</style><main class="page" style="max-width:1100px"><h1>审核与反馈</h1>${html}</main>`);
});
