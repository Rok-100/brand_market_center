import { CATEGORIES, fail, hash, safeUrl, strictKeys, text } from './model.mjs';

export function validateCourseCreate(body) {
  strictKeys(body, ['requestId','title','category','lecturers','description','audience','durationMinutes','historicalDate','dateBasis','enabled','restricted','resources']);
  if(typeof body.requestId!=='string'||!/^[\w-]{16,100}$/.test(body.requestId))fail(400,'课程提交标识不正确');
  if(!CATEGORIES.some(c=>c.id===body.category))fail(400,'课程分类不存在');
  if(!Array.isArray(body.lecturers)||body.lecturers.length>20)fail(400,'讲师列表格式不正确');
  const lecturers=body.lecturers.map(v=>text(v,100,true));
  if(body.durationMinutes!==null&&(!Number.isInteger(body.durationMinutes)||body.durationMinutes<1||body.durationMinutes>1440))fail(400,'课程时长请填写1至1440分钟或留空');
  const historicalDate=text(body.historicalDate,10),dateBasis=text(body.dateBasis,1000);
  if(historicalDate&&(!/^\d{4}-\d{2}-\d{2}$/.test(historicalDate)||Number.isNaN(Date.parse(historicalDate))||new Date(historicalDate+'T00:00:00Z').toISOString().slice(0,10)!==historicalDate))fail(400,'请填写有效的历史开课日期');
  if(historicalDate&&!dateBasis)fail(400,'请填写历史日期核验依据');
  if(typeof body.enabled!=='boolean'||typeof body.restricted!=='boolean')fail(400,'课程状态格式不正确');
  if(!Array.isArray(body.resources)||body.resources.length!==4)fail(400,'请保留四类课程资料');
  const seen=new Set();
  const resources=body.resources.map(r=>{
    strictKeys(r,['type','text','links']);
    if(!['reading','slides','recordings','other'].includes(r.type)||seen.has(r.type))fail(400,'资料分类重复或不存在');
    seen.add(r.type);
    if(!Array.isArray(r.links)||r.links.length>40)fail(400,'每类资料最多40个入口');
    return {type:r.type,text:text(r.text,30000),links:r.links.map(link=>{
      strictKeys(link,['title','url']);
      const title=text(link.title,1000,true),url=safeUrl(link.url);
      if(!url)fail(400,'请填写资料地址');
      return {title,url};
    })};
  });
  return {...body,title:text(body.title,200,true),description:text(body.description,30000),audience:text(body.audience,30000),lecturers,historicalDate,dateBasis,resources};
}

export function manualCourseSource(payload) {
  const field=value=>({text:value||'',links:[]});
  const fields=Object.fromEntries(['title','month','source_number','date_raw','lecturers','description','audience','reading','slides','recordings','other'].map(k=>[k,field('')]));
  for(const k of ['title','description','audience'])fields[k]=field(payload[k]);
  fields.month=field(payload.historicalDate.slice(0,7));
  fields.date_raw=field(payload.historicalDate);
  fields.lecturers={...field(payload.lecturers.join('、')),lecturers:payload.lecturers.map(name=>({name}))};
  for(const resource of payload.resources)fields[resource.type]={text:resource.text,links:resource.links};
  return {id:'bmt-manual-'+payload.requestId,source_kind:'manual',creation_hash:hash(payload),source_document:'manual',source_block_id:payload.requestId,source_revision:1,source_url:'',source_title:'管理员新增课程',proposed_category:payload.category,historical_rating:null,duration_minutes:payload.durationMinutes,restricted:false,fields};
}
