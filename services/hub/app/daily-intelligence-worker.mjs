import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {IntelligenceStore} from './daily-intelligence-store.mjs';
import {reportWindow,nextRunAt,materialReport,competitorBoardsReport,unavailableCompetitors,COLLECTION_VERSION} from './daily-intelligence.mjs';
import {intelligenceCardMessages} from './daily-intelligence-card.mjs';
import {prepareMaterialPreviews} from './daily-intelligence-media.mjs';

export class IntelligenceWorker {
  constructor(store,{env=process.env,fetchImpl=fetch,clock=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
    Object.assign(this,{store,env,fetch:fetchImpl,clock,sleep}); this.busy=false;this.sending=false;this.token=null;
    // First install starts with the next 09:30, while restarts catch up at most
    // the latest missed window. Manual local tests have a separate stable key.
    if(!store.setting('installedAt'))store.setting('installedAt',clock());
  }
  config() {return JSON.parse(readFileSync(this.env.RADAR_CREDENTIALS_FILE,'utf8'));}
  recipient() {
    const target=JSON.parse(readFileSync(this.env.INTELLIGENCE_RECIPIENT_FILE,'utf8'));
    const app=JSON.parse(readFileSync(this.env.FEISHU_CREDENTIALS_FILE,'utf8'));
    if(target.type!=='open_id'||!/^ou_[a-zA-Z0-9]+$/.test(target.id)||target.employeeNumber!=='FD-227829'||target.appId!==app.appId)throw Error('接收人配置与崔经瀚的已核验应用身份不匹配，禁止发送');
    return target;
  }
  async readApi(url,headers) {
    const timeout=Math.min(90000,Number(this.env.RADAR_TIMEOUT_MS||30000));
    const deadline=this.clock()+100000;
    for(let attempt=0;attempt<4;attempt++) {
    const r=await this.fetch(url,{headers:{accept:'application/json',...headers},redirect:'error',signal:AbortSignal.timeout(Math.max(1,Math.min(timeout,deadline-this.clock())))});
    if(r.status===202) {
      const header=r.headers.get('retry-after'),seconds=Number(header),date=Date.parse(header||'');
      const delay=Math.max(5000,Number.isFinite(seconds)&&header?seconds*1000:Number.isFinite(date)?date-this.clock():5000);
      await r.body?.cancel();
      if(attempt===3||delay>60000||this.clock()+delay>=deadline)throw Error('来源榜单仍在生成（202），本期尚无可用快照');
      await this.sleep(delay);continue;
    }
    if(r.status===404)throw Error('来源接口尚未部署或地址不可用（HTTP 404）');
    if(!r.ok)throw Error(r.status===401||r.status===403?'接口授权失败，请补充服务端访问凭据':`来源接口 HTTP ${r.status}`);
    const raw=await r.text();if(Buffer.byteLength(raw)>8*1024*1024)throw Error('来源响应超出大小限制');return JSON.parse(raw);
    }
  }
  async collectMaterials(window) {
    const c=this.config(),url=new URL('/api/external/material-top8',c.baseUrl);
    url.searchParams.set('date',window.dataDate||window.start.slice(0,10));
    return materialReport(await this.readApi(url,{'X-API-Key':c.apiKey}),window,c.baseUrl);
  }
  async collectCompetitors(window) {
    const c=this.config();
    const url=new URL('/api/external/market-rankings',c.baseUrl);
    // All five boards use the same requested yesterday date. Preserve the
    // source's intraday snapshot hour within that day for today_sales.
    url.searchParams.set('date',window.dataDate||window.start.slice(0,10));
    return competitorBoardsReport(await this.readApi(url,{'X-API-Key':c.apiKey}),window,c.baseUrl);
  }
  testId(){return reportWindow(this.clock()).date+'-test-'+COLLECTION_VERSION;}
  async cardMessages(report,target){
    const hasCovers=report.materials?.status==='ready'&&report.materials.items.some(v=>v.raw?.cover_url||v.coverUrl);
    const preview=hasCovers?await prepareMaterialPreviews(report,{db:this.store.db,config:this.config(),appId:target.appId,fetchImpl:this.fetch,tenantToken:()=>this.tenantToken()}):{images:{}};
    return intelligenceCardMessages(report,target,{imageKeys:preview.images});
  }
  async run({test=false,send=false,retryIncomplete=false}={}) {
    const target=send?this.recipient():null;
    const now=this.clock(),window=reportWindow(now),id=test?this.testId():window.date;
    if(this.busy)throw Error('采集正在进行，请等待当前批次完成');
    const report=this.store.claim(id,window,test,now,retryIncomplete);
    if(!report){const existing=this.store.get(id);return {...existing,delivery:this.store.delivery(id),reused:true};}
    this.busy=true;
    try {
      const results=await Promise.allSettled([this.collectMaterials(window),this.collectCompetitors(window)]);
      results.forEach((result,i)=>{
        const key=i===0?'materials':'competitors';
        report[key]=result.status==='fulfilled'?result.value:{status:'failed',items:[],error:
          ['TimeoutError','AbortError'].includes(result.reason?.name)?'来源接口超时，未获取本窗口数据':
          /^接口授权失败|^来源接口|^来源榜单|^素材接口|^竞品|^来源响应/.test(result.reason?.message)?result.reason.message:'来源读取失败，保留此前批次，请核对接口与网络'};
        if(key==='competitors'&&result.status==='rejected')report[key]=unavailableCompetitors(report[key].error);
      });
      report.finishedAt=new Date(this.clock()).toISOString();
      report.state=report.materials.status==='ready'&&report.competitors.status==='ready'?'ready':
        [report.materials,report.competitors].some(s=>['ready','partial','stale'].includes(s.status))?'partial':'failed';
      report.collectionVersion=COLLECTION_VERSION;
      this.store.finish(report,send?{target,messages:await this.cardMessages(report,target)}:{});
      return report;
    }finally{this.busy=false;}
  }
  async tenantToken() {
    if(this.token?.until>this.clock())return this.token.value;
    const c=JSON.parse(readFileSync(this.env.FEISHU_CREDENTIALS_FILE,'utf8'));
    const r=await this.fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({app_id:c.appId,app_secret:c.appSecret}),
      redirect:'error',signal:AbortSignal.timeout(12000)});
    const d=await r.json();if(!r.ok||d.code!==0||!d.tenant_access_token)throw Error('飞书应用认证失败');
    this.token={value:d.tenant_access_token,until:this.clock()+Math.max(60,Number(d.expire||7200)-120)*1000};return this.token.value;
  }
  async flush() {
    if(this.sending||this.env.INTELLIGENCE_SEND_ENABLED!=='true')return;
    const target=this.recipient();
    this.store.cancelOtherRecipients(target);
    this.sending=true;
    try{for(let i=0;i<10;i++){
      const m=this.store.messageClaim(this.clock());if(!m)break;
      if(m.receive_id_type!==target.type||m.chat_id!==target.id){this.store.cancelOtherRecipients(target);continue;}
      let result;
      try{
        const token=await this.tenantToken();
        const r=await this.fetch('https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type='+encodeURIComponent(m.receive_id_type),{
          method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(15000),
          body:JSON.stringify({receive_id:m.chat_id,uuid:m.uuid,...(m.payload?JSON.parse(m.payload):{msg_type:'text',content:JSON.stringify({text:m.text})})})});
        const d=await r.json();
        if(r.ok&&d.code===0&&d.data?.message_id)result={state:'sent',messageId:d.data.message_id};
        else if([99991663,99991668].includes(d.code)){this.token=null;result={state:'retry',error:'飞书凭据需刷新，沿用原消息编号重试'};}
        else result={state:r.status===429||r.status>=500?'retry':'attention',error:'飞书发送失败，错误码 '+String(d.code??r.status)};
      }catch{result={state:'retry',error:'飞书结果未确认，沿用原消息编号重试'};}
      this.store.messageFinish(m,result,this.clock());
    }}finally{this.sending=false;}
  }
  async tick() {
    const window=reportWindow(this.clock());
    if(this.env.INTELLIGENCE_SCHEDULE_ENABLED==='true'&&window.endMs>=Number(this.store.setting('installedAt'))&&!this.busy) {
      await this.run({send:this.env.INTELLIGENCE_SEND_ENABLED==='true'});
    }
    await this.flush();
  }
  overview() {let recipient=null,target=null;try{target=this.recipient();recipient={name:target.name,employeeNumber:target.employeeNumber,type:target.type};}catch{}const data=this.store.overview();if(data.report&&target)data.report.delivery=this.store.delivery(data.report.id,target);return {...data,recipient,schedule:{enabled:this.env.INTELLIGENCE_SCHEDULE_ENABLED==='true',time:'09:30',timezone:'Asia/Shanghai',nextRunAt:nextRunAt(this.clock())},sendingEnabled:this.env.INTELLIGENCE_SEND_ENABLED==='true'};}
}

function same(a,b){const x=Buffer.from(a||''),y=Buffer.from(b||'');return x.length>0&&x.length===y.length&&timingSafeEqual(x,y);}
export function startWorker(env=process.env) {
  const store=new IntelligenceStore(resolve(env.INTELLIGENCE_DATA_DIR||'data/daily-intelligence','daily.sqlite'));
  const worker=new IntelligenceWorker(store,{env}),secret=readFileSync(env.INTELLIGENCE_INTERNAL_TOKEN_FILE,'utf8').trim();
  const json=(res,status,body)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(body));};
  const server=createServer(async(req,res)=>{
    if(req.url==='/health')return json(res,200,{ok:true,busy:worker.busy});
    if(!same(req.headers['x-intelligence-token'],secret))return json(res,401,{detail:'需要内部服务身份'});
    if(req.url==='/report'&&req.method==='GET')return json(res,200,worker.overview());
    if(req.url==='/send'&&req.method==='POST'){
      const report=store.overview().report;
      if(!report?.test||report.window.date!==reportWindow(worker.clock()).date||report.state==='running')return json(res,409,{detail:'请先完成本期测试采集'});
      if(env.INTELLIGENCE_SEND_ENABLED!=='true')return json(res,409,{detail:'飞书发送尚未启用'});
      let target;try{target=worker.recipient();}catch{return json(res,503,{detail:'指定接收人的飞书身份尚未正确配置，未发送'});}store.cancelOtherRecipients(target);
      store.enqueue(report,target,await worker.cardMessages(report,target));
      await worker.flush();return json(res,200,{delivery:store.delivery(report.id)});
    }
    if(req.url==='/run'&&req.method==='POST'){
      let raw='';for await(const part of req){raw+=part;if(raw.length>4096)return json(res,413,{detail:'请求过大'});}
      try{const input=JSON.parse(raw||'{}');const run=await worker.run({test:true,send:input.send===true,retryIncomplete:true});await worker.flush();return json(res,200,{...run,delivery:store.delivery(run.id)});}
      catch{return json(res,409,{detail:'当前采集未结束或请求无效，请查看批次状态'});}
    }
    json(res,404,{detail:'接口不存在'});
  });
  server.listen(Number(env.PORT||3000),env.BIND_ADDRESS||'0.0.0.0');
  const timer=setInterval(()=>void worker.tick().catch(()=>console.error('Daily intelligence cycle incomplete')),15000);
  const stop=async()=>{clearInterval(timer);server.close();while(worker.busy||worker.sending)await new Promise(r=>setTimeout(r,100));store.close();};
  process.once('SIGTERM',()=>void stop());process.once('SIGINT',()=>void stop());
  return {worker,server,store,stop};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))startWorker();
