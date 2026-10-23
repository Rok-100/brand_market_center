import {extname} from 'node:path';
const documentExtensions=new Set('.pdf .doc .docx .txt .md .csv .xls .xlsx .ppt .pptx .png .jpg .jpeg .webp .gif .zip'.split(' '));
const visualExtensions=new Set('png jpg jpeg webp gif bmp tif tiff heic svg pdf txt md csv psd ai eps doc docx xls xlsx ppt pptx zip rar 7z mp4 mov webm mp3 wav m4a'.split(' ').map(x=>'.'+x));
const images=new Set(['.png','.jpg','.jpeg','.webp','.gif']);
export const materialKinds=new Set(['cue-card','prohibited-word','visual','competitor','communication']);
export const materialPreviewTypes={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.bmp':'image/bmp','.mp4':'video/mp4','.mov':'video/quicktime','.webm':'video/webm','.mp3':'audio/mpeg','.wav':'audio/wav','.m4a':'audio/mp4','.pdf':'application/pdf','.txt':'text/plain; charset=utf-8','.md':'text/plain; charset=utf-8','.csv':'text/plain; charset=utf-8'};
const reject=(message,status=422)=>{throw Object.assign(new Error(message),{status})};
export function decodeMaterialUpload(body){
 const kind=body?.kind;if(!materialKinds.has(kind))reject('未知素材类型。');
 const name=String(body.name||'').split(/[\\/]/u).at(-1).replace(/[\x00-\x1f]/gu,'').trim().slice(0,180),extension=extname(name).toLowerCase();
 const allowed=kind==='visual'?visualExtensions:kind==='cue-card'?images:documentExtensions;
 if(!allowed.has(extension))reject(kind==='cue-card'?'直播手卡支持 PNG、JPG、WEBP 或 GIF 图片。':'不支持此文件格式，请选择图片、文档、表格或支持的压缩包。');
 const match=String(body.dataUrl||'').match(/^data:[^;,]*;base64,([A-Za-z0-9+/]*={0,2})$/u);
 if(!match)reject('请选择本地文件后上传。');
 const content=Buffer.from(match[1],'base64'),limit=kind==='visual'?50:10;
 if(!content.length||content.length>limit*1024*1024)reject(`文件为空或超过 ${limit}MB。`,413);
 if(images.has(extension)){
  const valid=extension==='.png'?content.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):['.jpg','.jpeg'].includes(extension)?content[0]===255&&content[1]===216:extension==='.gif'?/^GIF8[79]a/u.test(content.subarray(0,6).toString()):content.subarray(0,4).toString()==='RIFF'&&content.subarray(8,12).toString()==='WEBP';
  if(!valid)reject('图片内容与格式不符，请重新导出后上传。');
 }
 return {name,extension,content,category:String(body.category||'未分类').trim().slice(0,60),mime:materialPreviewTypes[extension]||'application/octet-stream'};
}
