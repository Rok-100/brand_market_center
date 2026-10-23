(() => {
 const callbacks=new Set();let refreshing=false;
 const visible=()=>!document.hidden&&(!window.frameElement||window.frameElement.getClientRects().length>0);
 async function refresh(){if(refreshing||!visible())return;refreshing=true;try{await Promise.allSettled([...callbacks].map(fn=>fn()));}finally{refreshing=false;}}
 const channel=typeof BroadcastChannel==='function'?new BroadcastChannel('wis-live-materials-shared'):null;
 channel?.addEventListener('message',refresh);
 window.MaterialShared={subscribe(fn){callbacks.add(fn);return()=>callbacks.delete(fn)},refresh};
 const nativeFetch=window.fetch.bind(window);
 window.fetch=async(input,options)=>{
  const response=await nativeFetch(input,options);
  const url=new URL(typeof input==='string'?input:input.url,location.href),method=String(options?.method||input?.method||'GET').toUpperCase();
  if(response.ok&&url.origin===location.origin&&['POST','DELETE','PUT'].includes(method)&&/\/api\/(?:material-(?:cards|assets|links)(?:\/|$)|script-generator\/save$)/u.test(url.pathname))channel?.postMessage({changedAt:Date.now()});
  return response;
 };
 const timer=setInterval(refresh,30000);
 window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);
 window.addEventListener('pagehide',()=>{clearInterval(timer);channel?.close()},{once:true});
})();
