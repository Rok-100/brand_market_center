import {readFileSync,writeFileSync,existsSync,chmodSync,mkdirSync,renameSync} from 'node:fs';
import {join} from 'node:path';
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {ensure,fail} from './dissection-store.mjs';

export const BASE='https://cloud.fandow.com/gpt/company-system-jump/v1';
export const SYSTEM='brand-market-center';
export function oaToken(headers){
  const direct=String(headers?.['x-oa-token']||'').trim();if(direct)return direct.replace(/^Bearer\s+/iu,'');
  for(const name of ['wis_oa_session','authorization','oa-authorization']){
    const part=String(headers?.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='));
    if(part)try{return decodeURIComponent(part.slice(name.length+1)).replace(/^Bearer\s+/iu,'');}catch{}
  }return '';
}
export class CredentialVault {
  constructor(root){mkdirSync(root,{recursive:true});chmodSync(root,0o700);this.file=join(root,'credential.enc');this.keyFile=join(root,'key');if(!existsSync(this.keyFile))writeFileSync(this.keyFile,randomBytes(32),{mode:0o600,flag:'wx'});this.key=readFileSync(this.keyFile);}
  save(value){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,iv);const data=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);const body=JSON.stringify({iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')});writeFileSync(this.file+'.tmp',body,{mode:0o600});renameSync(this.file+'.tmp',this.file);}
  read(){if(!existsSync(this.file))return null;const v=JSON.parse(readFileSync(this.file,'utf8')),decipher=createDecipheriv('aes-256-gcm',this.key,Buffer.from(v.iv,'base64'));decipher.setAuthTag(Buffer.from(v.tag,'base64'));return JSON.parse(Buffer.concat([decipher.update(Buffer.from(v.data,'base64')),decipher.final()]).toString('utf8'));}
}
export async function videoModels(token,fetchImpl=fetch){
  ensure(token,'请使用本人 OA 账号登录后授权自动拉片',401);
  const r=await fetchImpl(BASE+'/models',{headers:{Authorization:'Bearer '+token,sys_name:SYSTEM},redirect:'error',signal:AbortSignal.timeout(20000)});
  ensure(r.ok,r.status===401||r.status===403?'公司 AI 凭证已过期，请重新登录并授权':'公司模型列表暂不可用',r.status===401||r.status===403?401:503);
  const d=await r.json();ensure(d.code===0&&Array.isArray(d.data?.models),'公司模型列表格式异常',502);
  return d.data.models.filter(m=>Number(m.is_use_video)===1).map(m=>({name:m.model_name,manufacturer:m.manufacturer||'',ratio:m.ratio||''}));
}
export function parseModelObject(raw){
  const text=raw.trim().replace(/^```(?:json)?\s*/iu,'').replace(/\s*```$/u,'');
  try{return JSON.parse(text);}catch{}
  // Some company video models emit single quoted strings. Normalize string
  // delimiters only; never invent fields, complete truncated data or evaluate code.
  let normalized='';
  for(let i=0;i<text.length;i++){
    const quote=text[i];
    if(quote!=='"'&&quote!=="'"){normalized+=quote;continue;}
    if(quote==='"'){
      normalized+=quote;let closed=false;
      while(++i<text.length){const ch=text[i];normalized+=ch;if(ch==='\\'){if(++i>=text.length)throw Error('Incomplete string');normalized+=text[i];}else if(ch==='"'){closed=true;break;}}
      if(!closed)throw Error('Incomplete string');
    }else{
      let string='"',closed=false;
      while(++i<text.length){const ch=text[i];if(ch==="'"){closed=true;break;}if(ch==='\\'){if(++i>=text.length)throw Error('Incomplete escape');string+=text[i]==="'"?"'":'\\'+text[i];}else string+=ch==='"'?'\\"':ch;}
      if(!closed)throw Error('Incomplete string');normalized+=JSON.stringify(JSON.parse(string+'"'));
    }
  }
  return JSON.parse(normalized);
}
export async function completion(messages,{token,model,maxTokens=16000,fetchImpl=fetch,onResponse}={}){
  const r=await fetchImpl(BASE+'/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+token,sys_name:SYSTEM,'Content-Type':'application/json',Accept:'text/event-stream'},redirect:'error',signal:AbortSignal.timeout(360000),body:JSON.stringify({model,messages,stream:true,temperature:0.2,max_tokens:maxTokens,extra_body:{thinking:{type:'disabled'}}})});
  ensure(r.ok,r.status===401||r.status===403?'公司 AI 凭证已过期，请重新授权':`视频模型调用失败（HTTP ${r.status}）`,r.status===401||r.status===403?401:502);
  let result='',stop=false,done=false,buffer='',bytes=0;
  const event=raw=>{const text=raw.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trim()).join('\n');if(!text)return;if(text==='[DONE]'){done=true;return;}let d;try{d=JSON.parse(text);}catch{throw fail('模型流式格式异常',502);}ensure(!d.error&&(d.code===undefined||d.code===0),'视频模型返回错误',502);const c=d.choices?.find(c=>c.index===0)||d.choices?.[0];if(!c)return;if(c.finish_reason){ensure(c.finish_reason==='stop','模型结果被截断，请重试',502);stop=true;}if(typeof c.delta?.content==='string')result+=c.delta.content;};
  if((r.headers.get('content-type')||'').includes('text/event-stream')){
    const reader=r.body.getReader(),decoder=new TextDecoder();try{while(!done){const chunk=await reader.read();if(chunk.done){buffer+=decoder.decode();break;}bytes+=chunk.value.byteLength;ensure(bytes<3000000,'模型响应过大',502);buffer+=decoder.decode(chunk.value,{stream:true});let match;while((match=/\r?\n\r?\n/u.exec(buffer))){event(buffer.slice(0,match.index).replace(/\r\n/gu,'\n'));buffer=buffer.slice(match.index+match[0].length);if(done)break;}}if(buffer.trim()&&!done)event(buffer.replace(/\r\n/gu,'\n'));}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}ensure(done&&stop,'模型连接中断，未生成完整拉片结果',502);
  }else{const d=await r.json();ensure(!d.error&&(d.code===undefined||d.code===0),'模型返回错误',502);ensure(d.choices?.[0]?.finish_reason==='stop','模型结果不完整',502);result=d.choices[0].message?.content;}
  ensure(typeof result==='string'&&result.trim(),'视频模型未返回内容',502);
  onResponse?.(result);
  try{const value=parseModelObject(result);ensure(value&&typeof value==='object'&&!Array.isArray(value),'模型结果格式错误',502);return value;}catch(error){if(error.status)throw error;throw fail('视频模型未返回合法 JSON',502);}
}
export function runProcess(command,args,{input,timeout=120000,maxBytes=2000000}={}){
  return new Promise((resolve,reject)=>{const executable=process.env.DISSECTION_MEDIA_BIN?join(process.env.DISSECTION_MEDIA_BIN,command):process.platform==='win32'&&command==='python3'?'python':command;const child=spawn(executable,args,{stdio:['pipe','pipe','pipe'],windowsHide:true,env:process.platform==='win32'?{...process.env,PYTHONIOENCODING:'utf-8',PYTHONUTF8:'1'}:process.env});child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');let out='',err='',settled=false;const timer=setTimeout(()=>{child.kill('SIGKILL');finish(fail('媒体处理超时',502));},timeout);const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(value);};child.on('error',()=>finish(fail('媒体处理组件不可用',503)));child.stdout.on('data',d=>{out+=d.toString();if(Buffer.byteLength(out)>maxBytes){child.kill('SIGKILL');finish(fail('媒体输出过大',502));}});child.stderr.on('data',d=>{err=(err+d.toString()).slice(-2000);});child.on('close',code=>finish(code===0?null:fail(command==='python3'?'分镜时间轴校验失败：'+out.slice(0,800):'视频媒体处理失败',502),out));if(input)child.stdin.end(input);else child.stdin.end();});
}
export function validateEvaluation(value,segments){
  const a=value.assessment;ensure(a&&Number.isFinite(a.score)&&a.score>=0&&a.score<=100,'复刻评分格式异常',502);
  ensure(['high','medium','low'].includes(a.value)&&typeof a.reason==='string'&&a.reason.trim().length>=10,'复刻价值判断不完整',502);
  for(const k of ['hooks','reusableElements','adaptationPlan','risks','productionRequirements'])ensure(Array.isArray(a[k])&&a[k].length>0&&a[k].length<=20&&a[k].every(x=>typeof x==='string'&&x.length>0&&x.length<=2000),`复刻评估缺少 ${k}`,502);
  ensure(typeof a.summary==='string'&&a.summary.trim(),'复刻总结缺失',502);
  ensure(segments.every(s=>s.scene_description&&s.script_text!==undefined),'拉片画面字段缺失',502);
  return {score:a.score,value:a.value,reason:a.reason.slice(0,3000),summary:a.summary.slice(0,3000),...Object.fromEntries(['hooks','reusableElements','adaptationPlan','risks','productionRequirements'].map(k=>[k,a[k]]))};
}
