(() => {
 const gallery=document.querySelector('.anchor-gallery');if(!gallery)return;
 const base=location.pathname.slice(0,location.pathname.lastIndexOf('/modules/'));
 const node=(tag,text,cls)=>{const e=document.createElement(tag);if(text)e.textContent=text;if(cls)e.className=cls;return e};
 const status=node('p','正在读取直播学习群的原始录屏…','recording-status');status.setAttribute('role','status');gallery.before(status);
 const retry=node('button','刷新录屏','secondary');retry.type='button';status.after(retry);
 gallery.dataset.liveLearningLoaded='1';gallery.replaceChildren();
 let busy=false;
 async function load(){if(busy)return;busy=true;retry.disabled=true;
  try{const r=await fetch(base+'/api/material-recordings',{credentials:'same-origin',cache:'no-store'}),b=await r.json();if(!r.ok||!b.ok)throw Error(b.error||'原始录屏暂不可读');
   const messages=b.data.messages||[],rows=messages.flatMap(message=>(message.resources||[]).filter(x=>x.type==='file'&&/\.(mp4|mov|webm|m4v)$/iu.test(x.name||'')).map(resource=>({message,resource}))).slice(0,24);
   gallery.replaceChildren();
   for(const {message,resource} of rows){
    const card=node('article',null,'anchor-card makeup-entry');
    const adjacent=messages.find(m=>m!==message&&m.text&&m.sender===message.sender&&Math.abs(Date.parse(m.createdAt)-Date.parse(message.createdAt))<=300000);
    const title=message.text||adjacent?.text||resource.name;
    const query=new URLSearchParams({messageId:message.messageId,resourceKey:resource.key,name:resource.name||'原始录屏',title:title.slice(0,180)});if(message.appLink)query.set('original',message.appLink);
    const link=node('a',null,'anchor-recording-preview');link.href='material-recording.html?'+query;link.target='_blank';link.rel='noopener';link.setAttribute('aria-label','播放原始录屏：'+title);
    const thumb=message.resources.find(x=>x.type==='image');
    const fallback=()=>{link.classList.add('is-unavailable');const hint=node('div',null,'recording-preview-placeholder');hint.append(node('strong','原始录屏'),node('span','暂无预览图，点击播放原文件'));link.prepend(hint)};
    if(thumb){const image=node('img');image.alt=title;image.loading='lazy';image.onerror=()=>{image.remove();fallback()};image.src=thumb.url;link.append(image);}else{fallback()}
    link.append(node('span','播放原始录屏 ↗','anchor-media-badge'));
    const body=node('div',null,'anchor-card-body');body.append(node('h3',title),node('p',resource.name,'recording-file-name'),node('small','WIS直播学习 · '+String(message.createdAt||'').slice(0,10)));
    card.dataset.search=title+' '+resource.name;card.append(link,body);gallery.append(card);
   }
   status.textContent=rows.length?`已读取最近 ${messages.length} 条消息，展示 ${rows.length} 段录屏。点击可播放或下载原文件。`:'最近读取的消息中没有录屏文件。';
  }catch(e){status.textContent='录屏读取失败：'+e.message+'。请重试；已有录屏记录保留。';}
  finally{busy=false;retry.disabled=false}
 }
 retry.onclick=load;load();window.MaterialShared?.subscribe(load);
})();
