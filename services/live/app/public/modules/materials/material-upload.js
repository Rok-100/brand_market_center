(() => {
 const base=location.pathname.slice(0,location.pathname.lastIndexOf('/modules/'));
 const api=base+'/api/material-assets';
 const fileData=file=>new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(Error('本地文件读取失败'));r.readAsDataURL(file)});
 const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n};
 const titles={communication:'本地沟通稿',competitor:'本地竞对分析','prohibited-word':'本地违禁词资料'};
 for(const root of document.querySelectorAll('[data-material-upload-kind]')){
  const kind=root.dataset.materialUploadKind,title=titles[kind];if(!title)continue;
  root.classList.add('local-materials');
  root.innerHTML='<header><div><h2></h2><p>支持 Word、PDF、Excel、PPT、TXT、图片及 ZIP；可批量上传，单个文件最大 10MB。</p></div><button type="button" class="primary" data-upload-open>＋ 上传文件</button></header><form hidden><label>分类<input name="category" maxlength="60" placeholder="产品、品牌或资料分类"></label><label>标题（选填）<input name="title" maxlength="120" placeholder="留空使用文件名"></label><label class="files-label">选择本地文件<input name="files" type="file" multiple required accept=".pdf,.doc,.docx,.txt,.md,.csv,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.webp,.gif,.zip"></label><div class="form-actions"><button class="primary" type="submit">上传并归档</button><button type="button" data-upload-cancel>取消</button></div></form><p class="upload-status" role="status" aria-live="polite"></p><div class="local-files"></div>';
  root.querySelector('h2').textContent=title;
  const form=root.querySelector('form'),status=root.querySelector('[role=status]'),list=root.querySelector('.local-files'),files=form.elements.files;
  async function request(options,url=api){const r=await fetch(url,{credentials:'same-origin',cache:'no-store',...options}),b=await r.json();if(!r.ok||!b.ok)throw Error(b.error||'素材请求失败');return b;}
  async function load(){const b=await request(),rows=(b.assets||[]).filter(x=>x.kind===kind);list.replaceChildren();
   for(const file of rows){if(!/^[a-f0-9]{24}$/.test(file.id))continue;const url=api+'/'+file.id,card=el('article'),copy=el('div',null,'file-info');card.append(el('span',(file.extension||'FILE').slice(1).toUpperCase(),'file-type'));copy.append(el('b',file.title||file.originalName),el('small',[file.category||'未分类',Math.max(1,Math.ceil(file.size/1024))+' KB',file.createdBy,file.createdAt?.slice(0,10)].filter(Boolean).join(' · ')));const actions=el('div',null,'file-actions');if(/^(image\/|application\/pdf|text\/)/.test(file.mime)){const a=el('a','打开预览');a.href=url;a.target='_blank';a.rel='noopener';actions.append(a);}const download=el('a','下载原文件');download.href=url+'?download=1';download.download=file.originalName;actions.append(download);
    if(kind==='prohibited-word'){
     const remove=el('button','删除');remove.type='button';remove.style.cssText='color:#a33246;border:1px solid #e5bbc3;border-radius:6px;background:#fff;padding:4px 10px;cursor:pointer';
     remove.setAttribute('aria-label','删除资料：'+(file.title||file.originalName));
     remove.onclick=async()=>{
      if(remove.disabled||!window.confirm('确定删除“'+(file.title||file.originalName)+'”？删除后将从资料列表移除。'))return;
      remove.disabled=true;remove.textContent='删除中…';status.textContent='正在删除资料…';
      try{await request({method:'DELETE',headers:{'X-Requested-With':'XMLHttpRequest'}},url);}
      catch(error){status.textContent='删除失败：'+error.message;remove.disabled=false;remove.textContent='删除';return;}
      card.remove();
      try{const count=await load();status.textContent='资料已删除，剩余 '+count+' 个本地文件。';}
      catch(error){status.textContent='资料已删除，但列表刷新失败，请刷新页面核对：'+error.message;}
     };
     actions.append(remove);
    }
    copy.append(actions);card.append(copy);list.append(card);}
   if(!rows.length)list.append(el('p','暂无本地文件，上传后会保存在这里。'));
   return rows.length;
  }
  root.querySelector('[data-upload-open]').onclick=()=>{form.hidden=false;form.elements.category.focus()};
  root.querySelector('[data-upload-cancel]').onclick=()=>{form.hidden=true};
  form.onsubmit=async event=>{event.preventDefault();const selected=[...files.files];if(!selected.length)return;const invalid=selected.filter(f=>!f.size||f.size>10*1048576);if(invalid.length){status.textContent='以下文件为空或超过 10MB：'+invalid.map(f=>f.name).join('、');return;}
   const buttons=[...root.querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);let saved=0;const failed=[];
   try{for(const file of selected){status.textContent=`正在上传 ${saved+failed.length+1}/${selected.length}：${file.name}`;try{await request({method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'XMLHttpRequest'},body:JSON.stringify({kind,name:file.name,category:form.elements.category.value.trim(),title:form.elements.title.value.trim()?(selected.length>1?form.elements.title.value.trim()+' · '+file.name:form.elements.title.value.trim()):file.name,dataUrl:await fileData(file)})});saved++;}catch(e){failed.push({file,error:e.message});}}
    const remaining=new DataTransfer();failed.forEach(x=>remaining.items.add(x.file));files.files=remaining.files;await load();status.textContent=`已成功上传 ${saved} 个文件。`+(failed.length?'以下文件未保存，可直接重试：\n'+failed.map(x=>x.file.name+'：'+x.error).join('\n'):'');if(!failed.length)form.hidden=true;
   }catch(e){status.textContent='上传后列表读取失败，请刷新核对已保存文件：'+e.message;}finally{buttons.forEach(b=>b.disabled=false);}
  };
  window.MaterialShared?.subscribe(load);
  load().then(n=>status.textContent=`已归档 ${n} 个本地文件。`).catch(e=>status.textContent=e.message);
 }
})();
