import {createHash} from 'node:crypto';

const LIMIT=5*1024*1024;
export async function prepareMaterialPreviews(report,{db,config,appId,fetchImpl=fetch,tenantToken}) {
  const images={},results=[];
  if(report.materials?.status!=='ready')return {images,results};
  db.exec('CREATE TABLE IF NOT EXISTS intelligence_images(cache_key TEXT PRIMARY KEY,image_key TEXT NOT NULL,created_at TEXT NOT NULL)');
  const base=new URL(config.baseUrl);
  const allowed=new Set(['https://oss.fandow.com','https://finder.video.qq.com',base.origin]);
  const items=report.materials.items||[];
  async function one(item){
    const key=`${item.platform}:${item.id}`;
    for(const value of [...new Set([item.raw?.cover_url,item.coverUrl].filter(Boolean))]){
      let url;try{url=new URL(value,base);}catch{continue;}
      if(!allowed.has(url.origin)||url.username||url.password)continue;
      const hash=createHash('sha256').update(appId+':'+url.href).digest('hex');
      const cached=db.prepare('SELECT image_key FROM intelligence_images WHERE cache_key=?').get(hash);
      if(cached){images[key]=cached.image_key;results.push({id:item.id,state:'cached'});return;}
      try{
        const r=await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(10000),headers:url.origin===base.origin?{'X-API-Key':config.apiKey}:{}});
        const sourceType=(r.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
        // Finder serves valid JPEG covers as image/jpg; Feishu expects image/jpeg.
        const type=sourceType==='image/jpg'?'image/jpeg':sourceType;
        if(!r.ok||!['image/jpeg','image/png','image/webp','image/gif'].includes(type)||Number(r.headers.get('content-length'))>LIMIT){await r.body?.cancel();continue;}
        const reader=r.body.getReader(),chunks=[];let size=0;
        while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>LIMIT){await reader.cancel();throw Error('Image too large');}chunks.push(value);}
        if(!size)continue;
        const form=new FormData();form.set('image_type','message');form.set('image',new Blob(chunks,{type}),'preview.'+type.split('/')[1]);
        const upload=await fetchImpl('https://open.feishu.cn/open-apis/im/v1/images',{method:'POST',headers:{authorization:'Bearer '+await tenantToken()},body:form,redirect:'error',signal:AbortSignal.timeout(15000)});
        const data=await upload.json();
        if(!upload.ok||data.code!==0||!data.data?.image_key){results.push({id:item.id,state:'upload_failed',code:data.code??upload.status});return;}
        images[key]=data.data.image_key;
        db.prepare('INSERT OR REPLACE INTO intelligence_images VALUES(?,?,?)').run(hash,data.data.image_key,new Date().toISOString());
        results.push({id:item.id,state:'uploaded'});return;
      }catch{/* An unavailable cover must never prevent the business notification. */}
    }
    results.push({id:item.id,state:'link_only'});
  }
  for(let i=0;i<items.length;i+=3)await Promise.all(items.slice(i,i+3).map(one));
  return {images,results};
}
