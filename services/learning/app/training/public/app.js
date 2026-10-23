import {courseCreatePage,courseCreatePayload,handleCourseCreateClick} from './course-create.js?v=retained-20261021-r2';
import {createAccessManager} from './access.js?v=retained-20261021-r2';
import {createReadRequests} from './read-requests.js?v=retained-20261021-r2';

const $=selector=>document.querySelector(selector);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const enc=encodeURIComponent;
const paths={book:'M4 4h6a3 3 0 0 1 2 2 3 3 0 0 1 2-2h6v15h-6a3 3 0 0 0-2 2 3 3 0 0 0-2-2H4Z M12 6v15',arrow:'M15 5l-7 7 7 7 M8 12h13',external:'M14 3h7v7 M21 3l-10 10 M10 3H3v18h18v-7',bell:'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4',check:'M5 12l4 4 10-11',clock:'M12 8v5l3 2 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',search:'M21 21l-6-6 M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0',lock:'M6 10V7a6 6 0 0 1 12 0v3 M4 10h16v12H4Z M12 14v4'};
const icon=name=>`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name]||paths.book}"/></svg>`;
const minutes=seconds=>seconds<60?`${Math.floor(seconds)}秒`:`${(seconds/60).toFixed(1)}分钟`;
const dateTime=value=>value?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'—';
const currentMonth=()=>{const parts=new Intl.DateTimeFormat('en',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit'}).formatToParts(new Date());return `${parts.find(p=>p.type==='year').value}-${parts.find(p=>p.type==='month').value}`;};
const resourceNames={reading:'延伸阅读',slides:'课程课件',recordings:'课程回放',other:'其他资料'};
const state={me:null,hostVisible:true,csrf:'',preview:false,courses:[],categories:[],centers:[],rolePaths:[],progress:null,announcement:null,routeEpoch:0,authEpoch:0,study:null,activityAt:performance.now(),adminCourses:null};
const rootBase=location.pathname.endsWith('/')?location.pathname:location.pathname.slice(0,location.pathname.lastIndexOf('/')+1);
const readRequests=createReadRequests({request:requestApi,getSession:()=>state.authEpoch});
const accessManager=createAccessManager({api,esc,dateTime,toast,decorateTables,getUser:()=>state.me,getSession:()=>state.authEpoch});
let toastTimer;
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{$('#toast').hidden=true;},4500);}
function stored(key,fallback=null){try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}}
function saveLocal(key,value){try{localStorage.setItem(key,JSON.stringify(value));}catch{toast('浏览器草稿存储不可用，请保持本页打开后重试保存');}}
function draftKey(id,ownerId=state.me?.id){return `bmt-draft:${ownerId}:${id}`;}
class ApiError extends Error{constructor(message,status,code){super(message);this.status=status;this.code=code;}}
async function api(path,options={}) {
  if(!options.method||options.method==='GET')return readRequests.read(path,options);
  const affected=path==='admin/announcements'?['announcements']:/^admin\/(courses|import\/apply)/.test(path)?['courses','admin/courses']:/^admin\/learners\//.test(path)&&decodeURIComponent(path.split('/')[2])===state.me?.id?['courses','my-progress']:['my-progress'];
  const all=path==='logout'||path==='preview/identity';
  const invalidate=()=>all?readRequests.clear():readRequests.invalidate(affected);
  invalidate();try{return await requestApi(path,options);}finally{invalidate();}
}
async function requestApi(path,{method='GET',body,timeout=12000}={}) {
  let response;const authEpoch=state.authEpoch,changed=()=>new ApiError('登录状态已变化，请重新操作',409,'SESSION_CHANGED');
  try{response=await fetch(`${rootBase}api/${path}`,{method,credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json',...(method!=='GET'?{'X-CSRF-Token':state.csrf}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(timeout)});}catch{if(authEpoch!==state.authEpoch)throw changed();throw new ApiError('连接暂时中断，请重试；填写内容已保留',0,'NETWORK');}
  if(authEpoch!==state.authEpoch)throw changed();
  if(response.redirected || !(response.headers.get('content-type')||'').includes('application/json')){readRequests.clear();throw new ApiError('公司登录已失效，请重新登录；草稿已保留',401,'AUTH_REQUIRED');}
  const result=await response.json();
  if(authEpoch!==state.authEpoch)throw changed();
  if(!response.ok){if(response.status===401||response.status===403)readRequests.clear();const error=new ApiError(result.error||'请求未成功，请稍后重试',response.status,result.code);if(error.code==='ACCESS_NOT_GRANTED')accessDenied(error);throw error;}
  return result;
}
function accessDenied(error){
  captureDraft();const study=state.study;if(study){clearInterval(study.interval);clearInterval(study.paintInterval);}state.study=null;state.accessDenied=true;state.routeEpoch++;
  const main=$('#main');main.dataset.route='error';main.removeAttribute('aria-busy');main.innerHTML=errorView(error);document.title='平台访问权限 · 学习平台';
}
function errorView(error,retry='reload') {
  if(error.code==='ACCESS_NOT_GRANTED')return `<section class="error-panel" role="alert"><h1>尚未开通平台访问</h1><p>请联系部门管理员开通权限。已有学习记录和反馈草稿已保留。</p><button class="button" data-action="boot">重新检查访问权限</button></section>`;
  if(error.status===401){sessionStorage.setItem('bmt-return',location.hash);return `<section class="error-panel"><h1>重新进入公司登录</h1><p>${esc(error.message)}</p><a class="button" href="${rootBase}session/resume">重新登录并返回</a></section>`;}
  if(error.status===403&&error.code==='ADMIN_REQUIRED')return `<section class="error-panel" role="alert"><h1>此页面需要管理员授权</h1><p>${esc(error.message)}。请联系培训管理员。</p><div class="button-row recovery-actions"><a class="button" href="#courses">返回课程资源库</a><a class="secondary" href="#profile">查看个人权限</a></div></section>`;
  return `<section class="error-panel" role="alert"><h2>暂时无法读取</h2><p>${esc(error.message)}，请稍后重试。</p><button class="button" data-action="${retry}">重试读取</button></section>`;
}
function empty(title,message,action=''){return `<section class="empty"><h2>${esc(title)}</h2><p>${esc(message)}</p>${action}</section>`;}
function title(heading,description,actions=''){return `<div class="page-title"><div><h1>${esc(heading)}</h1><p>${esc(description)}</p></div>${actions}</div>`;}
function categoryName(id){return state.categories.find(c=>c.id===id)?.name||id;}
function roleName(id){return state.rolePaths.find(r=>r.id===id)?.name||'尚未选择';}
function option(value,label,selected){return `<option value="${esc(value)}" ${value===selected?'selected':''}>${esc(label)}</option>`;}
function roleOptions(selected,withAll=false){return option('', '请选择岗位路径',selected)+(withAll?option('all','所有学员',selected):'')+state.rolePaths.map(r=>option(r.id,r.name,selected)).join('');}
function updateNav(){
  const rawRoute=location.hash.slice(1).split(/[/?]/)[0]||'courses',route=rawRoute==='course'?'courses':rawRoute;
  const items=[['courses','课程目录','book'],['learning','我的学习','check'],['schedule','月排期','calendar'],['leaderboard','排行榜','chart'],...(state.me?.isAdmin?[['admin','学习管理','settings']]:[])];
  $('#main-nav').innerHTML=items.map(([id,name,mark])=>`<a href="#${id}" class="${route===id?'active':''}" ${route===id?'aria-current="page"':''}>${icon(mark)}<span>${name}</span></a>`).join('');
  $('#account').innerHTML=state.me?`<a href="#profile" aria-label="个人资料：${esc(state.me.name)}"><span class="avatar">${esc(state.me.name.slice(-1))}</span><span>${esc(state.me.name)}</span></a><button class="text-button" data-action="logout">退出</button>`:'';
}

async function loadCourses(){
  const result=await api('courses');state.courses=result.courses;state.categories=result.categories;
}
async function loadAnnouncement(){
  const epoch=state.authEpoch;
  try{const result=await api('announcements');if(epoch!==state.authEpoch)return;state.announcement=result.announcement;state.announcementError=null;}
  catch(error){if(epoch!==state.authEpoch)return;state.announcement=null;state.announcementError=error;}
  if(!state.accessDenied&&$('#main').dataset.route==='courses'&&$('#course-announcement'))$('#course-announcement').innerHTML=announcementHtml();
}
async function loadData(){
  const results=await Promise.allSettled([loadCourses(),api('my-progress')]);
  if(results[0].status==='rejected')throw results[0].reason;
  state.progress=results[1].status==='fulfilled'?results[1].value:null;state.progressError=results[1].status==='rejected'?results[1].reason:null;
}
async function boot(){
  state.authEpoch++;readRequests.clear();state.routeEpoch++;state.accessDenied=false;state.me=null;state.courses=[];state.progress=null;state.announcement=null;state.adminCourses=null;state.learners=null;state.requirements=null;state.scheduleEvents=null;const bootEpoch=state.authEpoch;
  try {
    const result=await api('me');state.me=result.user;state.csrf=result.csrfToken;state.preview=result.preview;state.categories=result.categories;state.rolePaths=result.rolePaths;state.centers=result.centers||[];
    if(state.preview){$('#preview-notice').hidden=false;$('#preview-notice').className='preview-bar';$('#preview-notice').innerHTML='本机候选预览 · 使用隔离数据库与预览身份，记录不代表真实学习验收 <button data-action="preview-role" data-role="learner">切换学员</button><button data-action="preview-role" data-role="manager">切换管理员</button>';}
    const back=sessionStorage.getItem('bmt-return');if(back){sessionStorage.removeItem('bmt-return');history.replaceState(null,'',back);}
    updateNav();$('#main').dataset.route='';await render();
  }catch(error){if(bootEpoch===state.authEpoch)$('#main').innerHTML=errorView(error,'boot');}
}
function progressFor(id){return state.progress?.records.find(r=>r.courseId===id);}
function statusBadge(id){const p=progressFor(id);return p?.status==='completed'?'<span class="badge green">已完成</span>':p?'<span class="badge blue">学习中</span>':'';}
function summaryStrip(){if(!state.progress)return `<div class="notice">暂时无法读取学习记录。 <button class="text-button" data-action="refresh-progress">重新读取</button></div>`;const s=state.progress.summary;return `<div class="summary-strip"><span><strong>${s.completed}</strong>已完课</span><span><strong>${s.started-s.completed}</strong>学习中</span><span><strong>${minutes(s.activeSeconds)}</strong>学习时长</span>${s.required!==null?`<span><strong>${s.requiredCompleted} / ${s.required}</strong>已配置学习要求</span>`:''}</div>`;}

Object.assign(paths,{person:'M8 7a4 4 0 1 0 8 0 4 4 0 1 0-8 0 M4 22v-3a8 8 0 0 1 16 0v3',play:'M8 4l13 8-13 8Z',close:'M6 6l12 12 M18 6L6 18',medal:'M8 2l4 6 4-6 M18 15a6 6 0 1 1-12 0 6 6 0 0 1 12 0',calendar:'M4 5h16v16H4Z M4 10h16 M8 3v4 M16 3v4 M8 14h2 M14 14h2 M8 18h2',chart:'M4 21V10h4v11 M10 21V4h4v17 M16 21v-8h4v8',settings:'M9 3h6l1 4 4 2v6l-4 2-1 4H9l-1-4-4-2V9l4-2Z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',forward:'M5 12h14 M13 6l6 6-6 6',spark:'M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z',filter:'M4 6h16 M7 12h10 M10 18h4'});
const coverTopics={
  'bmt-swuf-947d87c3eb5f':['AI赋能','营销素材'], 'bmt-swuf-03ba998c1949':['竞价广告','素材制作'],
  'bmt-swuf-871336f74363':['明星内容场','营销到直播'], 'bmt-swuf-76755afe4a9f':['混剪素材','思考到实操'],
  'bmt-swuf-8259e44cd944':['自产 × 混剪','爆款率提升'], 'bmt-swuf-d2d19ea234b1':['主播教练','状态管理'],
  'bmt-swuf-018de2b8ee8e':['混剪流程','疑难解答'], 'bmt-swuf-6d8a39546024':['直播内容场','策划与组织'],
  'bmt-swuf-bbb1fe85788b':['剧情素材','创作基础'], 'bmt-swuf-1bad1f28b75a':['自产素材','从小白到负责人'],
  'bmt-swuf-d3c4b0b3949a':['流量漏斗','赋能素材'], 'bmt-swuf-e337bfa5f6a6':['营销决策','财报与竞对'],
  'bmt-swuf-b5fda1a788d1':['营销机会点','挖掘与判断'], 'bmt-swuf-7e99b5a40390':['千川引流','竞对分析'],
  'bmt-swuf-af4ff278898c':['自产拍摄','筹备与执行'], 'bmt-swuf-2cb11905bf55':['自产二创','混剪实战'],
  'bmt-swuf-c4858fd897f9':['营销管理','角色跃迁'], 'bmt-swuf-eef7aada23e1':['经营认知','竞争力视角'],
  'bmt-swuf-c77f96a62705':['经营复盘','用利润做判断'], 'bmt-swuf-dbd533fb0753':['KOC选择','判断与放大'],
  'bmt-pmg-c9a337768357':['护肤第一课','WIS PRODUCT'], 'bmt-pmg-57b2eff21ab6':['部门第一课','认识品牌营销'],
  'bmt-pmg-9d378380c005':['混剪创作','CONTENT MIX'], 'bmt-pmg-3c9633b1249e':['认识AI','你的工作助手'],
  'bmt-pmg-a0c4b2224e80':['素材创作','亿飞冲天'], 'bmt-pmg-38a85ce0385c':['百万剧情','开头 · 结构 · 植入'],
  'bmt-pmg-1452a1bd051d':['黄金3秒','吸引力方法论'], 'bmt-pmg-2a7a0a96b4ec':['亿眼定爆款','素材分析与判断'],
  'bmt-pmg-2dc273ce46be':['直播间通识','运营基础'], 'bmt-pmg-2d88888d14bd':['千川素材','竞对分析实战'],
  'bmt-pmg-5ea9cb93c117':['AI工作方法','FANDO TRAINING'], 'bmt-pmg-32e79f102ab0':['肖像权使用','风险与防范'],
  'bmt-pmg-580507175651':['优质种草','结构 × 数据'], 'bmt-pmg-916780a0b418':['视频号运营','从渠道到全链路'],
  'bmt-pmg-651be6faaff9':['一创 × 二创','AI素材焕新']
};
const coverThemes={foundation:'mint',creative:'film',ai:'sky',advertising:'sky',live:'sky',management:'sky',channel:'mint'};
const categoryShortNames={all:'全部课程',foundation:'部门与产品',creative:'内容创意',advertising:'千川投放',live:'直播运营',ai:'AI工具',management:'营销管理',channel:'渠道与合规'};
function courseCover(c,extra=''){
  return `<div class="course-cover ${extra}" aria-hidden="true"><span>${esc(categoryName(c.category))}</span></div>`;
}

function lecturerHtml(c){return (c.lecturers.length?c.lecturers:[c.lecturerText||'课程讲师']).map(name=>`<span class="lecturer">${icon('person')}${esc(name)}</span>`).join('');}
function courseSeconds(c){return c.durationSeconds>0?c.durationSeconds:c.durationMinutes>0?c.durationMinutes*60:null;}
function expectedTime(c){const seconds=courseSeconds(c);return seconds?`预计 ${Math.ceil(seconds/60)} 分钟`:'时长待补充';}
function compactIntroduction(c){const text=(c.description||'').replace(/\s+/g,' ').trim();return text==='(待补充)'?'课程简介正在补充':text;}
function courseCard(c,index=0){
  return `<article class="course-card" data-testid="course-card" data-course-id="${esc(c.id)}">${courseCover(c)}<div class="course-card-body"><div class="tags"><span class="course-category">${esc(categoryShortNames[c.category]||categoryName(c.category))}</span>${c.restricted?`<span class="badge amber">${icon('lock')}管理课程</span>`:''}${statusBadge(c.id)}</div><h3><a href="#course/${enc(c.id)}">${esc(c.title)}</a></h3><div class="course-meta">${lecturerHtml(c)}</div><p class="course-introduction">${esc(compactIntroduction(c))}</p><div class="course-time">${icon('clock')}${expectedTime(c)}</div><div class="card-bottom"><span>${c.historicalRating===null?'':`历史评分 ${c.historicalRating.toFixed(3)}`}</span><span class="card-action">${c.canLearn?'进入学习':'查看课程'}${icon('forward')}</span></div></div></article>`;
}
function selectFeatured(){
  const eligible=state.courses.filter(c=>c.canLearn&&c.enabled);
  let previous;try{previous=sessionStorage.getItem('bmt-featured');}catch{}
  const pool=eligible.length>1?eligible.filter(c=>c.id!==previous):eligible;
  const c=pool[Math.floor(Math.random()*pool.length)];state.featuredId=c?.id;
  if(c)try{sessionStorage.setItem('bmt-featured',c.id);}catch{}
}

function coursesPage(params){
  const category=params.get('category')||'all',q=params.get('q')||'',lecturer=params.get('lecturer')||'',selectedMonth=params.get('month')||'',rating=params.get('rating')||'',path=params.get('path')||'';
  const rolePath=state.rolePaths.find(r=>r.id===path);
  const courses=state.courses.filter(c=>(category==='all'||c.category===category)&&(!rolePath||rolePath.categories.includes(c.category))&&(!lecturer||c.lecturers.includes(lecturer))&&(!selectedMonth||(selectedMonth==='__missing__'?!c.month:c.month===selectedMonth))&&(!rating||(c.historicalRating!==null&&c.historicalRating>=Number(rating)))&&(!q||[c.title,c.description,c.audience,...c.lecturers].join(' ').toLowerCase().includes(q.toLowerCase())));
  const firstRow=['bmt-pmg-c9a337768357','bmt-pmg-9d378380c005','bmt-pmg-5ea9cb93c117'];
  courses.sort((a,b)=>{const x=firstRow.indexOf(a.id),y=firstRow.indexOf(b.id);return (x<0?3:x)-(y<0?3:y);});
  const categories=[{id:'all',name:'全部课程'},...state.categories];
  const categoryLinks=categories.map(c=>{const next=new URLSearchParams(params);if(c.id==='all')next.delete('category');else next.set('category',c.id);return `<a href="#courses${next.size?'?'+next:''}" class="${c.id===category?'active':''}" ${c.id===category?'aria-current="true"':''} aria-label="${esc(c.name)}" title="${esc(c.name)}">${esc(c.name)}<span class="count">${c.id==='all'?state.courses.length:state.courses.filter(x=>x.category===c.id).length}</span></a>`;}).join('');
  const lecturers=[...new Set(state.courses.flatMap(c=>c.lecturers))].sort((a,b)=>a.localeCompare(b,'zh'));
  const months=[...new Set(state.courses.map(c=>c.month).filter(Boolean))];
  const featured=state.courses.find(c=>c.id===state.featuredId);
  const activeFilters=[lecturer,selectedMonth,rating].filter(Boolean).length;
  return `    <section class="course-library" aria-labelledby="library-title"><form id="course-filter"><input type="hidden" name="category" value="${esc(category)}"><div class="library-heading"><h2 id="library-title" class="sr-only">课程资源库</h2><label class="hub-role-filter">岗位学习路径<select id="filter-path" name="path">${option('','全部岗位课程',path)}${state.rolePaths.map(r=>option(r.id,r.name,path)).join('')}</select><small>岗位只影响推荐与筛选，不改变课程权限。</small></label><div class="library-search"><label for="course-keyword" class="sr-only">关键词</label><div class="search-input">${icon('search')}<input id="course-keyword" name="q" value="${esc(q)}" placeholder="搜索课程、讲师或适用岗位" type="search"></div><button type="submit" class="secondary">搜索</button></div></div><div class="library-navigation"><nav class="category-tabs" aria-label="课程分类">${categoryLinks}</nav><details class="advanced-filters" ${activeFilters?'open':''}><summary>${icon('filter')}筛选${activeFilters?`<span class="filter-dot">${activeFilters}</span>`:''}</summary><div class="filters"><label>讲师<select name="lecturer">${option('','全部讲师',lecturer)}${lecturers.map(x=>option(x,x,lecturer)).join('')}</select></label><label>课程月份<select name="month">${option('','全部月份',selectedMonth)}${months.map(x=>option(x,x,selectedMonth)).join('')+option('__missing__','未分类月份',selectedMonth)}</select></label><label>历史授课评分<select name="rating">${option('','全部评分',rating)}${option('4.7','4.7分及以上',rating)}${option('4.9','4.9分及以上',rating)}</select></label></div></details></div><div class="filter-status" id="filter-status" ${q||rolePath||activeFilters||category!=='all'?'':'hidden'}><span role="status">找到 ${courses.length} 门课程${rolePath?' · '+esc(rolePath.name):''}</span><a class="text-button" href="#courses">重置筛选</a></div></form><div id="course-results">${courses.length?`<div class="course-grid">${courses.map(courseCard).join('')}</div>`:empty('没有匹配课程','调整关键词或筛选条件后再试。','<a class="button" href="#courses">查看全部课程</a>')}</div></section>
    <div id="course-announcement">${announcementHtml()}</div>`;
}

function resourcesHtml(c){
  return ['slides','reading','other'].map(type=>c.resources.find(r=>r.type===type)).filter(r=>r?.links.length).map(r=>`<section class="resource-section"><h3>${esc(resourceNames[r.type])}</h3><div class="resource-links">${r.links.map(l=>`<a class="resource-link" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${icon('book')}<span>${esc(l.title||resourceNames[r.type])}</span>${icon('external')}</a>`).join('')}</div></section>`).join('');
}
function videoLinks(c){return (c.resources.find(r=>r.type==='recordings')?.links||[]).filter(l=>/\/(minutes|file)\//.test(l.url)||l.type==='source-document');}
function playerHtml(link){if(link.type==='source-document')return `<div class="source-video"><span class="video-symbol">${icon('play')}</span><h2>${esc(link.title||'课程视频')}</h2><p>这节课的视频保存在飞书课程原文中。</p><a class="button" href="${esc(link.url)}" target="_blank" rel="noopener noreferrer">在飞书原文打开视频 ${icon('external')}</a></div>`;const u=new URL(link.url);const src=u.pathname.includes('/minutes/')?u.origin+u.pathname.replace(/\/minutes\/(?:embed\/)?/,'/minutes/embed/'):u.href;return `<iframe src="${esc(src)}" title="${esc(link.title||'课程视频')}" allow="autoplay; fullscreen; encrypted-media; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;}
function learningProgressHtml(c,p){const total=courseSeconds(c);return `<section class="learning-progress" aria-label="本课学习进度"><div class="progress-heading"><strong>学习进度</strong><span id="study-duration">已学习 ${minutes(p?.activeSeconds||0)}${total?` / 预计 ${Math.ceil(total/60)} 分钟`:''}</span></div>${total?'<div class="progress-track" role="progressbar" aria-label="学习时长进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span id="study-fill"></span></div>':''}<div class="progress-caption"><span id="timer-state">正在开启学习记录…</span><span id="progress-percent"></span></div></section>`;}
function announcementHtml(){
  const ann=state.announcement?{...state.announcement}:null;
  if(ann?.body==='两份品营课程库已汇入这里。选择你的学习路径，打开原资料，学完后提交反馈并记录准备应用到哪项工作。资料权限沿用飞书原设置。')ann.body='选择适合当前工作的课程，学完后记录收获，把方法用进下一次内容创作、投放与经营复盘。';
  return ann?`<section class="announcement">${icon('bell')}<div><h2>${esc(ann.title)}</h2><p>${esc(ann.body)}</p>${ann.galleryUrl?`<a href="${esc(ann.galleryUrl)}" target="_blank" rel="noopener">查看部门作品集 ${icon('external')}</a>`:''}</div></section>`:'<div class="notice">公告暂待核验，请稍后重新读取。</div>';
}

async function detailPage(id,epoch){
  const result=await api(`courses/${enc(id)}`),c=result.course;
  const draft=stored(draftKey(id))||{requestId:crypto.randomUUID(),rating:result.feedback?.rating||'',doubts:result.feedback?.doubts||'',suggestions:result.feedback?.suggestions||'',application:result.feedback?.application||''};
  if(epoch!==state.routeEpoch)return '';
  const links=videoLinks(c),selected=links.find(l=>l.url===c.defaultRecordingUrl)||links[0];
  state.detail={...result,draft,selectedVideo:selected,ownerId:state.me.id,authEpoch:state.authEpoch};
  const materials=resourcesHtml(c),p=result.progress;
  return `<a href="#courses" class="back-link">${icon('arrow')}返回课程资源库</a><article class="lesson-page"><header class="lesson-heading"><div class="tags"><span class="badge blue">${esc(categoryName(c.category))}</span><span id="course-status">${p?.status==='completed'?'<span class="badge green">已完成</span>':''}</span></div><h1>${esc(c.title)}</h1><div class="detail-meta">${lecturerHtml(c)}<span>${icon('clock')}${expectedTime(c)}</span></div><p class="lesson-introduction">${esc(compactIntroduction(c))}</p></header>${c.canLearn?`${selected?`<section class="video-section" aria-label="课程视频">${links.length>1?`<div class="recording-tabs" role="group" aria-label="选择课程回放">${links.map((l,i)=>`<button class="secondary ${l.url===selected.url?'active':''}" data-action="select-video" data-url="${esc(l.url)}" aria-pressed="${l.url===selected.url}">${esc(l.title||`回放 ${i+1}`)}${l.durationSeconds?` · ${Math.ceil(l.durationSeconds/60)}分钟`:''}</button>`).join('')}</div>`:''}<div id="player" class="player">${videoEntryHtml(selected)}</div><div class="player-support"><span>学习时长按课程页面活跃时间统计，不代表视频实际播放时长。</span><a id="original-video" href="${esc(selected.url)}" target="_blank" rel="noopener noreferrer">在飞书打开 ${icon('external')}</a></div></section>`:'<section class="notice">本课回放暂未提供，可先阅读课程资料。</section>'}${learningProgressHtml(c,p)}<section class="lesson-actions"><div><strong>${p?.status==='completed'?'已完成本课学习':'学完后，留下你的收获'}</strong><p>分享疑问、建议，以及准备应用到工作中的方法。</p></div><button class="button" data-action="open-feedback">${icon('check')}<span id="feedback-entry-label">${result.feedback?'查看与更新反馈':'完成学习，填写反馈'}</span></button></section>${materials?`<section class="panel lesson-materials"><h2>课程学习资料</h2>${materials}</section>`:''}${c.audience?`<section class="lesson-audience"><h2>适用对象</h2><p>${esc(c.audience)}</p></section>`:''}${feedbackForm(c,draft,result.feedback)}`:`<section class="notice">${icon('lock')}本课面向已授权的管理人员，请联系培训管理员获取学习权限。</section>`}</article>`;
}

function feedbackForm(c,draft,feedback){return `<dialog id="feedback-dialog" aria-labelledby="feedback-title"><div class="dialog-heading"><h2 id="feedback-title">学习反馈与实际应用</h2><button class="text-button" data-action="close-feedback" aria-label="关闭反馈">${icon('close')}</button></div>${feedback?`<div id="saved-receipt" class="success-note">已保存反馈：${dateTime(feedback.savedAt)} · ${feedback.rating}分</div>`:'<div id="saved-receipt" hidden></div>'}<form id="feedback-form" class="feedback-form" data-course="${esc(c.id)}"><fieldset ${draft.pendingPayload?'disabled':''}><legend>授课评分（必选）</legend><div class="rating-options">${[1,2,3,4,5].map(n=>`<label><input type="radio" name="rating" value="${n}" required ${Number(draft.rating)===n?'checked':''}>${n}分</label>`).join('')}</div><label class="form-field">仍有疑惑的地方<textarea name="doubts" maxlength="3000" placeholder="可以写你准备继续验证的问题">${esc(draft.doubts)}</textarea></label><label class="form-field">课程改进建议<textarea name="suggestions" maxlength="3000" placeholder="内容、案例、讲解或资料的改进建议">${esc(draft.suggestions)}</textarea></label><label class="form-field">准备应用到哪项工作（选填）<textarea name="application" maxlength="3000" placeholder="例如：下一条千川素材的前三秒、下一场直播的内容结构">${esc(draft.application)}</textarea></label></fieldset><small id="draft-state">${draft.pendingPayload?'正在确认上次提交结果，填写内容已保留。':'填写内容自动保存为草稿。'}</small><div id="feedback-error" role="alert" hidden></div><div class="button-row"><button class="button" type="submit" id="feedback-submit">${draft.pendingPayload?'检查并重试':'提交反馈并确认完成'}</button><button class="secondary" type="button" data-action="read-receipt" ${draft.pendingPayload?'':'hidden'}>检查保存结果</button></div></form></dialog>`;}
async function learningPage(){
  const [,progress]=await Promise.all([loadCourses(),api('my-progress')]);state.progress=progress;state.progressError=null;const records=state.progress.records;
  return `${title('我的学习','继续上次的课程，或回顾已经学过的内容。',`<a class="secondary" href="#profile">调整岗位路径</a>`)}${summaryStrip()}${state.progress.requirements.length?`<section class="panel"><h2>已配置的学习要求</h2>${state.progress.requirements.map(r=>`<p class="source-note">${esc(r.name)} · ${r.courseIds.length}门当前可访问课程</p>`).join('')}</section>`:''}${records.length?`<div class="table-wrap"><table><thead><tr><th>课程</th><th>状态</th><th>学习时长</th><th>最近打开</th><th>首次完成</th></tr></thead><tbody>${records.sort((a,b)=>b.lastOpened.localeCompare(a.lastOpened)).map(r=>`<tr><td class="course-cell"><a href="#course/${enc(r.courseId)}">${esc(state.courses.find(c=>c.id===r.courseId)?.title||'已归档课程')}</a></td><td>${statusBadge(r.courseId)}</td><td class="numeric">${minutes(r.activeSeconds)}</td><td>${dateTime(r.lastOpened)}</td><td>${dateTime(r.completedAt)}</td></tr>`).join('')}</tbody></table></div>`:empty('开始你的第一门课程','在资源库选择适合当前工作的课程，阅读资料后提交反馈。','<a href="#courses" class="button">去找课</a>')}`;
}
async function schedulePage(params){
  const selected=params.get('month')||currentMonth(),historical=params.get('view')==='history';
  if(historical)await loadCourses();
  const events=historical?[]:(await api(`schedule?month=${enc(selected)}`)).events;state.scheduleEvents=events;
  return `${title('月排期','查看近期培训安排，提前规划学习时间。')}<nav class="tabs" aria-label="排期视图"><a href="#schedule?month=${enc(selected)}" class="${!historical?'active':''}">已确认培训</a><a href="#schedule?view=history" class="${historical?'active':''}">历史开课信息</a></nav>${historical?`<div class="table-wrap"><table><thead><tr><th>原表月份 / 日期</th><th>课程</th><th>开课日期</th></tr></thead><tbody>${state.courses.map(c=>`<tr><td>${esc(c.month)}<br>${esc(c.dateRaw)}</td><td class="course-cell"><a href="#course/${enc(c.id)}">${esc(c.title)}</a></td><td>${c.normalizedDate?`${esc(c.normalizedDate)}<br>${esc(c.dateBasis)}`:'—'}</td></tr>`).join('')}</tbody></table></div>`:`<div class="month-nav"><button class="secondary" data-action="month-prev" data-month="${selected}">上个月</button><label><span class="small">查看月份</span><input id="schedule-month" type="month" value="${selected}" aria-label="查看月份"></label><button class="secondary" data-action="month-next" data-month="${selected}">下个月</button><a class="text-button" href="#schedule">回到本月</a></div>${!events.length?empty(`${selected} 暂无已确认排期`,'管理员确认实际时间、地点与课程后，培训会显示在这里。历史课程可切换到历史开课信息查看。'):''}${calendarHtml(selected,events)}${events.length?`<div class="event-list">${events.map(e=>`<article class="event-item"><div class="event-date">${esc(e.date)}<br>${esc(e.time)} · 北京时间</div><div><h3>${e.courseId?`<a href="#course/${enc(e.courseId)}">${esc(e.title)}</a>`:esc(e.title)}</h3><p>${esc(e.location||'地点待补')}</p><p>${esc(e.notes)}</p></div></article>`).join('')}</div>`:''}`}`;
}
function calendarHtml(selected,events){const [year,month]=selected.split('-').map(Number),first=(new Date(year,month-1,1).getDay()+6)%7,days=new Date(year,month,0).getDate();let cells=['一','二','三','四','五','六','日'].map(x=>`<div class="weekday">周${x}</div>`).join('');for(let i=0;i<42;i++){const day=i-first+1;if(day<1||day>days){cells+='<div class="outside"></div>';continue;}const date=`${selected}-${String(day).padStart(2,'0')}`;cells+=`<div><span class="day">${day}</span>${events.filter(e=>e.date===date).map(e=>`<div class="calendar-event">${esc(e.time)} ${esc(e.title)}</div>`).join('')}</div>`;}return `<div class="calendar" aria-label="${selected}培训日历">${cells}</div>`;}
async function leaderboardPage(params){
  const sort=params.get('sort')||'completed',result=await api(`leaderboard?sort=${enc(sort)}`);
  const leaders=result.rows.filter(r=>r.rank<=3),rankOrder=[2,1,3];
  const podium=leaders.length?`<section class="leaderboard-podium" data-testid="leaderboard-podium" aria-label="学习榜前三名">${rankOrder.filter(rank=>leaders.some(r=>r.rank===rank)).map(rank=>`<div class="podium-group rank-${rank}">${leaders.filter(r=>r.rank===rank).map(r=>`<article class="podium-entry" data-testid="podium-entry" data-rank="${rank}" data-userid="${esc(r.id)}"><div class="podium-medal">${icon('medal')}<span>${rank}</span></div><h2>${esc(r.name)}</h2><p>${esc(r.center||r.department||'')}</p><span class="podium-score">${sort==='active'?minutes(r.activeSeconds):`${r.completed} 门已完成`}</span><div class="podium-step">${rank}</div></article>`).join('')}</div>`).join('')}</section>`:'';
  return `${title('部门学习榜','让每一次学习，都成为下一次实践的积累。')}<nav class="tabs" aria-label="榜单排序"><a href="#leaderboard?sort=completed" class="${sort==='completed'?'active':''}">按已完课数</a><a href="#leaderboard?sort=active" class="${sort==='active'?'active':''}">按学习时长</a></nav>${podium}${result.rows.length?`<div class="table-wrap"><table><thead><tr><th>名次</th><th>学员</th><th>工号</th><th>所属中心</th><th>已完课数</th><th>学习时长</th></tr></thead><tbody>${result.rows.map(r=>`<tr><td class="numeric">${r.rank}</td><td>${esc(r.name)}</td><td>${esc(r.id)}</td><td>${esc(r.center||r.department||'—')}</td><td class="numeric">${r.completed}</td><td class="numeric">${minutes(r.activeSeconds)}</td></tr>`).join('')}</tbody></table></div>`:empty('等待第一份学习收获','开始一门课程，你的学习记录会自动显示在这里。','<a class="button" href="#courses">去选课</a>')}`;
}
function profilePage(){return `${title('个人学习资料','按当前工作选择学习路径，找到适合你的课程。')}<section class="panel edit-box"><dl class="identity-details"><div><dt>姓名</dt><dd>${esc(state.me.name)}</dd></div><div><dt>工号</dt><dd>${esc(state.me.id)}</dd></div><div><dt>所属中心</dt><dd>${esc(state.me.center||state.me.department||'—')}</dd></div><div><dt>部门</dt><dd>${esc(state.me.department)}</dd></div></dl><form id="profile-form"><label class="form-field">岗位学习路径<select name="jobRole">${roleOptions(state.me.jobRole)}</select></label><div id="form-error" hidden role="alert"></div><button class="button" type="submit">保存学习路径</button></form></section>`;}

function adminNavigation(section){return `<nav class="admin-nav" aria-label="管理功能">${[['courses','课程与资料'],['learners','学员与授权'],['progress','学习台账'],['feedback','课程反馈'],['schedule','培训排期'],['announcement','部门公告'],['requirements','学习要求'],['audit','变更记录']].map(([id,label])=>`<a href="#admin/${id}" class="${id===section?'active':''}" ${id===section?'aria-current="page"':''}>${label}</a>`).join('')}</nav>`;}
const fieldNames={title:'名称',category:'分类',lecturers:'讲师',description:'介绍',audience:'对象',durationMinutes:'核验时长',normalizedDate:'核验日期',dateBasis:'日期依据',resources:'资料',enabled:'上架状态',restricted:'访问范围',source:'来源版本'};
function tableFilters(records,{course=false}={}){
  const centers=[...new Set([...state.centers,...records.map(r=>r.center).filter(Boolean)])];
  return `<div class="toolbar"><form class="filters" id="table-filter"><label>搜索<input type="search" name="q" placeholder="姓名、课程或内容"></label><label>所属中心<select name="center">${option('','全部中心','')}${centers.map(c=>option(c,c,'')).join('')}</select></label><label>${course?'课程':'岗位路径'}<select name="extra">${option('','全部','')}${course?state.courses.map(c=>option(c.id,c.title,'')).join(''):state.rolePaths.map(r=>option(r.id,r.name,'')).join('')}</select></label></form><span class="small" data-filter-count>${records.length} 条记录</span></div>`;
}
function filterAttrs(record){return `data-search="${esc(Object.values(record).join(' ').toLowerCase())}" data-center="${esc(record.center||'未分中心')}" data-role="${esc(record.jobRole||'')}" data-course="${esc(record.courseId||'')}"`;}
async function adminPage(section,id,params){
  if(!state.me.isAdmin)throw new ApiError('学习管理需要服务端管理员授权',403,'ADMIN_REQUIRED');
  if(['progress','feedback','schedule','requirements','audit'].includes(section)||(section==='learners'&&id))await loadCourses();
  let content='';
  if(section==='course')section='courses';
  if(section==='courses'){
    if(id!=='new')state.adminCourses=(await api('admin/courses')).courses;
    if(id==='new')content=courseCreatePage(state.categories,esc,crypto.randomUUID());
    else if(id)content=adminCourseEditor(state.adminCourses.find(c=>c.id===id));
    else content=adminCoursesContent();
  }else if(section==='learners'){
    const learners=(await api('admin/learners')).learners;state.learners=learners;
    const learner=id?learners.find(u=>u.id===id):null;if(id&&!learner)throw new ApiError('学员未找到，请返回人员台账',404,'NOT_FOUND');
    content=learner?`<section class="panel learner-editor"><h2>调整学员中心、岗位与课程</h2><p class="learner-identity">${esc(learner.name)} · ${esc(learner.id)}</p><form id="learner-form" data-id="${esc(id)}"><label class="form-field">所属中心<select name="center">${option('','沿用公司部门',learner.center)}${[...new Set([...state.centers,...(learner.center?[learner.center]:[])])].map(c=>option(c,c,learner.center)).join('')}</select></label><label class="form-field">岗位路径<select name="jobRole">${option('','尚未选择',learner.jobRole)}${state.rolePaths.map(r=>option(r.id,r.name,learner.jobRole)).join('')}</select></label><label class="learner-management"><input name="managementAccess" type="checkbox" ${learner.managementAccess?'checked':''}><span>管理课程授权</span></label><strong class="learner-course-label">对应学习课程</strong><div class="checklist learner-course-checks">${state.courses.map(c=>`<label><input type="checkbox" name="courseIds" value="${esc(c.id)}" ${(learner.courseIds||[]).includes(c.id)?'checked':''}><span>${esc(c.title)}</span></label>`).join('')}</div><div id="form-error" hidden role="alert"></div><div class="button-row"><button class="button" type="submit">保存设置</button><a class="secondary" href="#admin/learners">返回学员列表</a></div></form></section>`:`${title('学员与授权','分配学员所属中心、岗位、学习课程与管理课程授权。')}${tableFilters(learners)}<div class="table-wrap"><table><thead><tr><th>学员 / 公司部门</th><th>中心 / 岗位路径</th><th>已完课 / 活跃时长</th><th>管理课程授权</th><th>操作</th></tr></thead><tbody>${learners.map(u=>`<tr ${filterAttrs(u)}><td>${esc(u.name)}<br><small>${esc(u.id)} · ${esc(u.department)}</small></td><td>${esc(u.center||'未填写')}<br><small>${esc(roleName(u.jobRole))} · ${(u.courseIds||[]).length} 门课程</small></td><td>${u.completed}门<br><small>${minutes(u.activeSeconds)}</small></td><td>${u.managementAccess?'已授权':'未授予'}</td><td><a class="secondary learner-adjust" href="#admin/learners/${enc(u.id)}">调整</a></td></tr>`).join('')}</tbody></table></div>`;
  }else if(section==='progress'){
    const records=(await api('admin/progress')).records.map(r=>({...r,courseTitle:state.courses.find(c=>c.id===r.courseId)?.title||'已归档课程'}));
    content=`${title('部门学习台账','完成状态以反馈事务保存回执为准；学习时长不代表飞书视频实际播放。')}${tableFilters(records,{course:true})}${records.length?`<div class="table-wrap"><table><thead><tr><th>学员 / 中心</th><th>课程</th><th>状态</th><th>活跃时长</th><th>最近打开 / 首次完成</th></tr></thead><tbody>${records.map(r=>`<tr ${filterAttrs(r)}><td>${esc(r.name)}<br><small>${esc(r.center||'未填写')}</small></td><td class="course-cell">${esc(r.courseTitle)}</td><td><span class="badge ${r.status==='completed'?'green':'blue'}">${r.status==='completed'?'已完成':'学习中'}</span></td><td>${minutes(r.activeSeconds)}</td><td>${dateTime(r.lastOpened)}<br><small>${dateTime(r.completedAt)}</small></td></tr>`).join('')}</tbody></table></div>`:empty('暂无学习记录','学员打开课程后会产生学习中记录；提交反馈保存成功后更新为完成。')}`;
  }else if(section==='feedback'){
    const feedback=(await api('admin/feedback')).feedback.map(f=>({...f,courseTitle:state.courses.find(c=>c.id===f.courseId)?.title||'已归档课程'}));
    const avg=feedback.length?(feedback.reduce((n,f)=>n+f.rating,0)/feedback.length).toFixed(2):null;
    content=`${title('课程学习反馈','每人每课采用最近一份有效反馈，评分与源表历史授课评分分开。')}<div class="summary-strip"><span><strong>${feedback.length}</strong>有效反馈样本</span><span>本平台平均授课评分 <strong>${avg??'尚无样本'}</strong></span></div>${tableFilters(feedback,{course:true})}${feedback.length?`<div class="table-wrap"><table><thead><tr><th>学员 / 课程</th><th>授课评分</th><th>疑惑与建议</th><th>准备应用的工作</th><th>保存时间</th></tr></thead><tbody>${feedback.map(f=>`<tr ${filterAttrs(f)}><td class="course-cell">${esc(f.name)}<br><small>${esc(f.center||'未填写')}</small><br>${esc(f.courseTitle)}</td><td>${f.rating}分</td><td class="feedback-cell">疑惑：${esc(f.doubts||'未填写')}<br>建议：${esc(f.suggestions||'未填写')}</td><td class="feedback-cell">${esc(f.application||'未填写')}</td><td>${dateTime(f.savedAt)}</td></tr>`).join('')}</tbody></table></div>`:empty('暂无已保存反馈','学员提交成功后，评分、问题、建议和实际应用记录会显示在这里。')}`;
  }else if(section==='schedule'){
    const selected=params.get('month')||currentMonth(),events=(await api(`schedule?month=${selected}`)).events;state.scheduleEvents=events;
    state.scheduleMonth=selected;content=adminScheduleContent(selected,events,id);
  }else if(section==='announcement'){
    const a=(await api('admin/announcements')).announcement;
    content=`${title('部门公告','公告显示在课程资源库。作品集仅在提供部门真实地址后启用。')}<section class="panel"><form id="announcement-form" data-version="${a.version}"><label class="form-field">公告标题<input name="title" required maxlength="200" value="${esc(a.title)}"></label><label class="form-field">公告内容<textarea name="body" maxlength="5000">${esc(a.body)}</textarea></label><label class="form-field">品营作品集地址（可留空）<input type="url" name="galleryUrl" value="${esc(a.galleryUrl)}" placeholder="飞书或公司HTTPS地址"><small>当前未配置时不展示作品集入口。</small></label><div id="form-error" role="alert" hidden></div><button class="button" type="submit">保存公告</button></form></section>`;
  }else if(section==='requirements'){
    const requirements=(await api('admin/requirements')).requirements;state.requirements=requirements;
    content=adminRequirementsContent(requirements,id);
  }else if(section==='import'){
    content=`${title('原表课程导入','来源固定为本次确认的两份飞书课程库。先看差异，再更新；人工补充与学习记录保留。')}<section class="panel"><p class="prose">课程身份绑定原文档与课程标题块。若来源块重建导致疑似重复，停止自动导入并提示校对；缺失于快照的课程不会自动删除。</p><div class="button-row"><button class="secondary" data-action="export-source">下载当前来源快照</button></div><form id="import-form"><label class="form-field">选择新读取的课程快照（JSON）<input type="file" name="inventory" accept="application/json,.json" required><small>使用与当前来源快照相同的字段，包含完整课程原字段、版本和稳定来源块。不能用行序号替代课程身份。</small></label><div id="form-error" role="alert" hidden></div><button class="button" type="submit">读取并预览差异</button></form></section><div id="import-preview"></div>`;
  }else if(section==='audit'){
    const records=(await api('admin/audit')).records;
    const names={'course.create':'新增课程','course.update':'课程补充','learner.update':'学员设置','schedule.update':'排期保存','schedule.delete':'排期撤销','announcement.update':'公告保存','requirement.update':'学习要求保存','requirement.delete':'学习要求撤销','source.import':'来源导入'};
    content=`${title('管理变更记录','最近100条管理操作。记录操作者、对象与时间；课程反馈保存在独立学习台账。')}${records.length?`<div class="table-wrap"><table><thead><tr><th>时间</th><th>操作</th><th>操作者</th><th>对象</th></tr></thead><tbody>${records.map(r=>`<tr><td>${dateTime(r.at)}</td><td>${esc(names[r.action]||r.action)}</td><td>${esc(r.user_id)}</td><td class="course-cell">${esc(state.courses.find(c=>c.id===r.object_id)?.title||r.object_id)}</td></tr>`).join('')}</tbody></table></div>`:empty('尚无管理变更','课程维护、公告、排期或导入保存后会留下操作记录。')}`;
  }else throw new ApiError('管理页面未找到',404,'NOT_FOUND');
  return `<div class="admin-layout">${adminNavigation(section)}<section class="admin-content">${content}</section></div>`;
}
function adminCoursesContent(){return `${title('课程与资料','维护课程信息与学习资料。')}<div class="toolbar"><label class="form-field">查找课程<input id="admin-course-search" type="search" placeholder="课程、讲师或分类"></label><a class="button" href="#admin/courses/new">＋ 新增课程</a></div><div class="table-wrap"><table><thead><tr><th>课程 / 分类</th><th>资料状态</th><th>历史评分 / 时长</th><th>来源 / 补充</th><th>操作</th></tr></thead><tbody>${state.adminCourses.map(c=>`<tr data-admin-course-search="${esc([c.title,...c.lecturers,categoryName(c.category)].join(' ').toLowerCase())}"><td class="course-cell"><strong>${esc(c.title)}</strong><br><small>${esc(categoryName(c.category))} · ${esc(c.lecturers.join('、'))}</small></td><td>${c.restricted?'<span class="badge amber">原表管理受限</span>':`回放 ${c.resources.find(r=>r.type==='recordings')?.links.length||0} 个`}<br><small>${c.enabled?'可见':'已停用'}</small></td><td>${c.historicalRating===null?'待补':c.historicalRating.toFixed(3)}<br><small>${c.durationMinutes===null?'时长待核验':`${c.durationMinutes}分钟（已核验）`}</small></td><td><small>revision ${c.source.revision}<br>${c.source.document==='manual'?'手工新增':c.overriddenFields.length?`${c.overriddenFields.length}项补充`:'来源原文'}</small>${c.conflicts.length?`<br><span class="badge amber">${c.conflicts.length}项冲突待校对</span>`:''}</td><td><a href="#admin/course/${enc(c.id)}">编辑</a></td></tr>`).join('')}</tbody></table></div>`;}
function adminScheduleContent(selected,events,id){
    const event=id?events.find(e=>e.id===id):null;if(id&&!event)throw new ApiError('排期未找到，请返回对应月份',404,'NOT_FOUND');
    return `${title('培训排期管理','只录入已确认的实际培训。原表历史日期不会自动转成新排期。')}<div class="month-nav"><label><span class="small">管理月份</span><input type="month" id="admin-schedule-month" value="${esc(selected)}"></label><a class="secondary" href="#schedule?month=${selected}">查看学员日历</a></div><section class="panel"><h2>${event?'编辑已确认培训':'新增已确认培训'}</h2><form id="schedule-form" data-id="${event?.id||crypto.randomUUID()}" data-version="${event?.version||0}"><div class="form-grid"><label class="form-field">培训日期<input type="date" name="date" required value="${event?.date||selected+'-01'}"></label><label class="form-field">开始时间（北京时间）<input type="time" name="time" required value="${event?.time||''}"></label><label class="form-field wide">培训标题<input name="title" required maxlength="400" value="${esc(event?.title||'')}"></label><label class="form-field wide">关联课程（可选）<select name="courseId">${option('','不关联已有课程',event?.courseId||'')}${state.courses.map(c=>option(c.id,c.title,event?.courseId||'')).join('')}</select></label><label class="form-field wide">地点或会议入口<input name="location" maxlength="1000" value="${esc(event?.location||'')}"></label><label class="form-field wide">补充说明<textarea name="notes" maxlength="3000">${esc(event?.notes||'')}</textarea></label></div><div id="form-error" role="alert" hidden></div><div class="button-row"><button type="submit" class="button">${event?'保存排期修改':'发布已确认排期'}</button>${event?`<a class="secondary" href="#admin/schedule?month=${selected}">取消编辑</a>`:''}</div></form></section>${events.length?`<div class="table-wrap"><table><thead><tr><th>日期 / 时间</th><th>培训</th><th>地点</th><th>操作</th></tr></thead><tbody>${events.map(e=>`<tr><td>${e.date}<br>${e.time}</td><td class="course-cell">${esc(e.title)}</td><td>${esc(e.location)}</td><td><a href="#admin/schedule/${enc(e.id)}?month=${selected}">编辑</a> <button class="text-button danger" data-action="delete-schedule" data-id="${esc(e.id)}" data-version="${e.version}">撤销</button></td></tr>`).join('')}</tbody></table></div>`:empty('本月尚无排期','填写并保存已确认的培训后，学员月排期同步显示。')}`;
}
function adminRequirementsContent(requirements,id){
    const item=id?requirements.find(r=>r.id===id):null;if(id&&!item)throw new ApiError('学习要求未找到',404,'NOT_FOUND');
    return `${title('学习要求','只有明确配置的清单才计算完成进度，分母仅包含本人获得授权且当前可访问的课程。')}<section class="panel"><h2>${item?'编辑学习清单':'配置学习清单'}</h2><form id="requirement-form" data-id="${item?.id||crypto.randomUUID()}" data-version="${item?.version||0}"><div class="form-grid"><label class="form-field">清单名称<input name="name" required maxlength="200" value="${esc(item?.name||'')}"></label><label class="form-field">适用岗位路径<select name="role" required>${option('all','所有学员',item?.role||'all')}${state.rolePaths.map(r=>option(r.id,r.name,item?.role||'all')).join('')}</select></label></div><p class="form-field">需要学习的课程</p><div class="checklist">${state.courses.map(c=>`<label><input name="courseIds" type="checkbox" value="${esc(c.id)}" ${item?.courseIds.includes(c.id)?'checked':''}><span>${esc(c.title)} ${c.restricted?'（管理受限）':''}</span></label>`).join('')}</div><div id="form-error" role="alert" hidden></div><button class="button" type="submit">保存学习要求</button></form></section>${requirements.length?`<div class="table-wrap"><table><thead><tr><th>清单</th><th>适用路径</th><th>已配置课程</th><th>操作</th></tr></thead><tbody>${requirements.map(r=>`<tr><td>${esc(r.name)}</td><td>${r.role==='all'?'所有学员':esc(roleName(r.role))}</td><td>${r.courseIds.length}门</td><td><a href="#admin/requirements/${enc(r.id)}">编辑</a> <button class="text-button danger" data-action="delete-requirement" data-id="${esc(r.id)}" data-version="${r.version}">撤销</button></td></tr>`).join('')}</tbody></table></div>`:empty('尚未配置学习要求','学员可以自主选课。不会根据课程库存自动生成强制完成率。')}`;
}
function adminCourseEditor(c){
  if(!c)throw new ApiError('课程未找到',404,'NOT_FOUND');state.editCourse=c;
  return `<a class="back-link" href="#admin/courses">${icon('arrow')}返回课程清单</a>${title('补充课程与资料',c.title)}<section class="panel edit-box">${c.conflicts.length?`<div class="notice">源表已更新，以下人工字段存在冲突：${c.conflicts.map(k=>esc(fieldNames[k]||k)).join('、')}。请比较来源原值与当前值，再确认保留或恢复。</div>`:''}<form id="course-edit-form" data-id="${esc(c.id)}" data-version="${c.version}"><div class="form-grid"><label class="form-field wide">课程名称<input name="title" required maxlength="400" value="${esc(c.title)}"></label><label class="form-field">课程分类<select name="category">${state.categories.map(r=>option(r.id,r.name,c.category)).join('')}</select></label><label class="form-field">讲师（以顿号或逗号分隔）<input name="lecturers" value="${esc(c.lecturers.join('、'))}"></label><label class="form-field wide">课程介绍与目标<textarea name="description">${esc(c.description)}</textarea></label><label class="form-field wide">适用对象<textarea name="audience">${esc(c.audience)}</textarea></label><label class="form-field">核验课程时长（分钟）<input name="durationMinutes" type="number" min="1" max="1440" value="${c.durationMinutes??''}" placeholder="未核验时留空"></label><label class="form-field">核验历史开课日期<input name="normalizedDate" type="date" value="${c.normalizedDate||''}"></label><label class="form-field wide">历史日期核验依据<input name="dateBasis" value="${esc(c.dateBasis||'')}" placeholder="填写原表年度、课件文件名等真实依据"></label></div><label class="check-line"><input type="checkbox" name="enabled" ${c.enabled?'checked':''}>在课程资源库显示本课程</label><label class="check-line"><input type="checkbox" name="restricted" ${c.restricted?'checked':''} ${c.sourceSnapshot.restricted?'disabled':''}>管理受限（源表已限定时不能在本平台解除）</label><h2>资料与回放</h2>${c.resources.map(r=>resourceEditor(r)).join('')}${c.conflicts.length?'<label class="check-line"><input name="resolveConflicts" type="checkbox" required>已对照来源，确认本次补充并解决上述冲突。</label>':''}<details class="source-comparison"><summary>对照来源原文（revision ${c.source.revision}）</summary><div class="prose">${esc(c.sourceSnapshot.fields.title.text)}<br>${esc(c.sourceSnapshot.fields.description.text)}<br>适用：${esc(c.sourceSnapshot.fields.audience.text)}<br>${['reading','slides','recordings','other'].map(k=>`${resourceNames[k]}：${esc(c.sourceSnapshot.fields[k].text)}`).join('<br>')}</div><a href="${esc(c.source.url)}" target="_blank" rel="noopener">打开原表位置</a></details><div id="form-error" hidden role="alert"></div><div class="button-row"><button class="button" type="submit">保存课程补充</button><button class="secondary" type="button" data-action="reset-source">恢复为来源值后再保存</button></div></form></section>`;
}
function resourceEditor(r){return `<section class="admin-resource" data-resource="${esc(r.type)}"><h3>${esc(resourceNames[r.type])}</h3><label class="form-field">保留的资料说明<textarea class="resource-description">${esc(r.text)}</textarea></label><div class="resource-editor-links">${r.links.map(resourceEditorLink).join('')}</div><button class="secondary" type="button" data-action="add-resource">添加资料入口</button></section>`;}
function resourceEditorLink(l={}){return `<div class="resource-editor-row" data-basis="${esc(l.url_basis||'admin_verified_input')}"><label>入口名称<input class="resource-title" value="${esc(l.title||'')}" maxlength="1000"></label><label>飞书 / 公司HTTPS地址<input class="resource-url" type="url" value="${esc(l.url||'')}" required></label><button type="button" class="text-button danger" data-action="remove-resource">移除</button></div>`;}
function importPreviewHtml(result){const p=result.plan;return `<section class="panel"><h2>导入差异预览</h2><div class="import-summary">${[['new','新增'],['changed','变化'],['unchanged','未变'],['conflicts','人工冲突'],['possibleDuplicates','疑似重复'],['missingFromSnapshot','本次快照未含']].map(([k,label])=>`<span><strong>${p[k].length}</strong> ${label}</span>`).join('')}</div>${p.possibleDuplicates.length?'<div class="notice">检测到可能重建的课程身份，本次导入被阻止。请核对原标题块；平台不会自动合并或迁移已有学习记录。</div>':''}${['new','changed','conflicts','possibleDuplicates','missingFromSnapshot','missingResources','restricted'].filter(k=>p[k].length).map(k=>`<details class="source-comparison" ${['changed','conflicts','possibleDuplicates'].includes(k)?'open':''}><summary>${({new:'新增课程',changed:'变化课程',conflicts:'与人工补充冲突',possibleDuplicates:'疑似身份重复',missingFromSnapshot:'快照未包含，保留现有课程',missingResources:'资源缺口',restricted:'原表管理受限'})[k]}（${p[k].length}）</summary>${p[k].map(c=>`<p>${esc(c.title)}${c.fields?` · ${c.fields.map(f=>esc(fieldNames[f]||f)).join('、')}`:''}${c.reason?` · ${esc(c.reason)}`:''}</p>`).join('')}</details>`).join('')}<form id="import-apply-form" data-preview="${esc(result.previewId)}"><label class="check-line"><input name="confirmed" type="checkbox" required ${p.possibleDuplicates.length?'disabled':''}>我已校对差异；来源更新时保留人工值，冲突项留待课程编辑确认。</label><div id="import-error" role="alert" hidden></div><button class="button" type="submit" ${p.possibleDuplicates.length?'disabled':''}>确认更新品营课程底座</button></form><p class="small">预览有效至 ${dateTime(result.expiresAt)}；课程发生变化后需重新预览。</p></section>`;}
function updateProgressRecord(p){if(!p)return;const old=progressFor(p.courseId)|| (state.detail?.course.id===p.courseId?state.detail.progress:null);p={...p,activeSeconds:Math.max(old?.activeSeconds||0,p.activeSeconds||0),status:old?.status==='completed'?'completed':p.status,completedAt:old?.completedAt||p.completedAt};if(state.progress){const i=state.progress.records.findIndex(r=>r.courseId===p.courseId);if(i===-1)state.progress.records.push(p);else state.progress.records[i]=p;}if(state.detail?.course.id===p.courseId)state.detail.progress=p;}
function patchCourses(params){
  const next=document.createElement('template');next.innerHTML=coursesPage(params);
  for(const selector of ['.category-tabs','#filter-status','#course-results']){
    const old=$(selector),replacement=next.content.querySelector(selector);
    if(old&&replacement){old.innerHTML=replacement.innerHTML;old.hidden=replacement.hidden;}
  }
  for(const el of document.querySelectorAll('#course-filter input,#course-filter select,#filter-path')){
    el.value=params.get(el.name)||(el.name==='category'?'all':'');
  }
  const summary=next.content.querySelector('.advanced-filters summary');
  if(summary)$('.advanced-filters summary').innerHTML=summary.innerHTML;
}
function loadingPage(parts){
  const headings={courses:'课程目录',course:'课程详情',learning:'我的学习',schedule:'月排期',leaderboard:'排行榜',profile:'个人资料'};
  const sections={courses:'课程与资料',course:'课程与资料',learners:'学员与授权',progress:'学习台账',feedback:'课程反馈',schedule:'培训排期',announcement:'部门公告',requirements:'学习要求',audit:'变更记录'};
  const section=parts[1]||'courses',heading=parts[0]==='admin'?(sections[section]||'学习管理'):(headings[parts[0]]||'页面');
  const content=`<section class="loading-page" role="status" aria-live="polite"><h1>${esc(heading)}</h1><p>正在加载${esc(heading)}，请稍候…</p><div class="skeleton large" aria-hidden="true"></div><div class="skeleton" aria-hidden="true"></div></section>`;
  return parts[0]==='admin'&&state.me?.isAdmin?`<div class="admin-layout">${adminNavigation(section==='course'?'courses':section)}<section class="admin-content">${content}</section></div>`:content;
}
async function render(){
  if(state.accessDenied)return;
  const epoch=++state.routeEpoch,raw=location.hash.slice(1)||'courses',[path,query='']=raw.split('?'),parts=path.split('/'),params=new URLSearchParams(query),main=$('#main');
  if(parts[0]==='courses'&&main.dataset.route==='courses') {patchCourses(params);main.removeAttribute('aria-busy');updateNav();return;}
  captureDraft();void stopStudy();main.setAttribute('aria-busy','true');main.dataset.route='loading';main.innerHTML=loadingPage(parts);updateNav();keepAdminNavVisible();
  try{
    let html;
    if(parts[0]==='courses'){void loadAnnouncement();await loadData();if(epoch!==state.routeEpoch)return;selectFeatured();html=coursesPage(params);}
    else if(parts[0]==='course')html=await detailPage(decodeURIComponent(parts[1]||''),epoch);
    else if(parts[0]==='learning')html=await learningPage();
    else if(parts[0]==='schedule')html=await schedulePage(params);
    else if(parts[0]==='leaderboard')html=await leaderboardPage(params);
    else if(parts[0]==='profile')html=profilePage();
    else if(parts[0]==='admin')html=await adminPage(parts[1]||'courses',parts[2]?decodeURIComponent(parts[2]):null,params);
    else throw new ApiError('页面未找到，请返回课程资源库',404,'NOT_FOUND');
    if(epoch!==state.routeEpoch)return;
    updateNav();main.innerHTML=html;main.dataset.route=parts[0];decorateTables();keepAdminNavVisible();
    $('#feedback-dialog')?.addEventListener('cancel',()=>captureDraft());
    $('#feedback-dialog')?.addEventListener('close',()=>captureDraft());
    window.scrollTo({top:0,behavior:'instant'});
    if(parts[0]==='course'&&state.detail.course.canLearn){paintStudyProgress();await startStudy(state.detail.course.id,epoch);}
    if(epoch===state.routeEpoch)document.title=`${$('#main h1')?.textContent||'品牌营销部'} · 学习平台`;
  }catch(error){if(epoch===state.routeEpoch){main.dataset.route='error';main.innerHTML=parts[0]==='admin'&&state.me?.isAdmin?`<div class="admin-layout">${adminNavigation(parts[1]==='course'?'courses':parts[1]||'courses')}<section class="admin-content">${errorView(error)}</section></div>`:errorView(error);}}
  finally{if(epoch===state.routeEpoch)main.removeAttribute('aria-busy');}
}
function videoEntryHtml(link){return playerHtml(link);}
function studyActivity(){const frame=$('#player iframe'),focusedVideo=frame&&document.activeElement===frame;return {visible:state.hostVisible&&document.visibilityState==='visible'&&document.hasFocus(),age:focusedVideo?0:(performance.now()-state.activityAt)/1000};}
function paintStudyProgress(){
  const c=state.detail?.course,el=$('#study-duration');if(!c||!el)return;
  const study=state.study,activity=studyActivity();let seconds=state.detail.progress?.activeSeconds||0;
  if(study&&activity.visible&&activity.age<=90&&!study.syncFailed)seconds+=Math.min(20,Math.max(0,(performance.now()-study.confirmedAt)/1000));
  const selected=state.detail.selectedVideo,total=['sequential','administrator'].includes(c.durationBasis)?courseSeconds(c):(selected?.durationSeconds||courseSeconds(c));
  el.textContent=`已学习 ${minutes(seconds)}${total?` / 预计 ${Math.ceil(total/60)} 分钟`:''}`;
  const track=$('.progress-track');if(track&&total){const pct=Math.min(100,seconds/total*100);track.setAttribute('aria-valuenow',String(Math.floor(pct)));track.setAttribute('aria-valuetext',`${Math.floor(pct)}%，已学习${minutes(seconds)}`);$('#study-fill').style.width=`${pct}%`;$('#progress-percent').textContent=`${Math.floor(pct)}%`;}
}

async function startStudy(courseId,epoch){
  const sessionId=crypto.randomUUID(),ownerId=state.me.id,authEpoch=state.authEpoch;
  try{const result=await api('study-sessions',{method:'POST',body:{courseId,sessionId}});if(epoch!==state.routeEpoch||!ownsLearning({ownerId,authEpoch}))return;updateProgressRecord(result.progress);
    state.activityAt=performance.now();state.study={courseId,sessionId,ownerId,authEpoch,seq:0,lastAt:performance.now(),busy:false,pending:null,confirmedAt:performance.now(),syncFailed:false};armStudyTimers(state.study);updateTimerState();paintStudyProgress();
  }catch(error){if(epoch===state.routeEpoch&&$('#timer-state'))$('#timer-state').textContent='暂时无法同步学习记录：'+error.message;}
}
function armStudyTimers(study){
  clearInterval(study.interval);clearInterval(study.paintInterval);
  if(!state.hostVisible)return;
  study.interval=setInterval(()=>tickStudy(),10000);study.paintInterval=setInterval(()=>{paintStudyProgress();updateTimerState();},1000);
}
window.addEventListener('message',event=>{
  if(event.source!==window.parent||event.origin!==location.origin||event.data?.type!=='wis-learning-visibility'||typeof event.data.active!=='boolean')return;
  if(state.hostVisible===event.data.active)return;
  state.hostVisible=event.data.active;captureDraft();
  const player=$('#player');
  if(!state.hostVisible&&player?.querySelector('iframe')){state.suspendedVideo=true;player.querySelector('iframe').remove();}
  else if(state.hostVisible&&state.suspendedVideo){state.suspendedVideo=false;if(player&&state.detail?.selectedVideo)player.innerHTML=videoEntryHtml(state.detail.selectedVideo);}
  const study=state.study;
  if(study){study.lastAt=performance.now();study.confirmedAt=performance.now();if(study.pending)study.pending.visible=false;armStudyTimers(study);void tickStudy(study);}
  if(state.hostVisible)state.activityAt=performance.now();updateTimerState();paintStudyProgress();
});
function updateTimerState(){const el=$('#timer-state');if(!el||!state.study)return;const a=studyActivity();el.textContent=state.study.syncFailed?'连接中，正在恢复学习记录':a.visible&&a.age<=90?'正在学习':'学习计时已暂停';}

async function tickStudy(study=state.study){
  if(!study || study.busy||!ownsLearning(study))return;study.busy=true;const now=performance.now();
  const activity=studyActivity(),visible=activity.visible;
  const payload=study.pending||{sessionId:study.sessionId,seq:study.seq+1,visible,activityAgeSeconds:activity.age,elapsedSeconds:Math.min(20,(now-study.lastAt)/1000)};
  if(!visible)payload.visible=false;study.pending=payload;study.lastAt=now;
  try{const result=await api('study-sessions/tick',{method:'POST',body:payload});if(!ownsLearning(study))return;study.seq=payload.seq;study.pending=null;study.confirmedAt=performance.now();study.syncFailed=false;updateProgressRecord(result.progress);if(state.study===study){paintStudyProgress();updateTimerState();}}
  catch(error){study.syncFailed=true;if(state.study===study){paintStudyProgress();updateTimerState();}}
  finally{study.busy=false;}
}
async function stopStudy(){const study=state.study;if(!study)return;clearInterval(study.interval);clearInterval(study.paintInterval);state.study=null;await tickStudy(study);}
function ownsLearning(context){return !!context&&context.ownerId===state.me?.id&&context.authEpoch===state.authEpoch&&!state.accessDenied;}
function captureDraft(){const form=$('#feedback-form');if(!form||!ownsLearning(state.detail)||state.detail.course.id!==form.dataset.course||state.detail.draft.pendingPayload)return;const d=new FormData(form),old=state.detail.draft;const next={requestId:old.requestId||crypto.randomUUID(),rating:d.get('rating')||'',doubts:d.get('doubts')||'',suggestions:d.get('suggestions')||'',application:d.get('application')||''};state.detail.draft=next;saveLocal(draftKey(form.dataset.course,state.detail.ownerId),next);if($('#draft-state'))$('#draft-state').textContent='反馈草稿已保存在当前浏览器。';}
function pendingUI(pending){const form=$('#feedback-form');if(!form)return;form.querySelector('fieldset').disabled=pending;form.querySelector('[data-action="read-receipt"]').hidden=!pending;$('#feedback-submit').textContent=pending?'检查并重试':'提交反馈并确认完成';}
function feedbackError(error){const el=$('#feedback-error');el.hidden=false;el.className='inline-error';el.innerHTML=esc(error.message)+(error.status===401?` <a href="${rootBase}session/resume">重新登录并返回</a>`:'');if(error.status===401)sessionStorage.setItem('bmt-return',location.hash);}
function confirmedFeedback(receipt,detail=state.detail){
  if(!ownsLearning(detail))return false;
  updateProgressRecord(receipt.progress);detail.feedback=receipt.feedback;
  detail.draft={requestId:crypto.randomUUID(),rating:receipt.feedback.rating,doubts:receipt.feedback.doubts,suggestions:receipt.feedback.suggestions,application:receipt.feedback.application};
  try{localStorage.removeItem(draftKey(receipt.feedback.courseId,detail.ownerId));}catch{}
  if(state.detail!==detail||$('#feedback-form')?.dataset.course!==receipt.feedback.courseId)return;
  const el=$('#saved-receipt');if(el){el.hidden=false;el.className='success-note flash-confirmed';el.textContent=`反馈已保存：${dateTime(receipt.feedback.savedAt)} · ${receipt.feedback.rating}分 · 已完成`;}
  if($('#course-status'))$('#course-status').innerHTML='<span class="badge green">已完成</span>';if($('#feedback-entry-label'))$('#feedback-entry-label').textContent='查看与更新反馈';if($('.lesson-actions strong'))$('.lesson-actions strong').textContent='已完成本课学习';
  if($('#feedback-error'))$('#feedback-error').hidden=true;
  if($('#draft-state'))$('#draft-state').textContent='反馈已保存，谢谢你的分享。';pendingUI(false);toast('反馈已保存，本课已完成');
}
async function readReceipt(showError=true,detail=state.detail){
  const pending=detail?.draft.pendingPayload;if(!pending)return false;
  if(!ownsLearning(detail))throw new ApiError('登录状态已变化，请重新打开课程',409,'SESSION_CHANGED');
  try{const receipt=await api(`feedback/${enc(pending.requestId)}`);if(!ownsLearning(detail))throw new ApiError('登录状态已变化，请重新打开课程',409,'SESSION_CHANGED');confirmedFeedback(receipt,detail);return true;}catch(error){if(error.status===404)return false;if(showError&&state.detail===detail&&$('#feedback-error'))feedbackError(error);throw error;}
}
async function submitFeedback(form){
  if(!ownsLearning(state.detail)||!form.isConnected)return;
  if(!state.detail.draft.pendingPayload)captureDraft();const detail=state.detail,draft=detail.draft;
  if(!draft.pendingPayload){draft.pendingPayload={requestId:draft.requestId,courseId:form.dataset.course,rating:Number(draft.rating),doubts:draft.doubts,suggestions:draft.suggestions,application:draft.application};saveLocal(draftKey(form.dataset.course),draft);}
  const button=$('#feedback-submit');button.disabled=true;button.textContent='正在保存…';pendingUI(true);$('#feedback-error').hidden=true;
  try{if(await readReceipt(false,detail))return;if(!ownsLearning(detail)||state.detail!==detail||!form.isConnected)return;const receipt=await api('feedback',{method:'POST',body:draft.pendingPayload});confirmedFeedback(receipt,detail);}
  catch(error){
    let saved=false;
    if(ownsLearning(detail)&&(error.status===0||error.status>=500))try{saved=await readReceipt(false,detail);}catch{}
    if(!saved&&state.detail===detail&&form.isConnected){feedbackError(error);$('#draft-state').textContent='暂未确认保存结果，填写内容已保留。请检查保存结果或重试。';}
  }finally{if(state.detail===detail&&form.isConnected&&$('#feedback-submit')){$('#feedback-submit').disabled=false;$('#feedback-submit').textContent=detail.draft.pendingPayload?'检查并重试':'更新反馈';}}
}
function formError(error,selector='#form-error'){const el=$(selector);if(el){el.hidden=false;el.className='inline-error';el.textContent=error.message+(error.status===409?'。输入已保留，先对照最新记录再保存。':'');}else toast(error.message);}
async function busyButton(button,label,action){
  if(button.disabled||button.dataset.pending==='true')return;
  const original=button.innerHTML,previousBusy=button.getAttribute('aria-busy');
  button.dataset.pending='true';button.disabled=true;button.setAttribute('aria-busy','true');button.textContent=label;
  try{return await action();}finally{delete button.dataset.pending;button.disabled=false;button.innerHTML=original;if(previousBusy===null)button.removeAttribute('aria-busy');else button.setAttribute('aria-busy',previousBusy);}
}
async function saveForm(form,action){
  if(form.dataset.submitting==='true')return;
  const button=form.querySelector('button[type="submit"]');if(!button||button.disabled)return;
  form.dataset.submitting='true';form.setAttribute('aria-busy','true');
  try{await busyButton(button,form.id==='import-form'?'正在读取…':'正在保存…',action);}
  catch(error){if(form.isConnected)formError(error,form.id==='import-apply-form'?'#import-error':'#form-error');else toast(error.message);}
  finally{delete form.dataset.submitting;form.removeAttribute('aria-busy');}
}
function navigateTo(hash){if(location.hash.slice(1)===hash)return render();location.hash=hash;}
function formObject(form){return Object.fromEntries(new FormData(form));}
function sourceView(c){const s=c.sourceSnapshot,f=s.fields;return {title:f.title.text,category:s.proposed_category,lecturers:f.lecturers.lecturers.map(x=>x.name),description:f.description.text,audience:f.audience.text,durationMinutes:s.duration_minutes,resources:['reading','slides','recordings','other'].map(type=>({type,text:f[type].text,links:f[type].links.map(l=>({title:l.title||'',url:l.url,url_basis:l.url_basis||'admin_verified_input'}))})),enabled:true,restricted:s.restricted};}
function courseOverrides(form){const d=formObject(form),c=state.editCourse;const values={title:d.title.trim(),category:d.category,lecturers:d.lecturers.split(/[、,，]/).map(x=>x.trim()).filter(Boolean),description:d.description.trim(),audience:d.audience.trim(),durationMinutes:d.durationMinutes?Number(d.durationMinutes):null,enabled:!!d.enabled,restricted:c.sourceSnapshot.restricted||!!d.restricted};
  values.resources=[...form.querySelectorAll('[data-resource]')].map(group=>({type:group.dataset.resource,text:group.querySelector('.resource-description').value,links:[...group.querySelectorAll('.resource-editor-row')].map(row=>({title:row.querySelector('.resource-title').value,url:row.querySelector('.resource-url').value,url_basis:row.dataset.basis}))}));
  const baseline=sourceView(c),initial={...c,resources:c.resources.map(r=>({type:r.type,text:r.text,links:r.links.map(l=>({title:l.title||'',url:l.url,url_basis:l.url_basis||'admin_verified_input'}))}))},overrides={...c.overrides};
  for(const [k,v]of Object.entries(values)){if(JSON.stringify(v)===JSON.stringify(initial[k]))continue;if(JSON.stringify(v)===JSON.stringify(baseline[k]))delete overrides[k];else overrides[k]=v;}
  if(d.normalizedDate){overrides.normalizedDate=d.normalizedDate;overrides.dateBasis=d.dateBasis.trim();}return overrides;
}
function mergeSaved(rows,item,key='id'){return rows?.some(row=>row[key]===item[key])?rows.map(row=>row[key]===item[key]?item:row):[item,...(rows||[])];}
function paintAdminContent(section,content,hash){
  const host=$('.admin-content');if(!host)return;
  if(hash)history.replaceState(null,'','#'+hash);
  state.routeEpoch++;host.innerHTML=content;$('#main').dataset.route='admin';$('#main').removeAttribute('aria-busy');
  document.querySelectorAll('.admin-nav a').forEach(a=>{const active=a.hash==='#admin/'+section;a.classList.toggle('active',active);if(active)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
  decorateTables();document.title=`${$('#main h1')?.textContent||'学习管理'} · 学习平台`;
}
document.addEventListener('submit',async event=>{
  const form=event.target;if(!(form instanceof HTMLFormElement))return;event.preventDefault();
  if(form.id==='access-single-form'||form.id==='access-batch-form'){await accessManager.submit(form);return;}
  if(form.id==='feedback-form'){if(!form.querySelector('#feedback-submit')?.disabled)await submitFeedback(form);return;}
  if(form.id==='course-filter'){const params=new URLSearchParams(formObject(form));for(const [k,v]of [...params])if(!v)params.delete(k);location.hash='courses?'+params;return;}
  await saveForm(form,async()=>{
    const d=formObject(form);
    if(form.id==='lm-course-form'){const payload=courseCreatePayload(form),result=await api('admin/courses',{method:'POST',body:payload});const known=state.adminCourses!==null;state.adminCourses=mergeSaved(state.adminCourses,result.course);toast('课程已保存');if(form.isConnected){if(known)paintAdminContent('courses',adminCoursesContent(),'admin/courses');else await navigateTo('admin/courses');}}
    else if(form.id==='profile-form'){const result=await api('me',{method:'PATCH',body:{jobRole:d.jobRole}});state.me=result.user;updateNav();toast('个人资料已保存');}
    else if(form.id==='learner-form'){const result=await api(`admin/learners/${enc(form.dataset.id)}`,{method:'PATCH',body:{center:d.center||null,jobRole:d.jobRole,managementAccess:!!d.managementAccess,courseIds:new FormData(form).getAll('courseIds')}});state.learners=mergeSaved(state.learners,result.learner);if(result.learner.id===state.me.id){state.me={...state.me,center:result.learner.center,jobRole:result.learner.jobRole,managementAccess:result.learner.managementAccess};updateNav();}toast('学员设置已保存');}
    else if(form.id==='course-edit-form'){const result=await api(`admin/courses/${enc(form.dataset.id)}`,{method:'PATCH',body:{version:Number(form.dataset.version),overrides:courseOverrides(form),resolvedFields:d.resolveConflicts?state.editCourse.conflicts:[]}});state.editCourse=result.course;state.adminCourses=mergeSaved(state.adminCourses,result.course);if(form.isConnected){form.dataset.version=result.course.version;if(!result.course.conflicts.length)form.querySelector('[name=resolveConflicts]')?.closest('label')?.remove();}toast('课程补充已保存');}
    else if(form.id==='announcement-form'){const result=await api('admin/announcements',{method:'PUT',body:{title:d.title,body:d.body,galleryUrl:d.galleryUrl,version:Number(form.dataset.version)}});state.announcement=result.announcement;readRequests.prime('announcements',{announcement:result.announcement});if(form.isConnected)form.dataset.version=result.announcement.version;toast('公告已保存');}
    else if(form.id==='schedule-form'){const result=await api(`admin/schedule/${enc(form.dataset.id)}`,{method:'PUT',body:{date:d.date,time:d.time,title:d.title,courseId:d.courseId||null,location:d.location,notes:d.notes,version:Number(form.dataset.version)}}),selected=result.event.date.slice(0,7);if(state.scheduleMonth!==selected)state.scheduleEvents=(await api(`schedule?month=${selected}`)).events;else state.scheduleEvents=mergeSaved(state.scheduleEvents,result.event);state.scheduleMonth=selected;toast('已确认排期已保存');if(form.isConnected)paintAdminContent('schedule',adminScheduleContent(selected,state.scheduleEvents),`admin/schedule?month=${selected}`);}
    else if(form.id==='requirement-form'){const result=await api(`admin/requirements/${enc(form.dataset.id)}`,{method:'PUT',body:{name:d.name,role:d.role,courseIds:new FormData(form).getAll('courseIds'),version:Number(form.dataset.version)}});state.requirements=mergeSaved(state.requirements,result.requirement);toast('学习要求已保存');if(form.isConnected)paintAdminContent('requirements',adminRequirementsContent(state.requirements),'admin/requirements');}
    else if(form.id==='import-form'){const file=form.querySelector('input[type=file]').files[0];if(!file||file.size>3*1024*1024)throw new Error('请选择3MB以内的来源快照文件');let inventory;try{inventory=JSON.parse(await file.text());}catch{throw new Error('文件不是有效JSON，请重新生成来源快照');}const result=await api('admin/import/preview',{method:'POST',body:{inventory}});$('#import-preview').innerHTML=importPreviewHtml(result);decorateTables();}
    else if(form.id==='import-apply-form'){if(!d.confirmed)throw new Error('请先校对导入差异');const result=await api('admin/import/apply',{method:'POST',body:{previewId:form.dataset.preview}});$('#import-preview').innerHTML=`<div class="success-note">导入已保存：${dateTime(result.savedAt)}。新增${result.new||0}条，变化${result.changed||0}条；冲突项${result.conflicts||0}条待校对。<a href="#admin/courses">返回课程清单</a></div>`;}
  });
});
function keepAdminNavVisible(){
  const nav=$('.admin-nav'),active=nav?.querySelector('[aria-current="page"]');
  if(nav&&active&&nav.scrollWidth>nav.clientWidth)nav.scrollLeft=Math.max(0,active.offsetLeft-nav.offsetLeft-(nav.clientWidth-active.offsetWidth)/2);
}
function decorateTables(){
  document.querySelectorAll('.table-wrap').forEach(wrap=>{
    const table=wrap.querySelector('table');if(!table)return;
    const headings=[...table.querySelectorAll('thead th')].map(th=>th.textContent.trim());
    table.querySelectorAll('tbody tr').forEach(row=>[...row.cells].forEach((cell,index)=>{if(headings[index])cell.dataset.label=headings[index];}));
    if(wrap.scrollWidth>wrap.clientWidth){wrap.tabIndex=0;wrap.setAttribute('role','region');wrap.setAttribute('aria-label','表格，可横向滚动查看完整内容');}
  });
}
function applyTableFilter(){const form=$('#table-filter');if(!form)return;const d=formObject(form),course=!!form.querySelector('select[name=extra] option[value^=bmt-]');let count=0;document.querySelectorAll('tr[data-search]').forEach(row=>{const match=(!d.q||row.dataset.search.includes(d.q.toLowerCase()))&&(!d.center||row.dataset.center===d.center)&&(!d.extra||row.dataset[course?'course':'role']===d.extra);row.hidden=!match;if(match)count++;});if($('[data-filter-count]'))$('[data-filter-count]').textContent=`${count} 条记录`;}
document.addEventListener('input',event=>{accessManager.capture(event.target);if(event.target.closest('#feedback-form'))captureDraft();if(event.target.closest('#table-filter'))applyTableFilter();if(event.target.id==='admin-course-search'){const q=event.target.value.toLowerCase();document.querySelectorAll('[data-admin-course-search]').forEach(row=>{row.hidden=!row.dataset.adminCourseSearch.includes(q);});}});
document.addEventListener('change',event=>{
  if(event.target.id==='access-status')accessManager.capture(event.target);
  if(event.target.id==='filter-path')$('#course-filter')?.requestSubmit();
  if(event.target.id==='mobile-category')location.hash='courses?category='+enc(event.target.value);
  if(event.target.id==='schedule-month')location.hash='schedule?month='+event.target.value;
  if(event.target.id==='admin-schedule-month')location.hash='admin/schedule?month='+event.target.value;
  if(event.target.closest('#table-filter'))applyTableFilter();
  if(event.target.closest('#course-filter')&&event.target.tagName==='SELECT')event.target.closest('form').requestSubmit();
});
document.addEventListener('click',async event=>{
  if(event.target.closest('a.skip')){event.preventDefault();$('#main').focus();window.scrollTo({top:0,behavior:'instant'});return;}const button=event.target.closest('[data-action]');if(!button||button.disabled||button.dataset.pending==='true')return;
  const action=button.dataset.action;
  const labels={boot:'正在检查…',reload:'正在重试…','refresh-progress':'正在刷新…',logout:'正在退出…','preview-role':'正在切换…','select-video':'正在切换…','read-receipt':'正在检查…','delete-schedule':'正在撤销…','delete-requirement':'正在撤销…','export-source':'正在导出…'};
  if(labels[action])await busyButton(button,labels[action],()=>handleAction(button,action));
  else await handleAction(button,action);
});
async function handleAction(button,action){
  try{
    if(await accessManager.action(button))return;
    if(action==='boot'){await boot();return;}
    if(action==='reload'){$('#main').dataset.route='';await render();return;}
    if(action==='refresh-progress'){state.progress=await api('my-progress');await render();return;}
    if(action==='logout'){captureDraft();state.authEpoch++;await stopStudy();await api('logout',{method:'POST',body:{}});sessionStorage.setItem('bmt-return',location.hash);state.me=null;updateNav();$('#main').innerHTML=errorView(new ApiError('你已退出本平台，学习记录和反馈草稿已保留',401,'SIGNED_OUT'));return;}
    if(action==='preview-role'){captureDraft();state.authEpoch++;await stopStudy();await api('preview/identity',{method:'POST',body:{role:button.dataset.role}});await boot();return;}
    if(action==='month-prev'||action==='month-next'){const [year,month]=button.dataset.month.split('-').map(Number),date=new Date(year,month-1+(action==='month-next'?1:-1),1);location.hash=`schedule?month=${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;return;}
    if(action==='open-feedback'){$('#feedback-dialog').showModal();return;}
    if(action==='close-feedback'){captureDraft();$('#feedback-dialog').close();return;}
    if(action==='select-video'){const link=videoLinks(state.detail.course).find(l=>l.url===button.dataset.url);if(!link)return;await stopStudy();if(!button.isConnected)return;state.detail.selectedVideo=link;$('#player').innerHTML=videoEntryHtml(link);$('#original-video').href=link.url;document.querySelectorAll('[data-action="select-video"]').forEach(el=>{const active=el===button;el.classList.toggle('active',active);el.setAttribute('aria-pressed',String(active));});paintStudyProgress();return;}
    if(action==='read-receipt'){const detail=state.detail;button.disabled=true;try{const found=await readReceipt(true,detail);if(!found&&state.detail===detail&&button.isConnected)feedbackError(new ApiError('暂未查到保存结果，请重试提交',404,'NOT_SAVED'));}finally{button.disabled=false;}return;}
    if(action==='add-resource'){button.closest('[data-resource]').querySelector('.resource-editor-links').insertAdjacentHTML('beforeend',resourceEditorLink());return;}
    if(action==='remove-resource'){button.closest('.resource-editor-row').remove();return;}
    if(action==='reset-source'){if(!confirm('恢复表单中的人工补充为来源值？需要点击保存才会写入。'))return;const c=state.editCourse,s=sourceView(c);const reset={...c,...s,overriddenFields:[],overrides:{}};$('#main').innerHTML=`<div class="admin-layout">${adminNavigation('courses')}<section class="admin-content">${adminCourseEditor(reset)}</section></div>`;return;}
    if(action==='delete-schedule'||action==='delete-requirement'){if(!confirm(action==='delete-schedule'?'撤销此培训排期？':'撤销此学习要求？'))return;const path=action==='delete-schedule'?'schedule':'requirements';await api(`admin/${path}/${enc(button.dataset.id)}`,{method:'DELETE',body:{version:Number(button.dataset.version)}});toast('已撤销并保存');if(!button.isConnected)return;if(path==='schedule'){state.scheduleEvents=state.scheduleEvents.filter(row=>row.id!==button.dataset.id);paintAdminContent('schedule',adminScheduleContent(state.scheduleMonth,state.scheduleEvents));}else{state.requirements=state.requirements.filter(row=>row.id!==button.dataset.id);paintAdminContent('requirements',adminRequirementsContent(state.requirements));}return;}
    if(action==='export-source'){const data=await api('admin/source-export'),blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='品营课程来源快照.json';link.click();URL.revokeObjectURL(url);return;}
  }catch(error){toast(error.message);}
}
for(const name of ['pointerdown','keydown','scroll'])document.addEventListener(name,()=>{state.activityAt=performance.now();updateTimerState();},{passive:true,capture:true});
document.addEventListener('visibilitychange',()=>{updateTimerState();tickStudy();});
window.addEventListener('hashchange',()=>render());
window.addEventListener('pagehide',()=>{captureDraft();if(state.study){clearInterval(state.study.interval);clearInterval(state.study.paintInterval);}});
boot();

document.addEventListener('click',event=>handleCourseCreateClick(event,toast));
