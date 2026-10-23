// Presentation boundary for the local remix-only edition.
(()=>{
 const forbidden=/千川|ADQ|视频号推送|广告投递|渠道投递/;
 const update=()=>{
  document.querySelectorAll('button,a').forEach(el=>{
   const label=(el.getAttribute('aria-label')||el.textContent||'').trim();
   if(label&&label.length<55&&forbidden.test(label)){el.hidden=true;el.setAttribute('aria-disabled','true')}
  });
  let link=document.getElementById('local-remix-input');
  if(!link){link=document.createElement('a');link.id='local-remix-input';link.href='/local-input/input';link.target='_blank';link.rel='noopener';link.textContent='导入本地素材';link.style.cssText='position:fixed;right:20px;bottom:16px;z-index:2147483000;background:#087fc8;color:#fff;text-decoration:none;border-radius:8px;padding:10px 16px;font:14px system-ui';document.body.append(link)}
 };
 document.addEventListener('click',event=>{const target=event.target.closest('button,a');if(target&&forbidden.test((target.textContent||'').trim())&&(target.textContent||'').length<55){event.preventDefault();event.stopImmediatePropagation()}},true);
 const start=()=>{update();new MutationObserver(update).observe(document.body,{childList:true,subtree:true})};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
