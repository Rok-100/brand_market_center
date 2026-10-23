(() => {
 const q=new URLSearchParams(location.search),messageId=q.get('messageId'),resourceKey=q.get('resourceKey'),name=q.get('name')||'原始录屏';
 const title=document.querySelector('#title'),status=document.querySelector('#status'),video=document.querySelector('#recording'),download=document.querySelector('#download'),original=document.querySelector('#original');
 title.textContent=q.get('title')||name;
 if(!/^om_[\w-]{8,256}$/.test(messageId||'')||!/^file_[\w-]{8,256}$/.test(resourceKey||'')){status.textContent='录屏来源无效，请返回素材中心重新打开。';video.hidden=true;download.hidden=true;return}
 const base=location.pathname.slice(0,location.pathname.lastIndexOf('/modules/'));
 const params=new URLSearchParams({messageId,resourceKey,type:'file',filename:name});const url=base+'/api/feishu/message-resource?'+params;
 video.src=url;download.href=url+'&download=1';download.download=name;
 const source=q.get('original');if(source){try{const u=new URL(source);if(u.protocol==='https:'&&u.hostname==='applink.feishu.cn'&&u.pathname==='/client/chat/open'){original.href=u.href;original.hidden=false}}catch{}}
 video.addEventListener('loadedmetadata',()=>status.textContent='原始录屏已加载，可播放或下载。');
 video.addEventListener('error',()=>status.textContent='浏览器未能直接播放此录屏。请尝试下载原文件，或在飞书中打开原消息。');
})();
