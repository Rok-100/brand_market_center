(() => {
  const apiRoot = location.pathname.slice(0, location.pathname.lastIndexOf('/modules/'));
  const devDialog = document.querySelector('#developmentDialog');
  const listRoot = document.querySelector('#developmentList');
  const search = document.querySelector('#developmentSearch');
  const fieldsRoot = document.querySelector('#developmentFields');
  const emptyRoot = document.querySelector('#developmentEmpty');
  const matrixRoot = document.querySelector('#developmentRatingMatrix');
  const profileLayout = document.querySelector('#developmentProfileLayout');
  const state = { ratingDrafts:{}, profileDrafts:{}, profiles:{}, dimensions:['话术','节奏','演绎','控场'], trainingStages:[], courses:[], accounts:[], selected:'', loaded:false };
  const aliases = {'黄芷瞳':'黄芷曈'};
  const canonical = (value) => aliases[String(value || '').trim()] || String(value || '').trim();
  const dEsc = (value) => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  const todayKey = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const roomFor = (name) => Object.entries(D.rooms || {}).find(([,items]) => items.some(item => canonical(item.name) === canonical(name)))?.[0] || state.profiles[canonical(name)]?.account || '待核验';
  const activeNames = () => [...new Set(allHosts().map(item => canonical(item.name)).filter(Boolean))];
  const allNames = () => [...new Set([...activeNames(), ...Object.values(state.profiles).filter(profile => profile?.newcomer).map(profile => canonical(profile.name))])].sort((a,b) => Number(Boolean(state.profiles[b]?.newcomer))-Number(Boolean(state.profiles[a]?.newcomer)) || a.localeCompare(b,'zh-CN'));
  const numeric = (value) => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100 ? Number(value) : null;
  const grade = (value) => ['A','B','C','D'].includes(String(value || '').toUpperCase()) ? String(value).toUpperCase() : '';

  function rememberDrafts() {
    for (const row of matrixRoot.querySelectorAll('[data-rating-name]')) state.ratingDrafts[row.dataset.ratingName] = [...row.querySelectorAll('input,select')].map(input => input.value);
    if (state.selected && fieldsRoot.querySelector('#saveDevelopment')) state.profileDrafts[state.selected] = [...fieldsRoot.querySelectorAll('input,select,textarea')].map(input => ({value:input.value,checked:input.checked}));
  }
  function restoreRatingDrafts() {
    for (const row of matrixRoot.querySelectorAll('[data-rating-name]')) {
      const draft=state.ratingDrafts[row.dataset.ratingName]; if(draft) [...row.querySelectorAll('input,select')].forEach((input,i)=>{if(draft[i]!==undefined)input.value=draft[i]});
    }
  }
  async function devApi(options = {}) {
    if(options.body){const body=JSON.parse(options.body);if(!Object.hasOwn(body,'expectedUpdatedAt'))body.expectedUpdatedAt=state.profiles[canonical(body.name)]?.updatedAt??null;options={...options,body:JSON.stringify(body)}}
    const response = await fetch(`${apiRoot}/api/anchor-development`,{credentials:'same-origin',cache:'no-store',...options,headers:{Accept:'application/json',...(options.body?{'Content-Type':'application/json','X-Requested-With':'XMLHttpRequest'}:{}),...(options.headers||{})}});
    const payload = await response.json().catch(()=>({}));
    if(!response.ok||payload.ok===false) throw Object.assign(new Error(payload.error||'主播成长档案请求失败。'),{status:response.status});
    return payload;
  }

  function gradeSelect(dimension,value,scope='matrix') {
    return `<select aria-label="${dEsc(dimension)}等级" data-${scope}-ability="${dEsc(dimension)}"><option value="">待评</option>${['A','B','C','D'].map(item=>`<option ${item===grade(value)?'selected':''}>${item}</option>`).join('')}</select>`;
  }
  function growthRows(profile) {
    return (profile?.growthRecords || []).filter(item => numeric(item.score) != null && /^\d{4}-\d{2}-\d{2}$/u.test(String(item.date || ''))).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  }
  function growthTrend(profile,name) {
    const rows=growthRows(profile),width=560,height=150,pad=28;
    if(!rows.length) return `<div class="rating-trend-empty">${dEsc(name)} 暂无课程周期成长评分。</div>`;
    const x=index=>rows.length===1?width/2:pad+index*(width-pad*2)/(rows.length-1), y=value=>height-pad-(Number(value)/100)*(height-pad*2), points=rows.map((item,index)=>`${x(index)},${y(item.score)}`).join(' ');
    return `<div class="rating-trend-title"><div><b>${dEsc(name)} · 成长评分趋势</b><span>${rows.length} 期 · 最新 ${rows.at(-1).score} 分</span></div><em>0–100 分</em></div><svg class="rating-trend-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${dEsc(name)}成长评分趋势">${[0,50,100].map(value=>`<g><line x1="${pad}" y1="${y(value)}" x2="${width-pad}" y2="${y(value)}"></line><text x="3" y="${y(value)+4}">${value}</text></g>`).join('')}<polyline points="${points}"></polyline>${rows.map((item,index)=>`<circle cx="${x(index)}" cy="${y(item.score)}" r="4"><title>${dEsc(item.date)} · ${item.score} 分 · ${dEsc(item.coursePeriod||'培养周期')}</title></circle>`).join('')}<text class="date-label" x="${pad}" y="${height-3}">${dEsc(rows[0].date.slice(5))}</text><text class="date-label" x="${width-pad}" y="${height-3}" text-anchor="end">${dEsc(rows.at(-1).date.slice(5))}</text></svg>`;
  }
  function ratingHistory(profile) {
    return (profile?.ratings || []).slice(0,8).map(item => `<span>${dEsc(item.date || '历史')} · ${dEsc(item.overallGrade || '待评')} · ${state.dimensions.map(dimension=>`${dimension} ${grade(item.scores?.[dimension])||'—'}`).join(' / ')}${item.comment?` · ${dEsc(item.comment)}`:''}</span>`).join('') || '<span>尚无 ABCD 周期评级</span>';
  }

  function renderList() {
    const q=search.value.trim().toLowerCase();
    listRoot.innerHTML=allNames().filter(name=>!q||`${name} ${roomFor(name)}`.toLowerCase().includes(q)).map(name=>{const profile=state.profiles[name];return `<button type="button" class="development-list-item ${state.selected===name?'active':''}" data-dev-name="${dEsc(name)}"><span><b>${dEsc(name)}</b><small>${dEsc(profile?.account||roomFor(name))} · ${dEsc(profile?.trainingStage||'培养阶段待录入')}</small></span><em>${profile?.newcomer?'新人池':profile?.courseProgress||'未建档'}</em></button>`}).join('');
    listRoot.querySelectorAll('[data-dev-name]').forEach(button=>button.onclick=()=>selectAnchor(button.dataset.devName));
  }

  function renderMatrix() {
    rememberDrafts();
    const names=activeNames().sort((a,b)=>a.localeCompare(b,'zh-CN'));
    matrixRoot.innerHTML=`<header><div><h3>在职主播周期评级</h3><p>话术、节奏、演绎、控场分别使用 A / B / C / D；不生成趋势，也不换算百分制。</p></div><span>当前在职 ${names.length} 名</span></header><div class="rating-matrix-scroll"><table><thead><tr><th>主播</th>${state.dimensions.map(item=>`<th>${dEsc(item)}</th>`).join('')}<th>评级日期</th><th>一句话评语</th><th>最新综合</th><th></th></tr></thead><tbody>${names.map(name=>{const profile=state.profiles[name]||{};return `<tr data-rating-name="${dEsc(name)}"><td><b>${dEsc(name)}</b><small>${dEsc(profile.account||roomFor(name))}</small></td>${state.dimensions.map(item=>`<td>${gradeSelect(item,profile.abilities?.[item])}</td>`).join('')}<td><input data-rating-date type="date" value="${todayKey()}"></td><td><input data-rating-comment value="" placeholder="本周期表现与下一步"></td><td><strong class="grade-chip grade-${dEsc(profile.latestGrade||'pending')}">${dEsc(profile.latestGrade||'待评')}</strong></td><td><button type="button" data-save-rating>提交</button></td></tr>`}).join('')}</tbody></table></div>`;
    restoreRatingDrafts();
    matrixRoot.querySelectorAll('[data-save-rating]').forEach(button=>button.onclick=()=>saveRatingRow(button));
  }

  async function saveRatingRow(button) {
    const row=button.closest('[data-rating-name]'),name=canonical(row.dataset.ratingName),scores=Object.fromEntries([...row.querySelectorAll('[data-matrix-ability]')].map(input=>[input.dataset.matrixAbility,grade(input.value)])),date=row.querySelector('[data-rating-date]').value,comment=row.querySelector('[data-rating-comment]').value;
    if(Object.values(scores).some(value=>!value)){button.textContent='请填满四项';return}
    button.disabled=true;button.textContent='保存中';
    try {const response=await devApi({method:'POST',body:JSON.stringify({name,abilities:scores,abilityComment:comment,rating:{scores,date,comment}})});state.profiles[name]=response.profile;rememberDrafts();delete state.ratingDrafts[name];row.removeAttribute('data-rating-name');syncProfiles();renderMatrix();renderList()}
    catch(error){button.textContent=error.message}
    finally{button.disabled=false}
  }

  function selectAnchor(rawName) {
    rememberDrafts();
    const name=canonical(rawName);state.selected=name;renderList();const profile=state.profiles[name]||{};
    emptyRoot.hidden=true;fieldsRoot.hidden=false;fieldsRoot.className='development-fields';
    fieldsRoot.innerHTML=`
      <section class="development-card"><h3>${dEsc(name)} · 基础名片 <small>${courseSummary(profile).count}/8</small></h3>${courseProgressMarkup(profile)}<div class="development-identity"><label>当前账号<select id="devAccount">${state.accounts.map(item=>`<option ${item===(profile.account||roomFor(name))?'selected':''}>${dEsc(item)}</option>`).join('')}</select></label><label>入职日期<input id="devJoinDate" type="date" value="${dEsc(profile.joinDate||'')}"></label><label>职务<input id="devTitle" value="${dEsc(profile.title||'主播')}"></label><label>当前资源位<input id="devResource" value="${dEsc(profile.currentResource||'')}"></label></div><label style="margin-top:9px">培养阶段<select id="devStage">${state.trainingStages.map(item=>`<option ${item===profile.trainingStage?'selected':''}>${dEsc(item)}</option>`).join('')}</select></label><div class="newcomer-quick"><label><input id="devNewcomer" type="checkbox" style="width:auto" ${profile.newcomer?'checked':''}>加入新人池</label><button id="quickNewcomer" type="button">加入新人池</button></div></section>
      <section class="development-card"><h3>最近在职周期评级 <small>${dEsc(profile.latestGrade||'待评')}</small></h3><div class="rating-history">${ratingHistory(profile)}</div><label style="margin-top:9px">最近评级评语<textarea id="devAbilityComment" rows="2">${dEsc(profile.abilityComment||'')}</textarea></label></section>
      <section class="development-card"><h3>成长记录 <small>课程周期单次 0–100 分</small></h3><div class="development-rating growth-entry"><label>课程周期<input id="devGrowthPeriod" placeholder="例：基础播感第 2 周"></label><label>评分日期<input id="devGrowthDate" type="date" value="${todayKey()}"></label><label>成长评分<input id="devGrowthScore" type="number" min="0" max="100" step="0.1" placeholder="待录入"></label><label>评语<input id="devGrowthComment" placeholder="本周期进步与下一步"></label></div><div class="profile-trend">${growthTrend(profile,name)}</div></section>
      <section class="development-card"><h3>培养课程 <small id="devCourseCount">${courseSummary(profile).count}/8</small></h3><div id="devCourseProgress">${courseProgressMarkup(profile)}</div><div class="course-grid">${state.courses.map(item=>`<label><input type="checkbox" data-course="${dEsc(item)}" ${profile.courses?.includes(item)?'checked':''}>${dEsc(item)}<span data-dev-course-status>${profile.courses?.includes(item)?'已完课 ✅':'待教学 ⏳'}</span></label>`).join('')}</div></section>
      <section class="development-card"><h3>课程确认记录</h3><div class="rating-history">${(profile.courseHistory||[]).slice(-12).reverse().map(item=>`<span>${dEsc(item.course)} · ${item.completed?'确认完成':'撤销完成'} · ${dEsc(item.submittedBy)} · ${dEsc(item.submittedAt)}</span>`).join('')||'<span>历史勾选未附确认回执；新变更将记录操作人和时间。</span>'}</div></section>
      <div class="development-save"><span id="devSaveStatus">保存后记录操作人和更新时间</span><button id="reloadDevelopment" type="button">重读已保存记录</button><button id="saveDevelopment" type="button">保存成长档案</button></div>`;
    const draft=state.profileDrafts[name];if(draft)[...fieldsRoot.querySelectorAll('input,select,textarea')].forEach((input,i)=>{if(draft[i]){input.value=draft[i].value;input.checked=draft[i].checked}});
    fieldsRoot.querySelectorAll('[data-course]').forEach(input=>input.onchange=()=>{const draft={courses:[...fieldsRoot.querySelectorAll('[data-course]:checked')].map(item=>item.dataset.course)};document.querySelector('#devCourseCount').textContent=courseSummary(draft).count+'/8';document.querySelector('#devCourseProgress').innerHTML=courseProgressMarkup(draft);input.parentElement.querySelector('[data-dev-course-status]').textContent=input.checked?'已完课 ✅':'待教学 ⏳'});
    document.querySelector('#saveDevelopment').onclick=saveProfile;
    document.querySelector('#reloadDevelopment').onclick=async()=>{const button=document.querySelector('#reloadDevelopment');button.disabled=true;rememberDrafts();try{await loadDevelopment();selectAnchor(name);document.querySelector('#devSaveStatus').textContent='已重读服务器记录，当前填写保留。请核对最新评级与课程记录后再保存。'}catch(error){document.querySelector('#devSaveStatus').textContent=error.message}finally{button.disabled=false}};
    document.querySelector('#quickNewcomer').onclick=quickNewcomer;
  }

  async function quickNewcomer() {
    if(!state.selected)return;
    document.querySelector('#devNewcomer').checked=true;
    document.querySelector('#devStage').value=state.trainingStages[0];
    document.querySelector('#devSaveStatus').textContent='已选择加入新人池，点击保存成长档案后生效。';
  }

  async function createNewcomer() {
    const input=document.querySelector('#newcomerName'),button=document.querySelector('#createNewcomer'),name=canonical(input.value);
    if(!name){input.focus();return}
    button.disabled=true;
    try {const response=await devApi({method:'POST',body:JSON.stringify({name,newcomer:true,trainingStage:state.trainingStages[0],account:state.accounts[0]})});state.profiles[name]=response.profile;input.value='';syncProfiles();renderList();selectAnchor(name)}
    catch(error){window.alert(error.message)}
    finally{button.disabled=false}
  }

  async function saveProfile() {
    const name=state.selected;if(!name)return;const button=document.querySelector('#saveDevelopment'),status=document.querySelector('#devSaveStatus'),growthScore=numeric(document.querySelector('#devGrowthScore').value);
    if(document.querySelector('#devGrowthScore').value.trim()!==''&&growthScore==null){status.textContent='成长评分需为 0–100 分；当前填写已保留。';return}
    button.disabled=true;status.textContent='保存中…';
    try {
      const payload={name,account:document.querySelector('#devAccount').value,joinDate:document.querySelector('#devJoinDate').value,title:document.querySelector('#devTitle').value,currentResource:document.querySelector('#devResource').value,trainingStage:document.querySelector('#devStage').value,newcomer:document.querySelector('#devNewcomer').checked,abilityComment:document.querySelector('#devAbilityComment').value,courses:[...fieldsRoot.querySelectorAll('[data-course]:checked')].map(input=>input.dataset.course),growthRecord:growthScore==null?null:{score:growthScore,date:document.querySelector('#devGrowthDate').value,coursePeriod:document.querySelector('#devGrowthPeriod').value,comment:document.querySelector('#devGrowthComment').value}};
      const response=await devApi({method:'POST',body:JSON.stringify(payload)});state.profiles[name]=response.profile;syncProfiles();status.textContent=`已保存 · ${new Date(response.profile.updatedAt).toLocaleString('zh-CN')} · ${response.profile.updatedBy}`;rememberDrafts();delete state.profileDrafts[name];fieldsRoot.innerHTML='';renderList();renderMatrix();selectAnchor(name);document.querySelector('#devSaveStatus').textContent='已保存；评分留空不会新增成长记录。';
    } catch(error){status.textContent=error.message}
    finally{button.disabled=false}
  }

  const fixedCourses = ['沟通稿框架','镜头表现力','基础数据讲解','关键数据解析','节奏把控力','话术结构进阶课','逼单和种草专项课','心态管理课'];
  const courseRoot = document.querySelector('#trainingCourseEditor');
  let selectedCourse = fixedCourses[0], courseNameQuery='', courseAttendanceDrafts=new Map(), courseAddSelection=new Set(), coursePendingRows=new Map();
  let courseDraft = null, courseDirty = false, courseSaving = false, courseLoadError = '', courseMessage = '', courseQuery = '';
  function courseSummary(profile) {
    const completed = new Set((profile?.courses || []).filter(course => fixedCourses.includes(course)));
    return {completed, count:completed.size};
  }
  function courseProgressMarkup(profile) {
    const {count}=courseSummary(profile);
    return `<div class="course-progress"><span>课程完成度 <b>${count}/8</b></span><progress max="8" value="${count}" aria-label="课程完成度 ${count}/8"></progress></div>`;
  }
  function courseCardMarkup(name) {
    if(!state.loaded || courseLoadError) return '<h3>专项课程进程</h3><p>'+(courseLoadError?'课程记录读取失败，请重试。':'课程记录读取中…')+'</p>';
    const profile=state.profiles[canonical(name)], {completed}=courseSummary(profile);
    return '<h3>专项课程进程</h3>'+courseProgressMarkup(profile)+'<ul class="course-status-list">'+fixedCourses.map(course=>`<li><span>${dEsc(course)}</span><b class="${completed.has(course)?'completed':'pending'}">${completed.has(course)?'已完课 ✅':'待教学 ⏳'}</b></li>`).join('')+'</ul>';
  }
  function refreshCourseDisplays() {
    renderCourseEditor();
    document.querySelectorAll('.card [data-course-card]').forEach(section=>section.remove());
    document.querySelectorAll('[data-course-detail]').forEach(section=>section.innerHTML=courseCardMarkup(section.dataset.courseDetail));
  }
  const courseRenderRoomsBase=renderRooms;
  renderRooms=function(){courseRenderRoomsBase();refreshCourseDisplays()};
  function renderCourseEditor() {
    if(!courseRoot)return;
    if(!courseRoot.dataset.courseLayout){
      courseRoot.dataset.courseLayout='by-course';
      courseRoot.innerHTML=`<header><div><h3>主播培训课程</h3><p>左侧选择课程，右侧查看已参加主播；取消勾选后保存才会移除，添加后也请保存。</p></div><span class="course-total">共 8 节</span></header><div class="course-selection-layout"><section class="course-selection-panel"><div class="course-selection-head"><h4>课程名称</h4><span>请选择课程</span></div><div id="courseNameList" class="course-name-list"></div></section><section class="course-selection-panel"><div class="course-selection-head"><h4>已参加主播 <small id="courseAttendeeCount"></small></h4><button type="button" id="addCourseAttendees">＋ 添加完课主播</button><span id="selectedCourseTitle" class="selected-course-caption"></span></div><div id="courseAttendanceList" class="course-attendance-list"></div></section></div><footer><span id="courseEditorStatus" role="status" aria-live="polite"></span><div class="course-save-actions"><button type="button" id="reloadCourses">重读课程记录</button><button type="button" id="saveCourses">保存参加情况</button></div></footer><dialog id="courseAddDialog" class="course-add-dialog" aria-labelledby="courseAddTitle"><header><div><h3 id="courseAddTitle">添加完课主播</h3><p id="courseAddSubtitle"></p></div><button type="button" id="closeCourseAdd" aria-label="关闭添加主播">×</button></header><label class="course-add-search">搜索未参加主播<input id="courseAddSearch" type="search" placeholder="姓名 / 直播间"></label><div id="courseAddList" class="course-add-list"></div><footer><span id="courseAddCount">请选择主播</span><button type="button" id="confirmCourseAdd">加入已参加名单</button></footer></dialog>`;
      courseRoot.querySelector('#courseNameList').onclick=event=>{
        const button=event.target.closest('[data-select-course]');
        if(button&&!courseSaving){selectedCourse=button.dataset.selectCourse;renderCourseLists()}
      };
      courseRoot.querySelector('#courseAttendanceList').onchange=event=>{
        const input=event.target.closest('[data-attendance-name]');
        if(!input||courseSaving||!state.loaded||courseLoadError)return;
        const name=input.dataset.attendanceName;
        if(!coursePendingRows.has(selectedCourse))coursePendingRows.set(selectedCourse,new Set());
        coursePendingRows.get(selectedCourse).add(name);
        let draft=courseAttendanceDrafts.get(name);
        if(!draft){const profile=state.profiles[name];draft={name,courses:[...(profile?.courses||[])],expectedUpdatedAt:profile?.updatedAt??null};courseAttendanceDrafts.set(name,draft)}
        const courses=new Set(draft.courses);
        if(input.checked)courses.add(selectedCourse);else courses.delete(selectedCourse);
        draft.courses=[...courses];courseDirty=true;courseMessage='参加情况已修改，保存后生效。';renderCourseLists();
      };
      courseRoot.querySelector('#addCourseAttendees').onclick=()=>{
        courseAddSelection.clear();courseRoot.querySelector('#courseAddSearch').value='';
        courseRoot.querySelector('#courseAddSubtitle').textContent=selectedCourse+' · 仅显示尚未参加的主播';
        renderCourseAddList();courseRoot.querySelector('#courseAddDialog').showModal();
      };
      courseRoot.querySelector('#closeCourseAdd').onclick=()=>courseRoot.querySelector('#courseAddDialog').close();
      const addSearch=courseRoot.querySelector('#courseAddSearch');
      addSearch.oninput=renderCourseAddList;addSearch.onsearch=renderCourseAddList;
      addSearch.oncompositionend=()=>{renderCourseAddList();requestAnimationFrame(()=>{if(addSearch.isConnected)renderCourseAddList()})};
      courseRoot.querySelector('#courseAddList').onchange=event=>{
        const input=event.target.closest('[data-add-attendee]');if(!input)return;
        if(input.checked)courseAddSelection.add(input.dataset.addAttendee);else courseAddSelection.delete(input.dataset.addAttendee);
        renderCourseAddList();
      };
      courseRoot.querySelector('#confirmCourseAdd').onclick=()=>{
        if(!coursePendingRows.has(selectedCourse))coursePendingRows.set(selectedCourse,new Set());
        for(const name of courseAddSelection){
          coursePendingRows.get(selectedCourse).add(name);
          let draft=courseAttendanceDrafts.get(name);
          if(!draft){const profile=state.profiles[name];draft={name,courses:[...(profile?.courses||[])],expectedUpdatedAt:profile?.updatedAt??null};courseAttendanceDrafts.set(name,draft)}
          if(!draft.courses.includes(selectedCourse))draft.courses.push(selectedCourse);
        }
        courseDirty=!!courseAttendanceDrafts.size;courseMessage='已加入 '+courseAddSelection.size+' 位主播，保存后生效。';
        courseRoot.querySelector('#courseAddDialog').close();renderCourseLists();
      };
      courseRoot.querySelector('#saveCourses').onclick=saveCourses;
      courseRoot.querySelector('#reloadCourses').onclick=async()=>{
        if(courseAttendanceDrafts.size&&!window.confirm('重读会放弃尚未保存的参加情况，继续？'))return;
        try{await loadDevelopment();courseAttendanceDrafts.clear();coursePendingRows.clear();courseDirty=false;courseMessage='已重读最新课程记录。';renderCourseEditor()}catch(error){courseLoadError=error.message;renderCourseEditor()}
      };
    }
    renderCourseLists();
  }
  function renderCourseLists(){
    if(!courseRoot?.dataset.courseLayout)return;
    const disabled=courseSaving||!state.loaded||!!courseLoadError;
    const courses=fixedCourses.filter(course=>course.includes(courseNameQuery.trim()));
    courseRoot.querySelector('#courseNameList').innerHTML=courses.map(course=>`<button type="button" class="course-choice ${course===selectedCourse?'active':''}" data-select-course="${dEsc(course)}" aria-pressed="${course===selectedCourse}" ${disabled?'disabled':''}><span>${dEsc(course)}</span><span aria-hidden="true">›</span></button>`).join('')||'<p class="course-list-empty">没有匹配课程</p>';
    courseRoot.querySelector('#selectedCourseTitle').textContent=selectedCourse;
    const query=courseQuery.trim().toLowerCase();
    const attendees=allNames().filter(name=>courseSummary(state.profiles[name]).completed.has(selectedCourse)||courseSummary(courseAttendanceDrafts.get(name)).completed.has(selectedCourse)||coursePendingRows.get(selectedCourse)?.has(name));
    courseRoot.querySelector('#courseAttendeeCount').textContent='（'+attendees.length+'人）';
    const names=attendees.filter(name=>!query||`${name} ${roomFor(name)}`.toLowerCase().includes(query));
    courseRoot.querySelector('#courseAttendanceList').innerHTML=names.map(name=>{
      const profile=courseAttendanceDrafts.get(name)||state.profiles[name],completed=courseSummary(profile),checked=completed.completed.has(selectedCourse);
      return `<div class="course-attendance-row ${checked?'attended':''}"><span class="attendance-person"><b>${dEsc(name)}</b><small>${dEsc(roomFor(name))} · 已完课 ${completed.count}/8${courseAttendanceDrafts.has(name)?' · 未保存':''}</small></span><span class="attendance-state">${checked?'已参加':'待移除 · 未保存'}</span><input type="checkbox" data-attendance-name="${dEsc(name)}" aria-label="${dEsc(name+' · '+selectedCourse+' · 是否参加')}" ${checked?'checked':''} ${disabled?'disabled':''}></div>`;
    }).join('')||'<p class="course-list-empty">'+(attendees.length?'没有匹配的已参加主播':'本课程暂无已参加主播，请点击上方添加。')+'</p>';
    courseRoot.querySelector('#addCourseAttendees').disabled=disabled;
    for(const input of courseRoot.querySelectorAll('input[type="search"]'))input.disabled=courseSaving;
    courseRoot.querySelector('#saveCourses').disabled=disabled||!courseAttendanceDrafts.size;
    courseRoot.querySelector('#saveCourses').textContent=courseSaving?'保存中…':`保存参加情况${courseAttendanceDrafts.size?'（'+courseAttendanceDrafts.size+'人）':''}`;
    courseRoot.querySelector('#reloadCourses').disabled=courseSaving;
    courseRoot.querySelector('#courseEditorStatus').textContent=courseLoadError||courseMessage||(!state.loaded?'正在读取课程记录…':'仅显示已参加主播；取消勾选后该行保留，保存成功才移除。');
  }
  function renderCourseAddList(){
    const query=courseRoot.querySelector('#courseAddSearch').value.trim().toLowerCase();
    const names=allNames().filter(name=>!courseSummary(courseAttendanceDrafts.get(name)||state.profiles[name]).completed.has(selectedCourse)&&(!query||`${name} ${roomFor(name)}`.toLowerCase().includes(query)));
    courseRoot.querySelector('#courseAddList').innerHTML=names.map(name=>`<label class="course-attendance-row course-add-choice"><span class="attendance-person"><b>${dEsc(name)}</b><small>${dEsc(roomFor(name))}</small></span><input type="checkbox" data-add-attendee="${dEsc(name)}" aria-label="${dEsc('添加 '+name)}" ${courseAddSelection.has(name)?'checked':''}></label>`).join('')||'<p class="course-list-empty">没有匹配的未参加主播</p>';
    courseRoot.querySelector('#courseAddCount').textContent='已选择 '+courseAddSelection.size+' 人';
    courseRoot.querySelector('#confirmCourseAdd').disabled=!courseAddSelection.size;
  }
  async function saveCourses(){
    if(courseSaving||!courseAttendanceDrafts.size)return;
    courseSaving=true;courseMessage='正在保存参加情况…';renderCourseEditor();
    let saved=0;const errors=[];
    try{
      for(const [name,draft] of [...courseAttendanceDrafts]){
        try{
          const payload={...draft,courses:[...draft.courses]};
          if(!state.profiles[name])payload.account=roomFor(name);
          const result=await devApi({method:'POST',body:JSON.stringify(payload)});
          state.profiles[name]=result.profile;courseAttendanceDrafts.delete(name);for(const pending of coursePendingRows.values())pending.delete(name);delete state.profileDrafts[name];saved++;
          if(state.selected===name){fieldsRoot.innerHTML='';selectAnchor(name)}
        }catch(error){errors.push(name+'：'+error.message)}
      }
      courseDirty=!!courseAttendanceDrafts.size;
      courseMessage=errors.length?`已保存 ${saved} 人，${errors.length} 人未保存（修改仍保留）：${errors.join('；')}`:`已保存 ${saved} 人，成长档案和详情已同步。`;
      syncProfiles();renderList();
    }finally{courseSaving=false;renderCourseEditor()}
  }

  function syncProfiles() {
    window.anchorDevelopmentProfiles=state.profiles;
    if(typeof renderAll==='function') renderAll();
    refreshCourseDisplays();
    document.querySelectorAll('.card[data-name]').forEach(card => { const name=canonical(card.dataset.name),profile=state.profiles[name]; let line=card.querySelector('[data-latest-grade]'); if(!line){line=document.createElement('div');line.className='line';line.dataset.latestGrade='1';card.querySelector('.comment')?.before(line)} if(line)line.innerHTML=`<span>最新周期评级</span><b>${dEsc(profile?.latestGrade||'待评')}</b>`; });
  }
  async function loadDevelopment() {
    const payload=await devApi();state.profiles=payload.profiles||{};state.dimensions=payload.dimensions||state.dimensions;state.trainingStages=payload.trainingStages||[];state.courses=payload.courses||[];state.accounts=payload.accounts||[];state.loaded=true;courseLoadError='';syncProfiles();renderList();renderMatrix();
  }


  function evidenceMarkup(name,data,developmentError) {
    const evidence=data.evidence||{},sources=data.sources||{},official=data.profile,profile=state.profiles[canonical(name)],growth=growthRows(profile).at(-1);
    const sourceState=Object.values(sources).map(source=>source.name+'：'+(source.available?(source.truncated?'已读取部分消息':'已读取'):'读取失败')).join(' · ');
    const entry=item=>'<small>'+dEsc(item.source)+' · '+dEsc(formatChinaTime(item.createdAt))+(item.appLink?' · <a href="'+dEsc(item.appLink)+'" target="_blank" rel="noopener noreferrer">原消息 ↗</a>':'')+'</small>';
    const media=item=>(item.resources||[]).filter(r=>/\.(mp4|mov|webm|m4v|mp3|wav|m4a|aac|ogg)$/i.test(r.name||'')||['video','audio'].includes(r.type)).map(r=>{
      const audio=r.type==='audio'||/\.(mp3|wav|m4a|aac|ogg)$/i.test(r.name||''),tag=audio?'audio':'video';
      return '<div style="margin-top:8px"><'+tag+' controls preload="none" style="width:100%;max-height:220px" src="'+dEsc(r.url)+'"></'+tag+'><a href="'+dEsc(r.url)+'" target="_blank" rel="noopener noreferrer">打开'+(audio?'录音':'录屏')+'附件 ↗</a></div>';
    }).join('');
    const evaluations=(evidence.evaluations||[]).slice(0,5),recordings=(evidence.recordings||[]).slice(0,6);
    const evaluationEmpty=sources.coaching?.available?(sources.coaching.truncated?'已读取部分消息，暂未找到可明确归属该主播的评价。':'近 5 日暂无可明确归属该主播的评价。'):'评价来源读取失败，请稍后刷新。';
    const recordingEmpty=Object.values(sources).some(s=>!s.available||s.truncated)?'已读取范围内暂无可验证录屏 / 录音；部分来源未完整读取。':'近 3 日暂无可明确归属该主播的录屏 / 录音。';
    return '<h3>主播成长与能力</h3>'+
      (official?'<p><b>飞书主播培养档案</b> · '+dEsc(official.currentGrade||'等级待录入')+'</p><p>'+state.dimensions.map(item=>dEsc(item)+' '+dEsc(official.abilities?.[item]||'待录入')).join(' · ')+'</p>'+(official.strengths?'<p>突出优势：'+dEsc(official.strengths)+'</p>':'')+(official.weaknesses?'<p>明显短板：'+dEsc(official.weaknesses)+'</p>':'')+(official.reviewDocumentUrl?'<p><a href="'+dEsc(official.reviewDocumentUrl)+'" target="_blank" rel="noopener noreferrer">打开主播成长文档 ↗</a></p>':'<small>培养档案未填写成长文档链接。</small>'):'<p>'+ (data.profileSource?.available?'飞书培养档案尚未收录该主播。':'飞书培养档案读取失败，请稍后刷新。')+'</p>')+
      (developmentError?'<p>工作台成长记录读取失败。</p>':profile?'<p><b>工作台周期评级</b> '+dEsc(profile.latestGrade||'待评')+' · '+state.dimensions.map(item=>dEsc(item)+' '+dEsc(grade(profile.abilities?.[item])||'待评')).join(' · ')+'</p><small>'+dEsc(profile.abilityComment||'暂无评级评语')+' · 课程 '+dEsc(profile.courseProgress||'0/8')+(growth?' · 成长 '+dEsc(growth.score)+' 分':'')+'</small>':'<p>工作台暂无人工录入的周期评级 / 成长记录。</p>')+
      '<p><button type="button" data-edit-growth>维护成长档案</button></p><h3>近 5 日可验证评价</h3><div class="evidence-list">'+(evaluations.length?evaluations.map(item=>'<div class="evidence-item" style="white-space:pre-wrap">'+dEsc(item.text)+entry(item)+'</div>').join(''):'<div class="evidence-item">'+evaluationEmpty+'</div>')+'</div><h3>近 3 日录屏 / 录音</h3><div class="evidence-list">'+(recordings.length?recordings.map(item=>'<div class="evidence-item">'+dEsc(item.text||'直播录屏 / 录音')+entry(item)+media(item)+'</div>').join(''):'<div class="evidence-item">'+recordingEmpty+'</div>')+'</div><div class="source-boundary">'+dEsc(sourceState)+'<br>读取时间：'+dEsc(formatChinaTime(data.fetchedAt))+'（最多缓存 1 分钟）</div><button type="button" data-refresh-evidence>刷新资料</button>';
  }
  let evidenceRequest=0;
  const originalOpenAnchor=openAnchor;
  openAnchor=function(name){
    originalOpenAnchor(name);
    const request=++evidenceRequest,grid=document.querySelector('#detail .detail-grid');
    if(!grid)return;
    grid.querySelector('aside.review')?.remove();
    const courseSection=document.createElement('section');courseSection.className='modal-card course-card';courseSection.dataset.courseDetail=canonical(name);courseSection.innerHTML=courseCardMarkup(name);grid.append(courseSection);
    const section=document.createElement('section');section.className='modal-card evidence-card';grid.append(section);
    async function refresh(){
      section.innerHTML='<h3>主播成长与能力</h3><p role="status">正在读取最新培养档案、评价与录屏…</p>';
      const [result,development]=await Promise.allSettled([
        fetch(apiRoot+'/api/lifecycle/anchor-evidence?name='+encodeURIComponent(canonical(name)),{credentials:'same-origin',cache:'no-store'}).then(async response=>{const payload=await response.json();if(!response.ok||payload.ok===false)throw new Error(payload.error||'读取失败');return payload.data}),
        loadDevelopment()
      ]);
      if(request!==evidenceRequest||!section.isConnected)return;
      if(result.status==='rejected')section.innerHTML='<h3>主播成长与能力</h3><p role="alert">最新资料读取失败，请稍后重试。</p><button type="button" data-refresh-evidence>重试</button>';
      else section.innerHTML=evidenceMarkup(name,result.value,development.status==='rejected');
      section.querySelector('[data-refresh-evidence]').onclick=refresh;
      const edit=section.querySelector('[data-edit-growth]');
      if(edit)edit.onclick=async()=>{
        edit.disabled=true;
        try{await loadDevelopment();document.querySelector('#dialog').close();devDialog.showModal();document.querySelector('[data-development-view="profiles"]').click();selectAnchor(name)}
        catch{edit.textContent='档案读取失败，点击重试'}finally{edit.disabled=false}
      };
    }
    refresh();
  };
  document.querySelectorAll('[data-development-view]').forEach(button=>button.onclick=()=>{document.querySelectorAll('[data-development-view]').forEach(item=>item.classList.toggle('active',item===button));const ratings=button.dataset.developmentView==='ratings';matrixRoot.hidden=!ratings;profileLayout.hidden=ratings});
  document.querySelector('#openDevelopment').onclick=()=>{devDialog.showModal();if(!state.loaded)loadDevelopment().catch(error=>{matrixRoot.innerHTML=`<div class="source-boundary">${dEsc(error.message)}</div>`})};
  document.querySelector('#closeDevelopment').onclick=()=>devDialog.close();
  document.querySelector('#createNewcomer').onclick=createNewcomer;
  devDialog.addEventListener('click',event=>{if(event.target===devDialog)devDialog.close()});
  search.oninput=renderList;
  renderCourseEditor();
  loadDevelopment().catch(error=>{courseLoadError=error.message;renderCourseEditor();refreshCourseDisplays()});
})();
