export function courseCreatePage(categories,esc,requestId) {
 return '<section class="panel course-create-panel">' + `<h2>新增课程</h2><p class="learning-admin-note">保存后会出现在课程资源库。</p><form data-request-id="${requestId}" id="lm-course-form" class="learning-form learning-edit-form"><label>课程名称<input name="title" required maxlength="200"></label><div class="learning-form-grid"><label>课程分类<select name="category" required>${categories.map(item=>`<option value="${item.id}">${esc(item.name)}</option>`).join('')}</select></label><label>讲师（以顿号或逗号分隔）<input name="lecturers"></label></div><label>课程介绍与目标<textarea name="description" rows="4"></textarea></label><label>适用对象<textarea name="audience" rows="2"></textarea></label><div class="learning-form-grid"><label>核验课程时长（分钟）<input type="number" name="durationMinutes" min="0"></label><label>核验历史开课日期<input type="date" name="historicalDate"></label></div><label>历史日期核验依据<input name="dateBasis" placeholder="填写原表年度、课件文件名等真实依据"></label><div class="n-row"><label><input type="checkbox" name="enabled" checked> 在课程资源库显示本课程</label><label><input type="checkbox" name="restricted"> 管理受限</label></div><h3>资料与回放</h3>${[['reading','延伸阅读'],['slides','课程课件'],['recordings','课程回放'],['other','其他资料']].map(([type,title])=>`<div class="learning-resource-entry"><div class="n-row n-between"><strong>${title}</strong><div class="n-row"><button type="button" data-lm-add-resource="${type}">＋ 新增资料</button><button type="button" data-lm-remove-resource="${type}">删除选中</button></div></div><label>保留的资料说明<textarea name="${type}Note" rows="2"></textarea></label><div class="learning-resource-rows" data-lm-resource="${type}"><div class="learning-resource-row"><input type="checkbox" aria-label="选择删除该资料入口"><input name="${type}Title" placeholder="入口名称"><input name="${type}Url" type="url" placeholder="飞书 / 公司 HTTPS 地址"></div></div></div>`).join('')}<div id="form-error" role="alert" hidden></div><div class="n-row"><button type="submit" class="n-primary">保存课程</button><button type="button" data-lm-course-cancel>返回课程与资料</button></div></form>` + '</section>';
}

export function courseCreatePayload(form) {
 const d=new FormData(form),resources=['reading','slides','recordings','other'].map(type=>({type,text:String(d.get(type+'Note')||'').trim(),links:[...form.querySelectorAll('[data-lm-resource="'+type+'"] .learning-resource-row')].flatMap(row=>{
  const title=row.querySelector('[name="'+type+'Title"]').value.trim(),url=row.querySelector('[name="'+type+'Url"]').value.trim();
  if(!title&&!url)return [];
  if(!title||!url)throw new Error('请完整填写资料入口名称和地址，或删除该行');
  return [{title,url}];
 })}));
 return {requestId:form.dataset.requestId,title:String(d.get('title')).trim(),category:d.get('category'),lecturers:String(d.get('lecturers')||'').split(/[、,，]/).map(s=>s.trim()).filter(Boolean),description:String(d.get('description')||'').trim(),audience:String(d.get('audience')||'').trim(),durationMinutes:d.get('durationMinutes')===''||Number(d.get('durationMinutes'))===0?null:Number(d.get('durationMinutes')),historicalDate:String(d.get('historicalDate')||''),dateBasis:String(d.get('dateBasis')||'').trim(),enabled:d.has('enabled'),restricted:d.has('restricted'),resources};
}
export function handleCourseCreateClick(event,toast) {
 const button=event.target.closest('button');if(!button)return;
 if(button.hasAttribute('data-lm-course-cancel')){location.hash='admin/courses';return;}
 const type=button.dataset.lmAddResource||button.dataset.lmRemoveResource;
 if(!['reading','slides','recordings','other'].includes(type))return;
 const group=button.closest('.learning-resource-entry');
 if(button.dataset.lmAddResource){
  const row=document.createElement('div');row.className='learning-resource-row';
  row.innerHTML='<input type="checkbox" aria-label="选择删除该资料入口"><input name="'+type+'Title" placeholder="入口名称"><input name="'+type+'Url" type="url" placeholder="飞书 / 公司 HTTPS 地址">';
  group.querySelector('.learning-resource-rows').append(row);
 }else{const rows=[...group.querySelectorAll('.learning-resource-row')].filter(row=>row.querySelector('input[type=checkbox]').checked);if(!rows.length){toast('请先勾选要删除的资料入口。');return;}rows.forEach(row=>row.remove());}
}
