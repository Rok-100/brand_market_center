if (process.env.LOCAL_SIMULATION !== '1') throw new Error('Local simulation only');
// Local development identity only. Never expose this service outside the isolated network.
import {createServer} from 'node:http';
import {profiles,tokenFor,sessionFor} from './local-identities.mjs';
createServer(async(req,res)=>{
  const path = new URL(req.url, 'http://identity').pathname;
  let body={};
  if(req.method==='POST'){
    let raw='';for await(const part of req){raw+=part;if(raw.length>4096){res.writeHead(413);res.end();return;}}
    try{body=JSON.parse(raw||'{}');}catch{res.writeHead(400);res.end();return;}
  }
  const token=String(req.headers['x-oa-token']||req.headers.authorization?.replace(/^Bearer /,'')||String(req.headers.cookie||'').match(/(?:^|;\s*)wis_oa_session=([^;]+)/)?.[1]||'');
  const role=Object.keys(profiles).find(key=>tokenFor(key)===token)||(!token&&body.number?Object.keys(profiles).find(key=>profiles[key].number===body.number):null);
  const selected=sessionFor(role);
  const requestedModule=new URL(req.url,'http://identity').searchParams.get('module');
  if(path!=='/health'&&(!selected||(requestedModule&&!selected.access.allowed_modules.includes(requestedModule)))){
    res.writeHead(selected?403:401,{'Content-Type':'application/json'});res.end(JSON.stringify({allowed:false,detail:'本机测试身份未登录或未授权',localTest:true}));return;
  }
  const ok = (req.method==='GET' && ['/health','/api/central-auth/me','/api/auth/me','/userinfo','/auth/userinfo'].includes(path))
    || (req.method==='POST' && path==='/api/central-auth/me');
  const payload = path==='/health' ? {ok:true,mode:'local-test'} : path.endsWith('/userinfo') ?
    {code:0,msg:'local test identity',data:selected.user} : ok ? selected :
    {detail:'此接口尚未接入本机测试服务',localTest:true};
  res.writeHead(ok?200:503, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(JSON.stringify(payload));
}).listen(3000,'0.0.0.0');
