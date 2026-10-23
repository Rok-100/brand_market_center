// Page data only. Identity, permissions and administration responses are never cached.
export function createReadRequests({request,getSession,clock=Date.now,ttl=30000}) {
  const pending=new Map(),cache=new Map();
  let revision=0;
  const reusable=new Set(['courses','announcements']);
  function clear(){revision++;pending.clear();cache.clear();}
  const generations=new Map();
  function invalidate(paths){
    for(const path of paths){generations.set(path,(generations.get(path)||0)+1);for(const key of cache.keys())if(key.endsWith(':'+path))cache.delete(key);}
  }
  function prime(path,value){if(!reusable.has(path))return;const key=`${getSession()}:${revision}:${generations.get(path)||0}:${path}`;cache.set(key,{value,until:clock()+ttl});}
  async function read(path,options={}){
    const session=getSession(),version=revision,generation=generations.get(path)||0,key=`${session}:${version}:${generation}:${path}`;
    const saved=cache.get(key);
    if(saved&&saved.until>clock())return saved.value;
    if(pending.has(key))return pending.get(key);
    const work=Promise.resolve().then(()=>request(path,options)).then(value=>{
      if(reusable.has(path)&&session===getSession()&&version===revision&&generation===(generations.get(path)||0))cache.set(key,{value,until:clock()+ttl});
      return value;
    });
    pending.set(key,work);
    try{return await work;}finally{if(pending.get(key)===work)pending.delete(key);}
  }
  return {read,clear,invalidate,prime};
}
