// Protocol fixture, not speech recognition. Returns only labelled test candidates.
import http from 'node:http';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
if(process.env.LOCAL_SIMULATION!=='1')throw Error('Local simulation flag required');
const file='/data/cutter-tasks.json';
let state={localSimulation:true,tasks:{}};
try{state=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
if(state.localSimulation!==true)throw Error('Unmarked fixture state');
const results=[{time_range:'00:00:00-00:00:01',script_text:'【本机模拟】第一段测试文案。',scene_description:'合成测试画面'},
  {time_range:'00:00:01-00:00:03',script_text:'【本机模拟】第二段测试文案。',scene_description:'合成测试画面'}];
let queue=Promise.resolve();
http.createServer((req,res)=>{
  const operation=async()=>{
    const url=new URL(req.url,'http://cutter-fixture');let raw='';
    for await(const part of req){raw+=part;if(raw.length>32768)throw Error('Body too large');}
    const body=raw?JSON.parse(raw):{};
    const reply=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','X-Local-Simulation':'true'});
      res.end(JSON.stringify({code:status===200?0:1,localSimulation:true,data}));};
    if(url.pathname==='/health')return reply({ok:true});
    if(url.pathname==='/cutter/task'){
      const task=state.tasks[url.searchParams.get('task_id')];
      if(!task)return reply({message:'Unknown local task'},404);
      task.status='success';await fs.writeFile(file,JSON.stringify(state));return reply(task);
    }
    const source=String(body.oss_url||url.searchParams.get('oss_url')||'');
    let media;try{media=new URL(source);}catch{return reply({message:'Invalid local URL'},400);}
    if(media.origin!=='http://object-store:9000'||!media.pathname.startsWith('/wis-local-simulation/')||
       !decodeURIComponent(media.pathname).includes('local-simulation-'))
      return reply({message:'Only marked local test media accepted'},403);
    const id='local-cutter-'+createHash('sha256').update(media.pathname).digest('hex').slice(0,24);
    const fixtureResults=decodeURIComponent(media.pathname).includes('local-simulation-auto-')
      ? [0,1,2].map(i=>({time_range:`00:00:${String(i*10).padStart(2,'0')}-00:00:${String((i+1)*10).padStart(2,'0')}`,
          script_text:`【本机模拟】合成片段${['甲','乙','丙'][i]}，只验证流程。`,scene_description:'合成测试画面'}))
      : results;
    if(url.pathname==='/cutter/select'&&req.method==='GET')
      return reply({results:state.tasks[id]?.status==='success'?fixtureResults:[]});
    if(url.pathname==='/cutter/save'&&req.method==='POST'){
      state.tasks[id]??={task_id:id,status:'processing',localSimulation:true};
      await fs.writeFile(file,JSON.stringify(state));return reply(state.tasks[id]);
    }
    return reply({message:'Unknown fixture route'},404);
  };
  const next=queue.then(operation);queue=next.catch(()=>{});
  next.catch(()=>{if(!res.headersSent)res.writeHead(500);res.end('Local cutter fixture error');});
}).listen(3000,'0.0.0.0');
