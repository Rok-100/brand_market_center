(() => {
 const month=document.querySelector('#monthSelect'),panel=document.querySelector('#rankingPanel'),status=document.querySelector('#requestStatus'),sync=document.querySelector('#syncRankings'),refresh=document.querySelector('#refreshView');
 let payload=null,room='flagship',busy=false,sequence=0;
 const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const stamp=s=>s?new Date(s).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'尚未同步';
 const statuses={updating:'更新中',final:'已归档',archived_unconfirmed:'已封存 · 截止日同步待核验',historical_import:'历史导入',historical_incomplete:'历史导入 · 评分不完整'};
 function render(){
  if(!payload)return;
  const r=payload.rooms.find(r=>r.id===room),entries=r?.entries||[];
  const error=r?.lastAttempt?.month===payload.month&&!r.lastAttempt.ok?r.lastAttempt.error:null;
  panel.innerHTML=`<article class="ranking"><header class="ranking-head"><div><h2>${escape(r?.name)} · ${escape(payload.month)}</h2><div class="meta">最近成功同步：${stamp(r?.updatedAt)}${entries.length?` · ${entries.length} 名助理 · ${r.recordCount} 条评分`:''}</div></div><div><span class="status">${escape(statuses[r?.status]||'待同步')}</span> <a href="${escape(r?.url)}" target="_blank" rel="noopener">查看考核原表 ↗</a></div></header>${error?`<p class="warning-text">${escape(error)}</p>`:''}${r?.status==='archived_unconfirmed'?'<p class="warning-text">未取得20日16:00后的有效结果，已保留最后一次成功同步版本，不能视为完整终版。</p>':''}${r?.status==='historical_incomplete'?`<p class="warning-text">此月份原表有 ${r.pendingCount} 条未完成评分，暂按有效评分展示均值；未核验当月截止日的历史状态。</p>`:''}${r?.status==='historical_import'?'<p class="warning-text">此月份从现有原表导入，未核验当月截止日的历史状态。</p>':''}${entries.length?`<div class="ranking-chart" role="list" aria-label="助理得分排名"><div class="chart-heading" aria-hidden="true"><span>排名</span><span>助理</span><span>得分进度</span><span>得分</span></div>${entries.map(p=>`<div role="listitem" class="ranking-row ${p.champion?'champion':p.warning?'alert':''}"><span class="rank">${p.rank}</span><div class="person"><span class="person-name">${escape(p.name)}</span>${p.champion?'<span class="badge">冠军</span>':p.warning?'<span class="badge">预警</span>':''}</div><div class="bar" aria-hidden="true"><i style="width:${Math.max(0,Math.min(100,p.score))}%"></i></div><span class="score" aria-label="得分 ${p.score.toFixed(2)}">${p.score.toFixed(2)}</span></div>`).join('')}</div>`:'<p class="empty">本月暂无已核验排名，未将缺失评分显示为零分。</p>'}</article>`;
  document.querySelectorAll('[data-room]').forEach(b=>{b.classList.toggle('active',b.dataset.room===room);b.setAttribute('aria-pressed',String(b.dataset.room===room));});
  document.querySelector('#scheduleInfo').textContent=`每月1—20日，北京时间16:00同步上个月数据；21日起保留最终结果。当前同步目标：${payload.schedule.targetMonth}。${payload.schedule.schedulerEnabled?'自动同步已启用。':'自动同步尚未启用。'}`;
  const notice=document.querySelector('#sourceNotice');notice.hidden=payload.sourceMode==='feishu';notice.textContent=`本机只读样本 · 数据采集于 ${stamp(payload.capturedAt)}；用于本地展示与验证，当前不连接实时飞书数据。`;
  sync.disabled=busy||!payload.canSync;refresh.disabled=busy;
  sync.title=!payload.canSync?'仅在每月1—20日16:00后同步上月数据；同步需已启用':'';
  document.querySelector('#syncHistory').innerHTML=payload.attempts.map(a=>`<p>${stamp(a.at)} · ${escape(a.month)} · ${a.trigger==='scheduled'?'自动同步':'手动同步'} · ${a.succeeded}/${a.total} 个直播间成功</p>`).join('')||'<p>暂无同步记录</p>';
 }
 async function load(force=false){
  const n=++sequence;busy=true;sync.disabled=refresh.disabled=true;status.textContent=force?'正在同步上月评分…':'正在刷新页面数据…';
  try{
   const endpoint=force?'../../api/assistant-rankings/sync':'../../api/assistant-rankings'+(month.value?'?month='+encodeURIComponent(month.value):'');
   const res=await fetch(endpoint,{method:force?'POST':'GET',credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json','X-Requested-With':'XMLHttpRequest'}});const body=await res.json();
   if(!res.ok||!body.ok)throw Error(body.error||'读取失败');if(n!==sequence)return;
   payload=body.data;month.innerHTML=payload.months.map(m=>`<option value="${m}">${m}</option>`).join('');month.value=payload.month;
   status.textContent=force?(payload.attempts[0]?.succeeded===4?'四个直播间已同步':'同步结束，部分来源待核验；已保留有效结果。'):'页面数据已刷新';
  }catch(e){if(n===sequence){status.textContent=e.message;if(!payload)panel.innerHTML='<p class="empty">档案读取失败，请重试。</p>';}}
  finally{if(n===sequence){busy=false;render();refresh.disabled=false;}}
 }
 document.querySelector('#roomTabs').onclick=e=>{const b=e.target.closest('[data-room]');if(b){room=b.dataset.room;render();}};
 month.onchange=()=>load();refresh.onclick=()=>load();sync.onclick=()=>load(true);load();
})();
