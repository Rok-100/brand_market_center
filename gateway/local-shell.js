// Preserve the current 8095 frontend, connecting only remix.
(()=>{
 const prefix='/yxb/wis-marketing-hub';
 const notify=()=>{let el=document.getElementById('local-scope-message');if(!el){el=document.createElement('div');el.id='local-scope-message';el.style.cssText='position:fixed;right:24px;top:20px;z-index:2147483647;background:#173b67;color:white;padding:12px 20px;border-radius:8px;font:14px system-ui';document.body.append(el)}el.textContent='当前仅接入二创混剪，其他界面暂不接业务';setTimeout(()=>el.remove(),2400)};
 document.addEventListener('click',event=>{
  const target=event.target.closest('a,button');if(!target)return;
  const label=(target.getAttribute('aria-label')||target.textContent||'').trim(),href=target.getAttribute('href')||'';
  if(href.includes('/modules/material-workbench')||label==='二创混剪'||label==='素材工作台')return;
  if(target.closest('.sidebar-nav')&&!/首页|工作台/.test(label)||href.includes('/modules/')&&!href.includes('material-workbench')||target.closest('.module-card')&&!/二创|混剪/.test(target.closest('.module-card').textContent||'')){
   event.preventDefault();event.stopImmediatePropagation();notify();
  }
 },true);
 const ready=()=>{const link=document.createElement('a');link.href='/local-input/input';link.target='_blank';link.rel='noopener';link.textContent='导入本地混剪素材';link.style.cssText='position:fixed;bottom:16px;right:24px;z-index:2147483000;color:white;background:#087fc8;border-radius:8px;padding:10px 16px;text-decoration:none;font:14px system-ui';document.body.append(link)};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ready);else ready();
 const module=new URLSearchParams(location.hash.slice(1)).get('module');if(module&&module!=='material-workbench')history.replaceState(null,'',prefix+'/');
})();
