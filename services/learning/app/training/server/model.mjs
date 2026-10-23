import { createHash } from 'node:crypto';

export const CENTERS = ['营销中心A','营销中心B','营销中心C','营销中心D','营销中心J','品牌营销中心','品牌创意中心','视频中心','AI营销中心','直播中心','未分中心'];
export const SOURCE_DOCUMENTS = ['SwUFdmKBOoTkyPxgm0dcEsIunve', 'PMgwdg3hRo7NYaxtaXacBNZXnaf'];
export const CATEGORIES = [
  {id:'foundation',name:'部门与产品认知'}, {id:'creative',name:'内容创意、自产与混剪'},
  {id:'advertising',name:'竞对分析与千川投放'}, {id:'live',name:'直播运营与内容场'},
  {id:'ai',name:'AI工具与一创二创'}, {id:'management',name:'经营复盘与营销管理'},
  {id:'channel',name:'渠道、KOC与合规'}
];
export const ROLE_PATHS = [
  {id:'marketing',name:'营销经理 / 管培生',categories:['foundation','advertising','management','ai','channel']},
  {id:'content',name:'视频编导 / 视频编辑',categories:['foundation','creative','ai','channel']},
  {id:'live',name:'主播教练 / 直播助理',categories:['foundation','live','creative','ai']},
  {id:'management',name:'管理者',categories:['management','advertising','ai','live']}
];
export const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export const nowIso = (now = Date.now()) => new Date(now).toISOString();
export function organizationCenter(department) {
  const parts=String(department||'').trim().split(/\s*(?:[-—–/＞>·]|\s+\/\s+)\s*/).filter(Boolean);
  return parts.findLast(part=>part.includes('中心')) || '';
}
export function fail(status, message, code='INVALID_INPUT') { throw Object.assign(new Error(message), {status,code}); }
export function text(value, max=3000, required=false) {
  if(typeof value !== 'string' || value.length > max || (required && !value.trim())) fail(400,'填写内容不完整或超过长度限制');
  return value.trim();
}
export function strictKeys(object, keys) {
  if(!object || typeof object !== 'object' || Array.isArray(object) || Object.keys(object).some(k=>!keys.includes(k))) fail(400,'请求包含不支持的字段');
}
export function safeUrl(value) {
  if(!value) return '';
  let u; try {u=new URL(value);} catch {fail(400,'资料链接格式不正确');}
  if(u.protocol!=='https:' || !/(^|\.)(feishu\.cn|larksuite\.com|fandow\.com|douyin\.com)$/.test(u.hostname) || u.username || u.password) fail(400,'请使用公司、飞书或原表抖音资源的HTTPS资料链接');
  return u.href;
}
export function validateInventory(inventory) {
  if(!inventory || !Array.isArray(inventory.courses) || !inventory.courses.length || inventory.courses.length>500) fail(400,'请上传包含courses数组的课程来源快照');
  const seen = new Set();
  for(const c of inventory.courses) {
    if(!SOURCE_DOCUMENTS.includes(c.source_document) || !/^\w{8,100}$/.test(c.source_block_id || '')) fail(400,'导入仅接受本次已确认的两份来源文档与稳定标题块');
    const alias=c.source_document===SOURCE_DOCUMENTS[0]?'swuf':'pmg';
    if(c.id!==`bmt-${alias}-${hash(c.source_document+'/'+c.source_block_id).slice(0,12)}` || seen.has(c.id)) fail(400,'课程身份错误或重复，请核对稳定来源块');
    seen.add(c.id);
    if(!Number.isInteger(c.source_revision) || c.source_revision<1) fail(400,'缺少来源版本');
    for(const field of ['title','month','source_number','date_raw','lecturers','historical_rating','description','audience','reading','slides','recordings','other']) {
      const f=c.fields?.[field];
      if(!f || typeof f.text!=='string' || f.text.length>30000 || !Array.isArray(f.links) || f.links.length>40) fail(400,`课程字段${field}不完整`);
      for(const link of f.links) {safeUrl(link.url); text(link.title || '',1000);}
    }
    text(c.fields.title.text,400,true); safeUrl(c.source_url);
    if(!CATEGORIES.some(x=>x.id===c.proposed_category)) fail(400,'课程分类未映射');
    if(typeof c.restricted!=='boolean') fail(400,'缺少课程权限分层');
    if(c.historical_rating!==null && (!Number.isFinite(c.historical_rating)||c.historical_rating<1||c.historical_rating>5)) fail(400,'历史评分应为1至5或null');
    if(c.duration_minutes!==null && (!Number.isFinite(c.duration_minutes)||c.duration_minutes<1||c.duration_minutes>1440)) fail(400,'时长应为已核验分钟数或null');
  }
  return inventory;
}
function recordingUrls(resources) {
  return [...new Set((resources.find(r=>r.type==='recordings')?.links||[]).map(link=>link.url))].sort();
}
function matchingEnrichment(source,entry,resources) {
  if(!entry || entry.sourceBlock!==source.source_block_id || !Array.isArray(entry.recordings))return false;
  if(entry.recoveredRecordings!==undefined&&!Array.isArray(entry.recoveredRecordings))return false;
  if(entry.sourceRecordingUrls!==undefined&&(!Array.isArray(entry.sourceRecordingUrls)||entry.sourceRecordingUrls.some(url=>typeof url!=='string')))return false;
  const recovered=entry.recoveredRecordings||[];
  if([...entry.recordings,...recovered].some(r=>!r || typeof r.url!=='string' || (r.durationSeconds!=null&&(!Number.isFinite(r.durationSeconds)||r.durationSeconds<=0))))return false;
  if(recovered.some(r=>typeof r.evidenceSourceBlock!=='string'||!r.evidenceSourceBlock.trim()))return false;
  try {for(const r of recovered)safeUrl(r.url);}catch{return false;}
  const expected=recordingUrls(resources),original=[...new Set(entry.recordings.map(r=>r.url))].sort();
  const actual=entry.sourceRecordingUrls===undefined?original:Array.isArray(entry.sourceRecordingUrls)?[...new Set(entry.sourceRecordingUrls)].sort():[];
  return expected.length===actual.length && expected.every((url,i)=>url===actual[i]) && original.length===actual.length && original.every((url,i)=>url===actual[i]);
}
const allRecordings=entry=>[...entry.recordings,...(entry.recoveredRecordings||[])];
function enrichResources(resources,entry,useEvidenceTitles=true) {
  const durations=new Map(allRecordings(entry).filter(r=>Number.isFinite(r.durationSeconds)&&r.durationSeconds>0).map(r=>[r.url,r.durationSeconds]));
  const titles=new Map(allRecordings(entry).filter(r=>typeof r.title==='string'&&r.title.trim()).map(r=>[r.url,r.title.trim()]));
  return resources.map(r=>{
    if(r.type!=='recordings')return r;
    const links=[...r.links];
    for(const recovered of entry.recoveredRecordings||[])if(!links.some(link=>link.url===recovered.url))links.push({title:recovered.title||'课程回放',url:recovered.url,type:recovered.type||'minutes'});
    return {...r,links:links.map(link=>({...link,...(durations.has(link.url)?{durationSeconds:durations.get(link.url)}:{}),...(useEvidenceTitles&&titles.has(link.url)?{title:titles.get(link.url)}:{})}))};
  });
}
function verifiedDuration(entry) {
  if(!Number.isFinite(entry.durationMinutes)||entry.durationMinutes<=0||entry.durationMinutes>1440||!Number.isFinite(entry.durationSeconds)||entry.durationSeconds<=0)return null;
  const recordings=allRecordings(entry);
  if(!recordings.length)return entry.durationSeconds;
  const selected=recordings.find(r=>r.url===entry.defaultRecordingUrl)||(recordings.length===1?recordings[0]:null);
  const seconds=entry.durationBasis==='sequential'
    ?(recordings.every(r=>Number.isFinite(r.durationSeconds)&&r.durationSeconds>0)?recordings.reduce((total,r)=>total+r.durationSeconds,0):null)
    :selected?.durationSeconds;
  return Number.isFinite(seconds)&&seconds>0&&Math.abs(seconds-entry.durationSeconds)<1?seconds:null;
}
export function sourceCourse(source,enrichment) {
  const course={
    id:source.id,title:source.fields.title.text,category:source.proposed_category,
    lecturers:source.fields.lecturers.lecturers?.map(x=>x.name).filter(Boolean) || [],
    lecturerText:source.fields.lecturers.text,description:source.fields.description.text,
    audience:source.fields.audience.text,month:source.fields.month.text,dateRaw:source.fields.date_raw.text,
    historicalRating:source.historical_rating,durationMinutes:source.duration_minutes,restricted:source.restricted,
    resources:['reading','slides','recordings','other'].map(type=>({type,text:source.fields[type].text,links:source.fields[type].links})),
    source:{document:source.source_document,revision:source.source_revision,block:source.source_block_id,url:source.source_url,title:source.source_title,number:source.fields.source_number.text},
    accessVerified:false,enabled:true
  };
  if(matchingEnrichment(source,enrichment,course.resources)) {
    const seconds=verifiedDuration(enrichment);
    if(seconds) {
      course.durationMinutes=Math.ceil(seconds/60);
      course.durationSeconds=seconds;
      course.durationBasis=enrichment.durationBasis;
    }
    if(allRecordings(enrichment).some(r=>r.url===enrichment.defaultRecordingUrl))course.defaultRecordingUrl=enrichment.defaultRecordingUrl;
    if(typeof enrichment.description==='string'&&enrichment.description.trim()&&(/^(?:[（(]?\s*待补充\s*[）)]?|[/／—-]?)$/.test(course.description.trim())||course.description.trim()==='管理培训暂不面向岛民开放')) {
      course.description=enrichment.description;
      course.descriptionSource=enrichment.descriptionSource;
    }
    course.resources=enrichResources(course.resources,enrichment);
  }
  return course;
}
export function publicCourse(row,user,enrichment) {
  const source=JSON.parse(row.source_json), overrides=JSON.parse(row.override_json);
  const sourceResources=sourceCourse(source).resources;
  const entry=matchingEnrichment(source,enrichment,sourceResources)&&matchingEnrichment(source,enrichment,overrides.resources||sourceResources)&&!(overrides.resources&&enrichment.recoveredRecordings?.length)?enrichment:undefined;
  const course={...sourceCourse(source,entry),...overrides,version:row.version,updatedAt:row.updated_at};
  if(entry && overrides.resources)course.resources=enrichResources(overrides.resources,entry,false);
  if(Object.hasOwn(overrides,'durationMinutes')) {
    course.durationSeconds=Number.isFinite(overrides.durationMinutes)?overrides.durationMinutes*60:null;
    course.durationBasis=course.durationSeconds?'administrator':null;
  }
  if(Object.hasOwn(overrides,'description'))delete course.descriptionSource;
  if(user.isAdmin)course.enrichmentStatus={available:!!enrichment,applied:!!entry,reason:!enrichment?'not-found':!entry?'source-changed':verifiedDuration(entry)?'verified':'duration-unavailable'};
  // A local edit cannot unlock a source-restricted course.
  course.restricted=source.restricted || overrides.restricted===true;
  course.canLearn=!course.restricted || !!user.isAdmin || !!user.managementAccess;
  if(!course.canLearn) {
    course.resources=course.resources.map(r=>({...r,links:[]}));
    delete course.defaultRecordingUrl;
    delete course.descriptionSource;
    course.accessMessage='原表限定管理人员学习。符合条件请联系李秋霞申请原资料；选择管理者路径不会改变权限。';
  }
  course.overriddenFields=Object.keys(overrides);
  return course;
}
