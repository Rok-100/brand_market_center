import {readFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
const configuration=JSON.parse(readFileSync('/run/pinying-r2-startup.json','utf8'));
const response=await fetch(configuration.url+'/intelligence/creative_r2',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+configuration.token},body:JSON.stringify({id:randomUUID(),method:'restoreR2Cache',args:[]}),signal:AbortSignal.timeout(30000),redirect:'manual'});
if(!response.ok)throw new Error('Media metadata recovery failed');
const child=spawn(configuration.command[0],configuration.command.slice(1),{stdio:'inherit',env:process.env});
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>child.kill(signal));
child.on('error',()=>process.exit(1));child.on('exit',(code,signal)=>process.exit(code??(signal?1:0)));
