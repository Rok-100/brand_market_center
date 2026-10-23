(() => {
  const $=id=>document.getElementById(id);
  const root=location.pathname.slice(0,location.pathname.lastIndexOf('/modules/anchors/'));
  const base=root+'/api/lifecycle/status-warning';
  const esc=value=>String(value??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
  const date=value=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
  const time=value=>value?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value)):'待核验';
  const stateNames={queued:'待评分',running:'评分中',retry:'等待重试',waiting_setup:'待登录或配置',needs_review:'待人工复核',scored:'已评分',reviewed:'人工已处理',ignored:'时长已过滤',duplicate:'同场重复'};
  const receiptNames={pending:'报告待交付',sending:'交付待核验',file_sent:'录屏已发送',file_link_ready:'原录屏链接待交付',sent_unverified:'已发送待核验',verified:'已推送倪梦萍',uncertain:'发送结果待核验'};
  let canManage=false,rows=[],busy=false,autoBusy=false,activeId='',detailRequest=0,loadedModels=false,ready=0,serverProcessing=false,quickFilter='',automationState=null;
  const retrying=new Set(),retryErrors=new Map();
  $('automatic').checked=false;
  if(new URLSearchParams(location.search).get('embed')==='1')$('topnav').hidden=true;
  document.querySelectorAll('[data-page]').forEach(link=>{link.href=root+'/#'+link.dataset.page;});
  $('date').value=date(Date.now());
  $('state').add(new Option('人工已处理','reviewed'));
  function notice(message,error=false){$('notice').hidden=!message;$('notice').textContent=message;$('notice').classList.toggle('error',error);}
  async function api(path,{body}={}){const response=await fetch(base+path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'XMLHttpRequest'},body:JSON.stringify(body)});const result=await response.json();if(!response.ok||!result.ok)throw Error(result.error||'暂时无法读取，请重试。');return result.data;}
  function showCurrentUser(user){const name=String(user?.name||'').trim();$('currentUserName').textContent=name||'用户信息待核验';$('currentUserAvatar').textContent=name?[...name][0]:'·';$('currentAccount').title=name+(user?.number?' · '+user.number:'');}
  const query=()=>new URLSearchParams({date:$('date').value,room:$('room').value,state:$('state').value}).toString();
  const level=row=>row.result?.severe?'severe':row.result?.warning?'warning':row.state==='needs_review'||row.state==='waiting_setup'||row.result?.requiresReview?'review':row.result?'normal':'';
  const clock=value=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value));
  const retryable=row=>canManage&&!row.result&&Boolean(row.session)&&['needs_review','retry','waiting_setup'].includes(row.state);
  const reviewKind=row=>row.result?.requiresReview?'quality':['needs_review','waiting_setup'].includes(row.state)?(!row.session||row.sessionMatch?.state==='unmatched'?'identity':'quality'):'';
  function reviewReason(row){
    if(row.sessionMatch?.state==='unmatched')return '场次匹配待人工核验';
    if(!row.session)return '主播归属 / 场次待核验';
    if(row.attempts>=4)return (row.error&&!row.error.startsWith('下载、媒体处理或模型执行失败')?row.error.slice(0,45):'评分流程失败')+'（'+row.attempts+' 次）';
    return row.error?row.error.slice(0,65):'评分 / 素材待核验';
  }
  function syncFilters(){
    $('clearFilters').hidden=!quickFilter&&!$('level').value&&!$('state').value;
    $('filterStatus').textContent=quickFilter?{severe:'筛选：严重预警',identity:'筛选：身份 / 场次待核验',quality:'筛选：评分 / 素材待复核'}[quickFilter]:$('level').value?'筛选：'+{severe:'严重',warning:'关注',review:'待复核',normal:'正常'}[$('level').value]:$('state').value?'已按处理状态筛选':'';
    $('abnormal').querySelectorAll('[data-filter]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.filter===quickFilter)));
  }
  function paintRows(){
    syncFilters();
    const visible=rows.filter(row=>(row.state!=='duplicate'||$('state').value==='duplicate')&&(!$('level').value||level(row)===$('level').value)&&(!quickFilter||quickFilter==='severe'||reviewKind(row)===quickFilter));
    $('rows').innerHTML=visible.length?visible.map(row=>{
      const score=row.result?.total,severity=level(row),colors=['#ff694e','#ff962c','#8a60ff','#4389ff','#32bf95','#ffbb2b','#8290a8'];
      const color=colors[Array.from(row.name).reduce((n,c)=>n+c.codePointAt(0),0)%colors.length];
      const issues=row.result?.reasons?.map(x=>x.text)||[];
      if(row.result?.compliance?.status==='uncertain')issues.push(...row.result.compliance.hits.map(x=>'待核验：'+x.term));
      const reason=issues.length?issues.map(x=>`<span class="tag">${esc(x)}</span>`).join(''):row.result?'<span class="muted">未发现明显异常</span>':`<span class="tag" title="${esc(row.error||'')}">${esc(row.state==='needs_review'?reviewReason(row):stateNames[row.state])}</span>`;
      const handling=row.manualRetry&&row.state==='queued'?'重试已排队':row.delivery?receiptNames[row.delivery.state]||'交付待核验':severity==='review'?'人工复核中':stateNames[row.state];
      const tone={severe:'red',warning:'orange',review:'purple',normal:'green'}[severity]||'blue';
      const sessionLabel=row.sessionMatch?.state==='unmatched'?'场次无法唯一匹配':row.sessionMatch?.state==='unavailable'?'班表读取待重试':'待匹配班表';
      const levelLabel=severity==='review'&&row.result?.requiresReview?'合规待复核':{severe:'严重',warning:'关注',review:'待复核',normal:'正常'}[severity]||stateNames[row.state];
      return `<tr><td><div class="anchor-cell"><span class="avatar" style="background:${color}">${esc(row.name.slice(0,1))}</span><div><button class="anchor-name" data-detail="${esc(row.id)}">${esc(row.name)}</button><small title="飞书通讯录工号">${esc(row.employeeNumber||(row.employeeNumberStatus==='ambiguous'?'工号待核验':'工号待补充'))}</small></div></div></td><td>${esc(row.room||'待核验')}</td><td class="session-cell" title="${row.session?esc(time(row.session.start)+' — '+time(row.session.end)):esc(row.sessionMatch?.reason||'上传 '+time(row.recording.createdAt))}">${row.session?esc(clock(row.session.start)+' – '+clock(row.session.end)):sessionLabel}</td><td><span class="score ${score==null?'none':score<62?'low':score<65?'attention':'good'}">${score??'—'}</span><span class="score-bar"><i style="width:${score??0}%"></i></span></td><td class="contribution-cell" title="${esc(row.contributionError||row.contributionMonth||'贡献值尚未匹配')}"><span class="contribution ${['red','green','blue'].includes(row.contribution?.tone)?(row.contribution.tone==='blue'?'green':row.contribution.tone):'missing'}">${esc(row.contribution?.label||'待同步')}</span></td><td class="reason">${reason}${row.result?.requiresReview?'<span class="tag">合规证据待复核</span>':''}</td><td><span class="tag level ${tone}">${esc(levelLabel)}</span></td><td><button class="text-button handling ${severity==='review'?'review':''}" data-detail="${esc(row.id)}">${esc(handling)}</button>${retryable(row)?`<button class="text-button retry-button" data-retry="${esc(row.id)}" ${retrying.has(row.id)?'disabled':''}>${retrying.has(row.id)?'提交中…':'重新评分'}</button>`:''}${retryErrors.has(row.id)?`<small class="retry-feedback">${esc(retryErrors.get(row.id))}</small>`:''}</td></tr>`;
    }).join(''):'<tr><td colspan="8" class="empty">当前筛选条件下暂无记录。</td></tr>';
  }
  function distribution(data){const max=Math.max(1,data.reduce((sum,n)=>sum+n,0));$('distribution').innerHTML=['≥ 85','75–84','65–74','< 65'].map((label,i)=>`<div class="distribution-row"><span>${label}</span><div class="distribution-track"><i style="width:${data[i]/max*100}%"></i></div><b>${data[i]}</b></div>`).join('');}
  function trend(data){
    const available=data.filter(x=>x.average!=null);if(!available.length){$('chart').innerHTML='<p class="empty">尚无成功评分，趋势将在评估后生成。</p>';return;}
    const width=340,height=150,left=8,right=332,top=10,bottom=120;
    const x=i=>left+i/Math.max(1,data.length-1)*(right-left),y=value=>bottom-value/100*(bottom-top),line=[];
    let drawing=false;data.forEach((row,i)=>{if(row.average==null){drawing=false;return;}line.push(`${drawing?'L':'M'}${x(i).toFixed(1)},${y(row.average).toFixed(1)}`);drawing=true;});
    const areas=[];let segment=[];function closeSegment(){if(segment.length>1)areas.push(`M${segment[0][0]},${bottom} ${segment.map(p=>'L'+p.join(',')).join(' ')} L${segment.at(-1)[0]},${bottom}Z`);segment=[];}
    data.forEach((row,i)=>{if(row.average==null)closeSegment();else segment.push([x(i),y(row.average)]);});closeSegment();
    $('chart').innerHTML=`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc($('days').value)}天平均评分趋势"><defs><linearGradient id="trendFill" x1="0" x2="0" y1="0" y2="1"><stop stop-color="#4269f5" stop-opacity=".24"/><stop offset="1" stop-color="#4269f5" stop-opacity="0"/></linearGradient></defs><path d="M8 10H332M8 45H332M8 80H332M8 120H332" stroke="#edf1f7"/><path d="${areas.join(' ')}" fill="url(#trendFill)"/><path d="M8 ${y(65)}H332" stroke="#f53e42" stroke-dasharray="5 5"/><text x="316" y="${y(65)-4}" font-size="9" fill="#f53e42">65</text><path d="${line.join(' ')}" fill="none" stroke="#4269f5" stroke-width="2.5"/>${data.map((row,i)=>row.average==null?'':`<circle cx="${x(i)}" cy="${y(row.average)}" r="3.5" fill="white" stroke="#4269f5" stroke-width="2"><title>${esc(row.date)}：${row.average}分，${row.count}人次</title></circle>`).join('')}<text x="8" y="143" font-size="10" fill="#8190a8">${esc(data[0].date.slice(5))}</text><text x="300" y="143" font-size="10" fill="#8190a8">${esc(data.at(-1).date.slice(5))}</text></svg>`;
  }
  function orderedHistory(history){
    const stamp=row=>Date.parse(row.session?.start||row.recording?.createdAt||(row.date?row.date+'T00:00:00+08:00':''));
    return (history||[]).filter(row=>Number.isFinite(row.result?.total)&&row.result.total>=0&&row.result.total<=100&&Number.isFinite(stamp(row)))
      .slice().sort((a,b)=>stamp(a)-stamp(b)||String(a.id||'').localeCompare(String(b.id||'')));
  }
  function scoreHistoryChart(history){
    const points=orderedHistory(history);
    if(!points.length)return '<p class="detail-note">近 7 天暂无已评分场次。</p>';
    const width=Math.max(500,points.length*52+60),height=236,left=38,right=16,top=22,bottom=184;
    const x=i=>points.length===1?(left+width-right)/2:left+i*(width-left-right)/(points.length-1),y=score=>bottom-score*(bottom-top)/100;
    const stamp=row=>row.session?.start||row.recording?.createdAt||row.date+'T00:00:00+08:00';
    const line=points.map((row,i)=>(i?'L':'M')+x(i)+' '+y(row.result.total)).join(' ');
    const ticks=[100,80,65,40,20,0].map(score=>`<line x1="${left}" y1="${y(score)}" x2="${width-right}" y2="${y(score)}" stroke="${score===65?'#f53e42':'#edf1f7'}" ${score===65?'stroke-dasharray="5 5"':''}/><text x="${left-9}" y="${y(score)+4}" text-anchor="end" class="history-axis ${score===65?'warning-axis':''}">${score}</text>`).join('');
    return `<div class="history-score-chart"><div class="history-chart-scroll" tabindex="0" aria-label="场次总分趋势，可横向滚动"><svg viewBox="0 0 ${width} ${height}" style="min-width:${width}px" role="img" aria-label="本主播近7天场次总分折线图，共${points.length}次评分，满分100分">${ticks}${points.length>1?`<path d="${line}" fill="none" stroke="#4269f5" stroke-width="2.5"/>`:''}${points.map((row,i)=>{
      const value=stamp(row),label=time(value),color=row.result.total<65?'#f53e42':'#4269f5';
      return `<g data-history-point="${esc(row.id||'')}" data-score="${row.result.total}" tabindex="0" role="img" aria-label="${esc(label)}，${esc(row.room||'')}，${row.result.total}分"><title>${esc(label)} · ${esc(row.room||'')} · ${row.result.total}分</title><circle cx="${x(i)}" cy="${y(row.result.total)}" r="4" fill="white" stroke="${color}" stroke-width="2"/><text x="${x(i)}" y="${y(row.result.total)-11}" text-anchor="middle" class="history-point-score">${row.result.total}</text><text x="${x(i)}" y="208" text-anchor="middle" class="history-axis">${esc(date(value).slice(5))}</text><text x="${x(i)}" y="225" text-anchor="middle" class="history-axis">${esc(clock(value))}</text></g>`;
    }).join('')}</svg></div><div class="history-chart-legend"><span><i></i>场次总分</span><span class="warning"><i></i>预警线 65</span><span>每个点为一次场次评分${points.length===1?' · 当前仅 1 条记录':''}</span></div></div>`;
  }
  function tasks(data){$('tasks').innerHTML=data.length?'<details><summary>查看 '+data.length+' 条复盘任务</summary>'+data.slice(0,20).map(task=>`<div class="task"><b>${esc(task.name||'主播异常复盘')}</b><small>${esc(time(task.created_at))} · ${({completed:'已完成',cancelled:'已撤销（预警更正）',open:'待处理'}[task.state]||task.state)}</small><div><button class="text-button" data-detail="${esc(task.job_id)}">查看评分与原录屏</button>${canManage&&task.state==='open'?`<button class="text-button" data-task="${esc(task.id)}">完成复盘</button>`:''}</div>${task.note?`<small>${esc(task.note)}</small>`:''}</div>`).join('')+'</details>':'<small class="muted">暂无复盘任务</small>';}
  async function refresh(){if(busy)return;busy=true;try{
    const q=query(),[status,summary,items,chart]=await Promise.all([api('/status'),api('/summary?'+q),api('/evaluations?'+q),api('/trends?'+new URLSearchParams({room:$('room').value,days:$('days').value}))]);
    if(status.contribution){const c=status.contribution;$('contributionSummary').textContent='贡献值：每天10:00更新 · '+(c.lastError?'同步异常':c.lastSuccessAt?time(c.lastSuccessAt)+'已更新':'待同步');$('contributionSummary').title=c.lastError||c.sheetTitle||'';}
    showCurrentUser(status.currentUser);canManage=status.canManage;ready=status.ready??summary.ready??0;serverProcessing=status.processing;automationState=status.automation;
    $('manageActions').hidden=!canManage;$('autoControl').hidden=!canManage;if(!autoBusy)$('automatic').checked=Boolean(automationState?.enabled);
    $('scoringMode').textContent=automationState?.enabled?'服务器自动评分已启用，关闭页面仍会连续处理。':automationState?.error||'后台评分尚未启用，请在操作菜单启用OA授权托管。';
    $('refreshTime').textContent=(status.lastScan?'录屏更新 '+time(status.lastScan):'尚未更新录屏')+(status.matching?' · 匹配班表中':serverProcessing?' · 自动评分中':status.automation?.enabled&&status.lastBackgroundCheck?' · 后台巡检 '+time(status.lastBackgroundCheck):'');
    $('evaluated').textContent=summary.evaluated;$('average').textContent=summary.average??'—';$('warnings').textContent=summary.warnings;$('pending').textContent=summary.pending;$('severe').textContent=`▲ ${summary.severe} 条严重预警，需要重点关注`;$('warningCount').textContent=summary.warnings;$('start').disabled=autoBusy;
    const delivered=items.filter(x=>x.delivery?.state==='verified').length;
    $('queueCount').textContent=delivered?`${delivered} 条已推送倪梦萍 ›`:`${summary.queued} 条待评分`;
    $('trendTitle').textContent=`近 ${$('days').value} 天状态趋势`;
    const quality=items.filter(x=>reviewKind(x)==='quality').length,identity=items.filter(x=>reviewKind(x)==='identity').length;
    $('abnormal').innerHTML=[['!','严重预警',summary.severe,'低分或单项极低，需跟进复盘','severe'],['↻','需人工核验',identity,'群消息归属或班表场次待确认','identity'],['↺','评分 / 素材待复核',quality,'评分失败、素材证据不足或合规待确认','quality']].map(([icon,label,count,note,filter])=>`<button class="abnormal-item" data-filter="${filter}" aria-pressed="${quickFilter===filter}"><span class="abnormal-icon">${icon}</span><span><strong>${count} 条${label}</strong><small>${note}</small></span></button>`).join('');
    rows=items;paintRows();distribution(summary.distribution);trend(chart);tasks(summary.tasks);
    if(automationState?.error)notice(automationState.error,true);
    else if(status.lastError)notice(status.lastError,true);
    else if(!status.notificationsEnabled)notice('当前报告与复盘任务已保存到本模块；飞书自动推送尚未开启。');
    if(canManage&&!loadedModels){loadedModels=true;api('/models').then(models=>{const candidates=models.filter(x=>x.video&&/omni/i.test(x.name)).sort((a,b)=>Number(b.name.endsWith('flash'))-Number(a.name.endsWith('flash')));$('model').innerHTML=candidates.length?candidates.map(x=>`<option value="${esc(x.name)}">${esc(x.name)}</option>`).join(''):'<option value="">无可用音视频模型</option>';}).catch(error=>{loadedModels=false;notice(error.message,true);});}
  }catch(error){notice(error.message,true);$('rows').innerHTML='<tr><td colspan="8" class="empty">读取失败，原记录保留。请刷新或重新登录。</td></tr>';}finally{busy=false;}}
  async function configureBackground(action){
    if(autoBusy)return;autoBusy=true;try{
      await api('/automation',{body:{action,model:$('model').value}});
      notice(action==='enable'?'后台自动评分已启用，服务器会连续处理，关闭本页不影响。':'后台已暂停启动后续评分，正在进行的评分会完成。');
    }catch(error){notice(error.message,true);}finally{autoBusy=false;await refresh();}
  }
  async function retryRecording(id,button){
    if(retrying.has(id))return;retrying.add(id);retryErrors.delete(id);if(button)button.disabled=true;
    const detailStatus=$('retryDetailStatus');if(activeId===id&&detailStatus)detailStatus.textContent='正在提交模型重试…';
    paintRows();
    try{
      await api('/evaluations/'+encodeURIComponent(id)+'/retry',{body:{}});
      notice('已提交重新评分，后台会优先处理该录屏，结果自动更新。');
      if(activeId===id)await detail(id);await refresh();
    }catch(error){
      retryErrors.set(id,error.message);notice(error.message,true);
      if(activeId===id&&$('retryDetailStatus'))$('retryDetailStatus').textContent=error.message;
    }finally{retrying.delete(id);if(button)button.disabled=false;paintRows();}
  }
  async function detail(id){
    const request=++detailRequest,preview=rows.find(row=>row.id===id);activeId=id;
    $('detail').querySelector('video')?.pause();
    $('detailTitle').textContent=preview?preview.name+' · '+(preview.room||'账号待核验'):'录屏状态评估';
    $('detailBody').innerHTML='<p class="empty" role="status">正在读取评分详情…</p>';
    if(!$('detail').open)$('detail').showModal();
    try{
    const row=await api('/evaluations/'+encodeURIComponent(id));if(request!==detailRequest||activeId!==id)return;row.history=orderedHistory(row.history);$('detailTitle').textContent=row.name+' · '+(row.room||'账号待核验');
    const mediaUrl=root+'/api/feishu/message-resource?'+new URLSearchParams({messageId:row.recording.messageId,resourceKey:row.recording.resourceKey,type:'file'});
    const thumbnailUrl=row.recording.thumbnailKey?root+'/api/feishu/message-resource?'+new URLSearchParams({messageId:row.recording.messageId,resourceKey:row.recording.thumbnailKey,type:'image'}):'';
    $('detailBody').innerHTML=`<div class="detail-body"><div><div class="video-box"><video controls preload="metadata" playsinline ${thumbnailUrl?`poster="${esc(thumbnailUrl)}"`:""} src="${esc(mediaUrl)}" aria-label="原始录屏"></video></div><p id="videoStatus" class="detail-note" role="status">正在加载视频预览…</p><button id="reloadVideo" class="text-button" hidden>重新加载视频</button><p class="detail-note">${esc(row.recording.name)}<br>上传：${esc(time(row.recording.createdAt))}<br>场次：${row.session?esc(time(row.session.start)+' — '+time(row.session.end)):esc(row.sessionMatch?.reason||'待匹配班表')}</p><a href="${esc(mediaUrl+'&download=1')}" target="_blank" rel="noopener">打开原始录屏</a>${retryable(row)?'<p><button id="retryDetail">重新评分</button></p><p id="retryDetailStatus" class="detail-note" role="status"></p>':''}<p class="detail-note">${esc(row.error||'')}</p>${canManage&&row.state==='needs_review'&&!row.result&&!row.session?`<form id="identityForm" class="review-form"><h2>人工确认场次</h2><label>主播<input name="name" required value="${esc(row.name==='未识别主播'?'':row.name)}"></label><label>直播间<select name="room">${['官旗','品牌精选','优选','王鸥美肤'].map(room=>`<option ${room===row.room?'selected':''}>${room}</option>`).join('')}</select></label><label>场次开始（北京时间）<input name="start" type="datetime-local" required></label><label>场次结束（北京时间）<input name="end" type="datetime-local" required></label><button type="submit" class="primary">确认并重新入队</button></form>`:''}</div><div>${row.result?`<div class="detail-summary"><strong class="score ${row.result.warning?'low':'good'}">${row.result.total} / 100</strong><span class="tag">镜头 ${row.result.visual}/50</span><span class="tag">播感 ${row.result.audio}/50</span><p class="detail-note">${esc(row.result.model)} · ${esc(time(row.completedAt))}<br>试播通过：${row.result.trialPassed?'是':'否'}（与65分预警规则独立）</p></div>${row.result.dimensions.map(d=>`<div class="dimension"><b>${esc(d.name)}</b><strong>${d.score}</strong><div>${esc(d.evidence)}<br><small>${esc(d.improvement)}</small></div></div>`).join('')}<h2 class="detail-history">亮点与改进</h2><p class="detail-note">${esc(row.result.highlights.join('\n'))}\n${esc(row.result.improvements.join('\n'))}</p><h2>合规证据</h2><p class="detail-note">${esc(row.result.compliance.status==='clear'?'当前样本未发现明确命中':row.result.compliance.status==='uncertain'?'候选证据待人工复核，尚未确认违规':'命中风险')}\n${esc(row.result.compliance.hits.map(x=>`${x.term}：${x.context}${x.timeSeconds==null?'':`（${x.timeSeconds}秒）`}`).join('\n'))}</p>${row.policyCorrection?`<p class="detail-note">${esc(row.policyCorrection.reason)}${row.policyCorrection.externalReportUnchanged?'<br>此前已发送的报告保留原文，当前预警等级已更正。':''}</p>`:''}<h2 class="detail-history">近7天 · 本主播</h2>${scoreHistoryChart(row.history)}<div class="dimension-chart">${row.result.dimensions.map(d=>`<div><span>${esc(d.name)}</span><span>${esc(row.history.map(x=>x.result.dimensions.find(y=>y.name===d.name).score).join(' → '))}</span></div>`).join('')}</div>`:`<p class="empty">${esc(stateNames[row.state])}。尚无完整十维评分。</p>`}</div></div>`;
    const video=$('detail').querySelector('video'),videoStatus=$('videoStatus');
    if(video){
      const duration=()=>{const seconds=Math.round(video.duration);return Number.isFinite(seconds)?Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0'):'';};
      video.addEventListener('loadedmetadata',()=>{videoStatus.textContent='录屏时长 '+duration()+' · 点击播放';});
      video.addEventListener('loadeddata',()=>{videoStatus.textContent='录屏时长 '+duration()+' · 点击播放';});
      video.addEventListener('playing',()=>{videoStatus.textContent='';$('reloadVideo').hidden=true;});
      video.addEventListener('waiting',()=>{videoStatus.textContent='视频缓冲中…';});
      video.addEventListener('error',()=>{videoStatus.textContent=video.error?.code===4?'当前浏览器无法播放该录屏，可打开原始录屏查看。':'视频预览加载失败，请重新加载或打开原始录屏。';$('reloadVideo').hidden=false;});
      $('reloadVideo').addEventListener('click',()=>{videoStatus.textContent='正在重新加载视频预览…';$('reloadVideo').hidden=true;video.load();});
    }
    const side=$('detailBody').querySelector('.detail-body>div:first-child');
    if(row.manualReview){const note=document.createElement('p');note.className='detail-note';note.textContent='人工处理：'+row.manualReview.note+'\n登记时间：'+time(row.manualReview.at);side.append(note);}
    if(canManage&&(['needs_review','waiting_setup'].includes(row.state)||row.result?.requiresReview)){
      const button=document.createElement('button');button.textContent='登记人工处理结论';button.addEventListener('click',async()=>{const note=prompt('请填写人工核验结论及后续安排；这不会补造AI评分：');if(!note)return;try{await api('/evaluations/'+id+'/resolve',{body:{note}});await detail(id);await refresh();}catch(error){notice(error.message,true);}});side.append(button);
    }
    if(!$('detail').open)$('detail').showModal();
    $('retryDetail')?.addEventListener('click',event=>retryRecording(id,event.currentTarget));
    $('identityForm')?.addEventListener('submit',async event=>{event.preventDefault();const fields=Object.fromEntries(new FormData(event.currentTarget));fields.start+=':00+08:00';fields.end+=':00+08:00';try{await api('/evaluations/'+id+'/review',{body:fields});await detail(id);await refresh();}catch(error){alert(error.message);}});
  }catch(error){if(request!==detailRequest||activeId!==id)return;$('detailBody').innerHTML=`<p class="empty" role="alert">${esc(error.message)}</p><button class="text-button" data-detail="${esc(id)}">重新加载</button>`;notice(error.message,true);}}
  for(const id of ['date','room','state','days'])$(id).addEventListener('change',refresh);
  $('level').addEventListener('change',()=>{quickFilter='';paintRows();});
  $('clearFilters').addEventListener('click',async()=>{const hadState=Boolean($('state').value);quickFilter='';$('level').value='';$('state').value='';if(hadState)await refresh();else paintRows();});
  $('abnormal').addEventListener('click',async event=>{const button=event.target.closest('[data-filter]');if(button){const hadState=Boolean($('state').value);quickFilter=quickFilter===button.dataset.filter?'':button.dataset.filter;$('level').value=quickFilter==='severe'?'severe':quickFilter?'review':'';$('state').value='';if(hadState)await refresh();else paintRows();}});
  $('scan').addEventListener('click',async()=>{const button=$('scan');button.disabled=true;try{const result=await api('/scan',{body:{}});notice(`录屏已更新，新增 ${result.added} 条，匹配场次 ${result.matching?.matched??0} 条。`);await refresh();}catch(error){notice(error.message,true);}finally{button.disabled=false;}});
  $('automatic').addEventListener('change',()=>configureBackground($('automatic').checked?'enable':'pause'));
  $('start').addEventListener('click',()=>configureBackground('enable'));
  document.addEventListener('click',async event=>{const button=event.target.closest('[data-detail],[data-task],[data-retry]');if(!button)return;if(button.dataset.retry)return retryRecording(button.dataset.retry,button);if(button.dataset.detail)return detail(button.dataset.detail);const note=prompt('请填写复盘结论和改进安排：');if(!note)return;try{await api('/tasks/'+button.dataset.task,{body:{action:'complete',note}});await refresh();}catch(error){notice(error.message,true);}});
  $('closeDetail').addEventListener('click',()=>$('detail').close());$('detail').addEventListener('close',()=>{const video=$('detail').querySelector('video');if(video){video.pause();video.removeAttribute('src');video.load();}activeId='';detailRequest++;});
  refresh().then(async()=>{const id=new URLSearchParams(location.search).get('evaluation');if(id)detail(id);});
  setInterval(async()=>{await refresh();},15000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
})();
