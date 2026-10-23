import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync,existsSync,appendFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import ts from 'typescript';

// Execute the real route code, Drizzle, and SQL transactions with isolated data.
async function fixture() {
 const sqlite=new DatabaseSync(':memory:');let user={id:'USR-TEST',name:'测试人',role:'contributor'};
 class Statement {
  constructor(sql,params=[]){this.sql=sql;this.params=params;}
  bind(...params){return new Statement(this.sql,params);}
  async all(){const s=sqlite.prepare(this.sql);const results=s.columns().length?s.all(...this.params):[];if(!s.columns().length)s.run(...this.params);return {results,success:true,meta:{}};}
  async run(){return this.all();}
  async first(){return (await this.all()).results[0]??null;}
  async raw(){return (await this.all()).results.map(Object.values);}
 }
 const d1={prepare:sql=>new Statement(sql),async batch(statements){if(process.env.CAPTURE_SQL_FILE)appendFileSync(process.env.CAPTURE_SQL_FILE,JSON.stringify(statements.map(s=>({sql:s.sql,params:s.params})))+'\n');sqlite.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.all());sqlite.exec('COMMIT');return result;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 const context=vm.createContext({console,Request,Response,URL,crypto,TextEncoder,Date,JSON,Set,Map});const cache=new Map();
 function synthetic(key,values){if(cache.has(key))return cache.get(key);const m=new vm.SyntheticModule(Object.keys(values),function(){for(const [k,v] of Object.entries(values))this.setExport(k,v);},{context,identifier:key});cache.set(key,m);return m;}
 async function load(spec,parent=resolve('fixture.mjs')){
  if(spec==='cloudflare:workers')return synthetic(spec,{env:{DB:d1}});
  if(spec.endsWith('/current-user'))return synthetic('identity',{getCurrentUser:async()=>user,isManager:u=>u.role==='admin'});
  if(spec.endsWith('/script-ai.mjs'))return synthetic('ai',{generateAiScripts:async()=>({drafts:[{title:'模型生成标题',content:'完整的模型脚本正文，需要发送到发起人的飞书卡片中。\n\n最后一句。',creativeRoute:'测试'}],analysis:'test',model:'fixture'})});
  if(!spec.startsWith('.')&&!spec.startsWith('/'))return synthetic(spec,await import(spec));
  let path=resolve(dirname(parent),spec);if(!existsSync(path)||!path.match(/\.(ts|mjs)$/)){path=existsSync(path+'.ts')?path+'.ts':resolve(path,'index.ts');}
  if(cache.has(path))return cache.get(path);
  let source=readFileSync(path,'utf8');if(path.endsWith('.ts'))source=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
  const mod=new vm.SourceTextModule(source,{context,identifier:path});cache.set(path,mod);await mod.link((s,m)=>load(s,m.identifier));return mod;
 }
 const post=await load('./app/api/scripts/route.ts');await post.evaluate();
 const patch=await load('./app/api/scripts/[id]/route.ts');await patch.evaluate();
 const chats=await load('./app/api/scripts/notification-chats/route.ts');await chats.evaluate();
 const request=(body,method='POST')=>new Request('http://test/api/scripts',{method,headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 return {sqlite,setUser:u=>{user=u;},create:()=>post.namespace.POST(request({product:'眼膜',scriptType:'AI脚本',requirements:'测试生成全文'})),patch:(id,p)=>patch.namespace.PATCH(request(p,'PATCH'),{params:Promise.resolve({id})}),chats:()=>chats.namespace.GET(new Request('http://test/api/scripts/notification-chats'))};
}
test('initial AI result and notification snapshot commit together',async()=>{
 const f=await fixture();const response=await f.create();assert.equal(response.status,201,await response.clone().text());
 const {drafts}=await response.json();const n=f.sqlite.prepare('SELECT * FROM notifications').all();assert.equal(n.length,1);assert.equal(n[0].user_id,'USR-TEST');
 const snapshot=JSON.parse(f.sqlite.prepare('SELECT payload FROM script_notification_payloads').get().payload);assert.equal(snapshot.content,drafts[0].content);
});
test('AI suggestion includes generated candidate rather than old draft',async()=>{
 const f=await fixture();const {drafts:[draft]}=await (await f.create()).json();
 const r=await f.patch(draft.id,{action:'regenerate',feedback:'重新修改开头'});assert.equal(r.status,200,await r.clone().text());const {alternative}=await r.json();
 const snapshot=JSON.parse(f.sqlite.prepare('SELECT payload FROM script_notification_payloads WHERE notification_id LIKE ?').get('SN-'+alternative.id+'-%').payload);assert.equal(snapshot.content,alternative.content);assert.equal(snapshot.kind,'alternative');
});
test('final approval saves edited full script and group option atomically, duplicate approval does not send twice',async()=>{
 const f=await fixture();const {drafts:[draft]}=await (await f.create()).json();f.sqlite.prepare("UPDATE creative_drafts SET status='pending_supervisor',current_reviewer_id='USR-TEST' WHERE id=?").run(draft.id);
 const content='终审现场修改后的完整脚本。\n必须发送这一版而非 AI 初稿。',chatId='oc_1234567890abcdef';
 const r=await f.patch(draft.id,{action:'supervisor_approve',content,notificationChatId:chatId});assert.equal(r.status,200,await r.clone().text());
 assert.equal(f.sqlite.prepare('SELECT copy FROM creative_scripts WHERE archived_from_draft_id=?').get(draft.id).copy,content);
 const payload=JSON.parse(f.sqlite.prepare('SELECT payload FROM script_notification_payloads WHERE notification_id LIKE ?').get('SN-FINAL-'+draft.id+'-%').payload);assert.equal(payload.content,content);assert.equal(payload.chatId,chatId);assert.equal(payload.version,2);
 assert.deepEqual((await (await f.chats()).json()).chatIds,[chatId]);
 const count=f.sqlite.prepare('SELECT COUNT(*) AS n FROM notifications').get().n;
 assert.equal((await f.patch(draft.id,{action:'supervisor_approve',notificationChatId:chatId})).status,409);assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM notifications').get().n,count);
 f.sqlite.prepare('DELETE FROM creative_drafts WHERE id=?').run(draft.id);assert.deepEqual((await (await f.chats()).json()).chatIds,[chatId]);
 f.setUser({id:'OTHER',name:'其他人',role:'contributor'});assert.deepEqual((await (await f.chats()).json()).chatIds,[]);
});
test('blank group, invalid group and unauthorized approval',async()=>{
 const f=await fixture();const {drafts:[draft]}=await (await f.create()).json();f.sqlite.prepare("UPDATE creative_drafts SET status='pending_supervisor',current_reviewer_id='USR-TEST' WHERE id=?").run(draft.id);
 assert.equal((await f.patch(draft.id,{action:'supervisor_approve',notificationChatId:'wrong'})).status,400);assert.equal(f.sqlite.prepare('SELECT status FROM creative_drafts WHERE id=?').get(draft.id).status,'pending_supervisor');
 f.setUser({id:'OTHER',name:'其他人',role:'contributor'});assert.equal((await f.patch(draft.id,{action:'supervisor_approve',notificationChatId:'oc_1234567890abcdef'})).status,403);
 f.setUser({id:'USR-TEST',name:'测试人',role:'contributor'});assert.equal((await f.patch(draft.id,{action:'supervisor_approve',notificationChatId:''})).status,200);assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM script_notification_chats').get().n,0);
});
test('outbox write failure rolls back generated drafts and final archive',async()=>{
 const f=await fixture();await f.create();f.sqlite.exec("CREATE TRIGGER fail_outbox BEFORE INSERT ON script_notification_payloads BEGIN SELECT RAISE(ABORT,'fixture failure'); END;");
 const before=f.sqlite.prepare('SELECT COUNT(*) AS n FROM creative_drafts').get().n;assert.equal((await f.create()).status,500);assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM creative_drafts').get().n,before);
 const draft=f.sqlite.prepare('SELECT id FROM creative_drafts').get();f.sqlite.prepare("UPDATE creative_drafts SET status='pending_supervisor',current_reviewer_id='USR-TEST' WHERE id=?").run(draft.id);
 assert.equal((await f.patch(draft.id,{action:'supervisor_approve',notificationChatId:'oc_1234567890abcdef'})).status,500);assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM creative_scripts WHERE archived_from_draft_id=?').get(draft.id).n,0);assert.equal(f.sqlite.prepare('SELECT status FROM creative_drafts WHERE id=?').get(draft.id).status,'pending_supervisor');
});
