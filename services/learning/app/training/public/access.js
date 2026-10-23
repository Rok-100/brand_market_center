export function learnerTabs(active='learners') {
  return `<nav class="tabs learner-tabs" aria-label="学员与授权分类"><a href="#admin/learners" ${active==='learners'?'class="active" aria-current="page"':''}>已入站学员</a><a href="#admin/learners?view=access" ${active==='access'?'class="active" aria-current="page"':''}>平台访问名单</a></nav>`;
}

export function createAccessManager({api,esc,dateTime,toast,decorateTables,getUser,getSession=()=>0}) {
  const $=s=>document.querySelector(s);
  let owner='',session=-1,entries=[],draft={},preview=null,pending=null,receipt=null,error='',busy=false,revision=0,loginRequired=false;
  let filter={q:'',status:''};
  const storageKey=()=>`bmt-access-draft:${owner}`;
  const mounted=()=>!!$('#access-root') && owner===getUser()?.id&&session===getSession();
  const scope=()=>({owner,revision,session});
  const current=s=>s.owner===owner&&s.owner===getUser()?.id&&s.revision===revision&&s.session===session&&s.session===getSession();
  function persist(){try{sessionStorage.setItem(storageKey(),JSON.stringify({draft,pending}));return true;}catch{error='浏览器无法保留本次操作，请检查浏览器存储设置后重试；填写内容暂留在当前页面。';return false;}}
  function initialize(){
    const id=getUser()?.id||'';
    if(owner===id&&session===getSession())return;
    owner=id;session=getSession();entries=[];preview=null;pending=null;receipt=null;error='';busy=false;loginRequired=false;filter={q:'',status:''};
    draft={mode:'',employeeId:'',labelName:'',note:'',rows:'',restoreRevoked:false};
    try{const saved=JSON.parse(sessionStorage.getItem(storageKey()));if(saved?.draft)draft={...draft,...saved.draft};if(saved?.pending)pending=saved.pending;}catch{}
    revision++;
  }
  const basisText=value=>({administrator:'管理员自动准入',department:'部门成员自动准入',whitelist:'名单授权',none:'未开放'})[value]||'—';
  function tableHtml(){
    const visible=entries.filter(e=>(!filter.status||e.status===filter.status)&&(!filter.q||[e.employeeId,e.labelName,e.verifiedName,e.department,e.note].join(' ').toLowerCase().includes(filter.q.toLowerCase())));
    if(!entries.length)return `<div class="empty"><h2>还没有添加部门外人员</h2><p>准备好同事的公司工号和姓名，即可在首次登录前开通学习权限。</p><button class="button" data-action="access-add">添加第一位同事</button></div>`;
    if(!visible.length)return '<div class="empty"><h2>没有匹配人员</h2><p>换个姓名、工号或授权状态再试。</p></div>';
    return `<div class="table-wrap access-table"><table><thead><tr><th>姓名 / 工号</th><th>公司部门</th><th>访问资格</th><th>最近访问</th><th>备注</th><th>操作</th></tr></thead><tbody>${visible.map(e=>{
      const automatic=['administrator','department'].includes(e.accessBasis),mismatch=e.verifiedName&&e.labelName&&e.labelName!==e.verifiedName;
      return `<tr data-testid="access-entry" data-employee-id="${esc(e.employeeId)}"><td><strong>${esc(e.verifiedName||e.labelName||'姓名待确认')}</strong><br><span class="numeric">${esc(e.employeeId)}</span>${mismatch?`<br><small class="access-name-warning">名单姓名：${esc(e.labelName)}，请核对</small>`:''}</td><td>${esc(e.department||'—')}${!e.lastSeen?'<br><small>首次登录后读取</small>':''}</td><td><span class="badge ${e.status==='active'?'green':''}">${e.status==='active'?'已开放':'已撤销'}</span><br><small>${esc(basisText(e.accessBasis))}</small></td><td>${e.lastSeen?esc(dateTime(e.lastSeen)):'未登录'}</td><td class="access-note">${esc(e.note||'—')}</td><td><button class="text-button ${e.status==='active'?'access-revoke':''}" data-action="${e.status==='active'?'access-revoke':'access-restore'}" data-employee-id="${esc(e.employeeId)}" ${busy||pending?'disabled':''}>${e.status==='active'?(automatic?'移出名单':'撤销访问'):'恢复访问'}</button>${automatic?'<small class="access-basis-note">移出后仍可自动进入</small>':''}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  }
  function previewHtml(){
    if(!preview)return '';
    const p=preview,s=p.summary,kindText={new:'将新增',active:'已开放，跳过',revoked:'已撤销',automatic:'自动准入',duplicate:'重复，跳过',error:'需要修正'};
    return `<section id="access-preview" class="access-preview" aria-labelledby="access-preview-title"><h3 id="access-preview-title" tabindex="-1">核对名单</h3><p class="small">可保存 ${s.toApply} 人${s.errors?` · ${s.errors} 行需要修正`:''}${s.duplicates?` · ${s.duplicates} 行重复`:''}。请核对工号与姓名。</p><div class="table-wrap"><table><thead><tr><th>行</th><th>工号 / 姓名</th><th>处理结果</th></tr></thead><tbody>${p.entries.map(e=>`<tr><td>${e.row}</td><td>${esc(e.employeeId)}<br>${esc(e.labelName)}</td><td><span class="${e.kind==='error'?'access-name-warning':''}">${e.kind==='revoked'&&e.action==='grant'?'将恢复':esc(kindText[e.kind]||e.kind)}</span>${e.message?`<br><small>${esc(e.message)}</small>`:''}</td></tr>`).join('')}</tbody></table></div><div class="button-row"><button class="button" data-action="access-confirm" ${!p.canApply||busy||pending?'disabled':''}>确认保存 ${s.toApply} 人</button><span class="small">${s.errors?'请先修正错误行，再重新预览。':!s.toApply?'当前没有需要保存的人员。':'保存后即可使用公司账号进入平台。'}</span></div></section>`;
  }
  function editorHtml(){
    if(!draft.mode)return '';
    const single=draft.mode==='single';
    return `<section class="access-editor" aria-labelledby="access-editor-title"><div class="access-section-heading"><h2 id="access-editor-title">${single?'添加人员':'批量添加'}</h2><button class="text-button" data-action="access-cancel" ${busy||pending?'disabled':''}>收起</button></div><form id="${single?'access-single-form':'access-batch-form'}"><fieldset ${busy||pending?'disabled':''}>${single?`<div class="form-grid"><label class="form-field">公司工号<input name="employeeId" required maxlength="100" autocomplete="off" value="${esc(draft.employeeId)}" placeholder="请填写完整工号"><small>保留开头的 0，以公司账号中的工号为准。</small></label><label class="form-field">姓名<input name="labelName" required maxlength="100" autocomplete="off" value="${esc(draft.labelName)}" placeholder="请输入同事姓名"></label><label class="form-field wide">备注（选填）<input name="note" maxlength="500" value="${esc(draft.note)}" placeholder="例如：跨部门课程共学"></label></div>`:`<label class="form-field access-batch-field">粘贴名单<textarea name="rows" rows="7" required spellcheck="false" placeholder="工号&#9;姓名&#10;（从表格复制两列后粘贴）">${esc(draft.rows)}</textarea><small>每行一人，第一列工号、第二列姓名；可包含表头，每批最多 200 人。</small></label><label class="checkline"><input name="restoreRevoked" type="checkbox" ${draft.restoreRevoked?'checked':''}>同时恢复这批名单中已撤销的人员</label>`}<button class="secondary" type="submit">${busy?'正在核对…':'核对并预览'}</button></fieldset></form>${previewHtml()}</section>`;
  }
  function workHtml(){
    const s=receipt?.summary;
    return `${receipt?`<div id="access-receipt" class="success-note" role="status"><strong>名单已保存</strong><span>新增 ${s.granted||0} 人 · 恢复 ${s.restored||0} 人 · 撤销 ${s.revoked||0} 人${s.updated?` · 更新 ${s.updated} 人`:''}${s.skipped?` · 跳过 ${s.skipped} 人`:''}</span><small>${esc(dateTime(receipt.savedAt))}</small></div>`:''}${error?`<div id="access-error" class="inline-error" role="alert" tabindex="-1">${esc(error)}${loginRequired?' <a href="./session/resume">重新登录并返回</a>':''}</div>`:''}${pending?`<div class="notice" role="status"><strong>正在确认这次保存结果</strong><p>这次名单已保留，先检查保存结果再继续操作。</p><div class="button-row"><button class="secondary" data-action="access-read-receipt" ${busy?'disabled':''}>检查保存结果</button><button class="text-button" data-action="access-retry" ${busy?'disabled':''}>检查并重试</button></div></div>`:''}${editorHtml()}<div class="access-section-heading"><div><h2>部门外访问名单</h2><p class="small">名单仅开放平台学习；管理课程另行授权。</p></div><div class="button-row"><button class="secondary" data-action="access-batch" ${busy||pending?'disabled':''}>批量添加</button><button class="button" data-action="access-add" ${busy||pending?'disabled':''}>添加人员</button></div></div><div class="access-filters"><label class="form-field">搜索人员<input type="search" id="access-search" value="${esc(filter.q)}" placeholder="姓名、工号或部门"></label><label class="form-field">授权状态<select id="access-status"><option value="">全部状态</option><option value="active" ${filter.status==='active'?'selected':''}>已开放</option><option value="revoked" ${filter.status==='revoked'?'selected':''}>已撤销</option></select></label><span class="small">共 ${entries.length} 人</span></div><div id="access-list">${tableHtml()}</div>`;
  }
  function paint(focus){if(!mounted())return;$('#access-work').innerHTML=workHtml();if(busy)$('#access-work').insertAdjacentHTML('afterbegin','<div class="notice" role="status" aria-live="polite">正在处理，请稍候…</div>');decorateTables();if(focus)$(focus)?.focus();}
  async function page(){
    initialize();const operationScope=scope();const result=await api('admin/access');
    if(!current(operationScope))return '';
    entries=result.entries;
    return `<div id="access-root"><div class="page-title"><div><h1>学员与授权</h1><p>管理学员设置，为部门外同事开通学习权限。</p></div></div>${learnerTabs('access')}<div id="access-work">${workHtml()}</div></div>`;
  }
  function capture(target){
    if(!mounted()||busy||pending)return;
    if(target.id==='access-search'||target.id==='access-status'){
      filter.q=$('#access-search').value;filter.status=$('#access-status').value;$('#access-list').innerHTML=tableHtml();decorateTables();return;
    }
    const form=target.closest('#access-single-form,#access-batch-form');if(!form)return;
    for(const [k,v] of new FormData(form))draft[k]=v;
    if(form.id==='access-batch-form')draft.restoreRevoked=form.elements.restoreRevoked.checked;
    preview=null;revision++;error='';$('#access-preview')?.remove();$('#access-error')?.remove();if(!persist())$('#access-work').insertAdjacentHTML('afterbegin',`<div id="access-error" class="inline-error" role="alert">${esc(error)}</div>`);
  }
  function parsedRows(){
    const lines=draft.rows.split(/\r?\n/).filter(l=>l.trim());
    if(lines.length&&/^\s*(工号|公司工号|employeeId)[\t,，]/i.test(lines[0]))lines.shift();
    if(!lines.length)throw new Error('请先粘贴工号和姓名两列。');
    if(lines.length>200)throw new Error('每批最多 200 人，请分批添加。');
    return lines.map((line,index)=>{
      const columns=line.includes('\t')?line.split('\t'):line.split(/[,，]/);
      if(columns.length!==2)throw new Error(`第 ${index+1} 行需要工号和姓名两列，请从表格重新复制。`);
      return {employeeId:columns[0].trim(),labelName:columns[1].trim(),note:''};
    });
  }
  async function submit(form){
    if(busy||pending||!mounted())return;
    capture(form.elements[0]);error='';receipt=null;preview=null;loginRequired=false;const operationScope=scope();
    try{
      const input=form.id==='access-single-form'?[{employeeId:draft.employeeId.trim(),labelName:draft.labelName.trim(),note:draft.note.trim()}]:parsedRows();
      busy=true;paint();
      const result=await api('admin/access/preview',{method:'POST',body:{entries:input,restoreRevoked:form.id==='access-batch-form'&&!!draft.restoreRevoked}});
      if(!current(operationScope))return;
      preview=result;
    }catch(e){if(current(operationScope)){error=e.message;loginRequired=e.status===401;if(loginRequired)sessionStorage.setItem('bmt-return',location.hash);}}finally{if(current(operationScope)){busy=false;paint(preview?'#access-preview-title':'#access-error');}}
  }
  async function refresh(operationScope){const result=await api('admin/access');if(current(operationScope))entries=result.entries;}
  async function accepted(result,operationScope){
    if(!current(operationScope))return;
    receipt=result;pending=null;preview=null;draft.mode='';error='';persist();
    // The write is already confirmed even if refreshing the list fails.
    if(Array.isArray(result.entries)){for(const entry of result.entries){const index=entries.findIndex(row=>row.employeeId===entry.employeeId);if(index<0)entries.unshift(entry);else entries[index]=entry;}}else try{await refresh(operationScope);}catch{if(current(operationScope))error='名单已保存，列表暂未刷新。重新进入此页即可查看最新名单。';}
    if(current(operationScope)&&mounted())toast('名单已保存');
  }
  async function savePending(retry=false,readOnly=false){
    if(!pending||busy)return;
    busy=true;error='';loginRequired=false;paint();const operation=pending,operationScope=scope();
    try{
      let result;
      if(retry||readOnly){
        try{result=await api(`admin/access/receipts/${encodeURIComponent(operation.requestId)}`);}catch(e){if(!current(operationScope))return;if(e.status!==404)throw e;if(readOnly){error='暂未查到这次保存结果，可点击“检查并重试”。';return;}}
      }
      if(!current(operationScope))return;
      if(!result)result=await api('admin/access/apply',{method:'POST',body:operation});
      if(current(operationScope))await accepted(result,operationScope);
    }catch(e){
      if(!current(operationScope))return;
      if(e.status===0||e.status>=500){
        try{const saved=await api(`admin/access/receipts/${encodeURIComponent(operation.requestId)}`);if(current(operationScope))await accepted(saved,operationScope);return;}catch{}
        if(!current(operationScope))return;
        error='连接中断，尚未确认保存结果。名单已保留，请检查保存结果。';
      }else if(e.status===409){
        pending=null;preview=null;persist();error='名单已被修改，本次没有覆盖其他人的操作。请核对最新名单后重新预览。';
        try{await refresh(operationScope);}catch{}
      }else if(e.status===400){pending=null;preview=null;persist();error=e.message;}
      else {error=e.message;loginRequired=e.status===401;if(loginRequired)sessionStorage.setItem('bmt-return',location.hash);}
    }finally{if(current(operationScope)){busy=false;paint();}}
  }
  async function action(button){
    const action=button.dataset.action;if(!action?.startsWith('access-'))return false;
    if(!mounted())return true;
    if(busy)return true;
    if(action==='access-read-receipt'){await savePending(false,true);return true;}
    if(action==='access-retry'){await savePending(true);return true;}
    if(pending)return true;
    if(action==='access-add'||action==='access-batch'){
      draft.mode=action==='access-add'?'single':'batch';preview=null;receipt=null;error='';revision++;persist();paint(draft.mode==='single'?'#access-single-form input':'#access-batch-form textarea');
    }else if(action==='access-cancel'){draft.mode='';preview=null;error='';revision++;persist();paint('[data-action="access-add"]');}
    else if(action==='access-confirm'){
      if(!preview?.canApply)return true;
      const changes=preview.entries.filter(e=>e.action==='grant').map(e=>({employeeId:e.employeeId,labelName:e.labelName,note:e.note||'',version:e.version,action:'grant'}));
      pending={requestId:crypto.randomUUID(),entries:changes};if(!persist()){pending=null;paint('#access-error');return true;}await savePending();
    }else if(action==='access-revoke'||action==='access-restore'){
      const entry=entries.find(e=>e.employeeId===button.dataset.employeeId);if(!entry)return true;
      const revoke=action==='access-revoke',automatic=['administrator','department'].includes(entry.accessBasis);
      if(!confirm(`${revoke?'撤销':'恢复'} ${entry.verifiedName||entry.labelName||'该同事'}（${entry.employeeId}）的名单授权？${revoke?(automatic?'该人员仍可按部门或管理员身份进入。':'撤销后将无法继续使用平台，学习记录会保留。'):'恢复后可继续原有学习。'}`))return true;
      receipt=null;pending={requestId:crypto.randomUUID(),entries:[{employeeId:entry.employeeId,labelName:entry.labelName,note:entry.note,version:entry.version,action:revoke?'revoke':'grant'}]};if(!persist()){pending=null;paint('#access-error');return true;}await savePending();
    }
    return true;
  }
  return {page,capture,submit,action};
}
