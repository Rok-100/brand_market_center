// Limited local S3 protocol fixture. Signature correctness is not simulated.
import http from 'node:http';
import fs from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
if(process.env.LOCAL_SIMULATION!=='1')throw new Error('Local simulation required');
const root='/data/objects';
await fs.mkdir(root,{recursive:true});
const xml=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const hash=s=>createHash('sha256').update(s).digest('hex');
const multipart='/data/multipart';
await fs.mkdir(multipart,{recursive:true});
const readBody=async(req,limit)=>{
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>limit)throw Object.assign(new Error('EntityTooLarge'),{http:413});chunks.push(chunk);}
  return Buffer.concat(chunks);
};
const unxml=s=>s.replaceAll('&quot;','"').replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&');
http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://object-store:9000');
  const send=(status,body='',headers={})=>{res.writeHead(status,{'x-local-simulation':'true',...headers});res.end(body);};
  const error=(status,code)=>send(status,`<Error><Code>${code}</Code></Error>`,{'Content-Type':'application/xml'});
  try{
    if(url.pathname==='/health')return send(200,'local-simulation');
    const credential=url.searchParams.get('X-Amz-Credential')||req.headers.authorization||'';
    if(!credential.includes('local-simulation'))return error(403,'AccessDenied');
    const segments=decodeURIComponent(url.pathname).split('/').slice(1);
    const bucket=segments.shift(),key=segments.join('/');
    if(bucket!=='wis-local-simulation')return error(404,'NoSuchBucket');
    if(segments.some(s=>s==='..'||s==='.'||s.includes('\\')))return error(400,'InvalidKey');
    if(!key && req.method==='GET'){
      const prefix=url.searchParams.get('prefix')||'';
      const rows=[];
      for(const name of await fs.readdir(root))if(name.endsWith('.json')){
        const m=JSON.parse(await fs.readFile(root+'/'+name));
        if(m.key.startsWith(prefix))rows.push(`<Contents><Key>${xml(m.key)}</Key><LastModified>${m.modified}</LastModified><ETag>${xml(m.etag)}</ETag><Size>${m.size}</Size><StorageClass>STANDARD</StorageClass></Contents>`);
      }
      return send(200,`<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>${bucket}</Name><Prefix>${xml(prefix)}</Prefix><KeyCount>${rows.length}</KeyCount><MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated>${rows.join('')}</ListBucketResult>`,{'Content-Type':'application/xml'});
    }
    if(!key)return error(400,'InvalidKey');
    const file=root+'/'+hash(key);
    const namespace=' xmlns="http://s3.amazonaws.com/doc/2006-03-01/"';
    if(url.searchParams.has('uploads')){
      if(req.method!=='POST')return error(405,'MethodNotAllowed');
      const id=randomUUID(),dir=multipart+'/'+id;
      await fs.mkdir(dir);await fs.writeFile(dir+'/meta.json',JSON.stringify({localSimulation:true,key,type:req.headers['content-type']||'application/octet-stream'}));
      return send(200,`<InitiateMultipartUploadResult${namespace}><Bucket>${bucket}</Bucket><Key>${xml(key)}</Key><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`,{'Content-Type':'application/xml'});
    }
    if(url.searchParams.has('uploadId')){
      const id=url.searchParams.get('uploadId');
      if(!/^[a-f0-9-]{36}$/.test(id))return error(404,'NoSuchUpload');
      const dir=multipart+'/'+id;
      let meta;try{meta=JSON.parse(await fs.readFile(dir+'/meta.json'));}catch(e){if(e.code==='ENOENT')return error(404,'NoSuchUpload');throw e;}
      if(meta.localSimulation!==true||meta.key!==key)return error(404,'NoSuchUpload');
      if(req.method==='DELETE'){
        // Only verified fixture-owned files directly inside this UUID directory.
        for(const name of await fs.readdir(dir))await fs.unlink(dir+'/'+name);
        await fs.rmdir(dir);return send(204);
      }
      if(req.method==='PUT'){
        const number=Number(url.searchParams.get('partNumber'));
        if(!Number.isInteger(number)||number<1||number>10000)return error(400,'InvalidArgument');
        const body=await readBody(req,32*1024*1024),md5=createHash('md5').update(body);
        const digest=md5.digest(),etag='"'+digest.toString('hex')+'"';
        if(req.headers['content-md5']&&req.headers['content-md5']!==digest.toString('base64'))return error(400,'BadDigest');
        const temporary=dir+'/'+number+'.'+randomUUID();await fs.writeFile(temporary,body);await fs.rename(temporary,dir+'/'+number);
        return send(200,'',{ETag:etag});
      }
      if(req.method==='GET'){
        const numbers=(await fs.readdir(dir)).filter(n=>/^\d+$/.test(n)).map(Number).sort((a,b)=>a-b);
        const rows=[];
        for(const n of numbers){const body=await fs.readFile(dir+'/'+n),stat=await fs.stat(dir+'/'+n);rows.push(`<Part><PartNumber>${n}</PartNumber><LastModified>${stat.mtime.toISOString()}</LastModified><ETag>${xml('"'+createHash('md5').update(body).digest('hex')+'"')}</ETag><Size>${body.length}</Size></Part>`);}
        return send(200,`<ListPartsResult${namespace}><Bucket>${bucket}</Bucket><Key>${xml(key)}</Key><UploadId>${id}</UploadId><IsTruncated>false</IsTruncated>${rows.join('')}</ListPartsResult>`,{'Content-Type':'application/xml'});
      }
      if(req.method==='POST'){
        const input=(await readBody(req,1024*1024)).toString('utf8');
        const requested=[...input.matchAll(/<Part>([\s\S]*?)<\/Part>/g)].map(m=>({number:Number(m[1].match(/<PartNumber>(\d+)<\/PartNumber>/)?.[1]),etag:unxml(m[1].match(/<ETag>([\s\S]*?)<\/ETag>/)?.[1]||'')}));
        if(!requested.length)return error(400,'InvalidPart');
        const chunks=[],digests=[];let size=0,previous=0;
        for(let i=0;i<requested.length;i++){
          const part=requested[i];if(!Number.isInteger(part.number)||part.number<=previous||part.number>10000)return error(400,'InvalidPartOrder');previous=part.number;
          let body;try{body=await fs.readFile(dir+'/'+part.number);}catch(e){if(e.code==='ENOENT')return error(400,'InvalidPart');throw e;}
          const digest=createHash('md5').update(body).digest();
          if(part.etag.replaceAll('"','')!==digest.toString('hex'))return error(400,'InvalidPart');
          if(i<requested.length-1&&body.length<5*1024*1024)return error(400,'EntityTooSmall');
          size+=body.length;if(size>128*1024*1024)return error(413,'EntityTooLarge');
          chunks.push(body);digests.push(digest);
        }
        const etag='"'+createHash('md5').update(Buffer.concat(digests)).digest('hex')+'-'+requested.length+'"';
        const temporary=file+'.'+randomUUID();await fs.writeFile(temporary,Buffer.concat(chunks));await fs.rename(temporary,file);
        await fs.writeFile(file+'.json',JSON.stringify({localSimulation:true,key,size,etag,type:meta.type,modified:new Date().toISOString()}));
        for(const name of await fs.readdir(dir))await fs.unlink(dir+'/'+name);
        await fs.rmdir(dir);
        return send(200,`<CompleteMultipartUploadResult${namespace}><Bucket>${bucket}</Bucket><Key>${xml(key)}</Key><ETag>${xml(etag)}</ETag></CompleteMultipartUploadResult>`,{'Content-Type':'application/xml'});
      }
      return error(405,'MethodNotAllowed');
    }
    if(req.method==='PUT'){
      const chunks=[];let size=0;
      for await(const part of req){size+=part.length;if(size>32*1024*1024)return error(413,'EntityTooLarge');chunks.push(part);}
      const body=Buffer.concat(chunks),etag='"'+createHash('md5').update(body).digest('hex')+'"';
      if(req.headers['content-md5'] && req.headers['content-md5']!==createHash('md5').update(body).digest('base64'))return error(400,'BadDigest');
      const m={localSimulation:true,key,size,etag,type:req.headers['content-type']||'application/octet-stream',modified:new Date().toISOString()};
      const temp=file+'.'+randomUUID();await fs.writeFile(temp,body);await fs.rename(temp,file);
      await fs.writeFile(file+'.json',JSON.stringify(m));
      return send(200,'',{ETag:etag});
    }
    if(!['GET','HEAD','DELETE'].includes(req.method))return error(501,'NotImplemented');
    let m;try{m=JSON.parse(await fs.readFile(file+'.json'));}catch(e){if(e.code==='ENOENT')return error(404,'NoSuchKey');throw e;}
    if(m.localSimulation!==true)throw new Error('Unmarked object');
    if(req.method==='DELETE'){await fs.unlink(file);await fs.unlink(file+'.json');return send(204);}
    const headers={'Content-Type':m.type,'Content-Length':m.size,ETag:m.etag,'Last-Modified':new Date(m.modified).toUTCString(),'Accept-Ranges':'bytes'};
    if(req.method==='HEAD')return send(200,'',headers);
    const body=await fs.readFile(file);
    const range=req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    if(range){const start=Number(range[1]),end=Math.min(Number(range[2]||body.length-1),body.length-1);if(start>end)return error(416,'InvalidRange');return send(206,body.subarray(start,end+1),{...headers,'Content-Length':end-start+1,'Content-Range':`bytes ${start}-${end}/${body.length}`});}
    return send(200,body,headers);
  }catch(e){console.error('Local object fixture:',e.code||e.message);if(!res.headersSent)error(e.http||500,e.http?e.message:'InternalError');else res.end();}
}).listen(9000,'0.0.0.0');
