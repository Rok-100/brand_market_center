(() => {
  const stages = ['暖场与痛点', '卖点与背书', '机制与售后', '第一轮逼单', '第二轮承接', '使用方法与换角度', '循环收口'];
  const apiBase = location.pathname.slice(0, location.pathname.lastIndexOf('/modules/'));
  const $ = selector => document.querySelector(selector);
  const product = $('#generatorProduct'), customProduct = $('#generatorCustomProduct');
  const sourceUrls = $('#generatorSourceUrls'), count = $('#generatorCount'), brief = $('#generatorBrief'), persona = $('#generatorPersona'), customPersona = $('#generatorCustomPersona');
  const broadcastMode = $('#generatorBroadcastMode'), platform = $('#generatorPlatform'), price = $('#generatorPrice'), mainQuantity = $('#generatorMainQuantity'), gifts = $('#generatorGifts');
  const stageRoot = $('#generatorStages'), editors = $('#generatorEditors'), fullScript = $('#generatorFullScript'), status = $('#generatorStatus'), sources = $('#generatorSources');
  const generateButton = $('#generateCommunication'), saveButton = $('#saveCommunicationDraft'), versionSelect = $('#generatorVersion'), complianceRoot = $('#generatorCompliance'), historyRoot = $('#generatorHistory'), productSource = $('#generatorProductSource');
  let config = null, current = null, activeIndex = 0, drafts = [];
  let selectedReviewer=null,searchSequence=0,searchTimer,reviewRequest=null,viewingReview=false;
  const reviewerSearch=$('#reviewerSearch'),reviewerResults=$('#reviewerResults'),submitReview=$('#submitCommunicationReview'),reviewStatus=$('#reviewStatus'),reviewDetail=$('#reviewDetail'),reviewList=$('#communicationReviewList');
  const reviewLabel={pending:'待审核',approved:'已通过',rejected:'已驳回'};
  function updateReviewButton(){submitReview.disabled=!current||!selectedReviewer||viewingReview;}
  const gEsc = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  const dateTime = value => { const date = new Date(value || ''); return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(date); };

  function setStatus(message, error = false) { status.textContent = message; status.classList.toggle('error', error); }
  async function api(path, options = {}) {
    const response = await fetch(`${apiBase}${path}`, {credentials:'same-origin',cache:'no-store',...options,headers:{Accept:'application/json',...(options.body?{'Content-Type':'application/json','X-Requested-With':'XMLHttpRequest'}:{}),...(options.headers||{})}});
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) throw new Error(payload.error || '沟通稿服务请求失败。');
    return payload;
  }
  function selectedProduct() { return customProduct.value.trim() || product.value; }
  function selectedPersona() { return customPersona.value.trim() || persona.value; }
  function selectedStages() { return [...stageRoot.querySelectorAll('input:checked')].map(input => input.value); }
  function renderStageSelectors() { stageRoot.innerHTML = `<legend>生成环节</legend>${stages.map(stage => `<label><input type="checkbox" value="${stage}" checked />${stage}</label>`).join('')}`; }
  function currentScripts() {
    if (!current) return [];
    if (!Array.isArray(current.scripts) || !current.scripts.length) current.scripts = [{index:1,fullScript:current.fullScript || '',compliance:current.compliance || null}];
    return current.scripts;
  }
  function syncActive() {
    if (!current) return;
    stages.forEach(stage => {
      const values = Array.isArray(current.stages?.[stage]) ? current.stages[stage] : [];
      while (values.length <= activeIndex) values.push('');
      values[activeIndex] = editors.querySelector(`[data-stage-editor="${stage}"]`)?.value.trim() || '';
      current.stages[stage] = values;
    });
    const scripts = currentScripts(); scripts[activeIndex].fullScript = fullScript.value; current.fullScript = scripts[0]?.fullScript || '';
  }
  function combine() {
    fullScript.value = stages.map(stage => { const value = editors.querySelector(`[data-stage-editor="${stage}"]`)?.value.trim(); return value ? `【${stage}】\n${value}` : ''; }).filter(Boolean).join('\n\n');
    if (current) syncActive();
  }
  function renderCompliance(item) {
    const value = item?.compliance;
    if (!value) { complianceRoot.textContent = '该草稿的合规结果待重新生成或复核。'; return; }
    const risks = value.risks?.length ? value.risks : ['未读到明确风险项'];
    const pending = value.pendingConfirmations?.length ? value.pendingConfirmations : ['发布前仍需业务人确认当日价格、数量和赠品'];
    complianceRoot.innerHTML = `<b>${gEsc(value.conclusion || '待复核')}</b><div><strong>风险项</strong>${risks.map(row=>`<span>${gEsc(row)}</span>`).join('')}</div><div><strong>发布前确认</strong>${pending.map(row=>`<span>${gEsc(row)}</span>`).join('')}</div>`;
  }
  function renderEditors(data = null, index = 0) {
    activeIndex = index;
    editors.innerHTML = stages.map(stage => {
      const value = data?.stages?.[stage]?.[index] || '';
      return `<article class="generator-editor"><header><h3>${stage}</h3><small>${value ? `第 ${index + 1} 篇` : '未选/待编辑'}</small></header><textarea rows="6" data-stage-editor="${stage}" placeholder="${stage}内容">${gEsc(value)}</textarea></article>`;
    }).join('');
    editors.querySelectorAll('textarea').forEach(area => area.addEventListener('input', combine));
    if (data) fullScript.value = currentScripts()[index]?.fullScript || ''; else combine();
    renderCompliance(currentScripts()[index]);
  }
  function renderVersions() {
    const scripts = currentScripts(); versionSelect.hidden = scripts.length < 2;
    versionSelect.innerHTML = scripts.map((_, index) => `<option value="${index}">第 ${index + 1} 篇</option>`).join('');
    versionSelect.value = String(Math.min(activeIndex, scripts.length - 1));
  }
  function renderSources(data) {
    const rows = data?.sources || [];
    sources.innerHTML = rows.length ? `已核验 ${rows.length} 个飞书来源：${rows.map(item=>`<a href="${gEsc(item.sourceUrl)}" target="_blank" rel="noopener">${gEsc(item.title || '来源原文')}</a>`).join(' · ')}${data.sourceCoverage?.failures?.length?`；${data.sourceCoverage.failures.length} 个来源读取失败`:''}` : '没有可核验来源';
  }
  function renderProductSource() {
    const item = config?.productCatalog?.find(row => row.name === product.value);
    productSource.textContent = item ? `WIS 产品资料库 · ${item.sources?.length || 0} 个可读文档${item.filing?` · 备案 ${item.filing}`:''}` : `产品资料库${config?.productCatalogStatus || '待核验'}`;
  }
  function openDraft(draft) {
    viewingReview=false;reviewDetail.hidden=true;reviewRequest=null;
    current = structuredClone(draft); activeIndex = 0; customProduct.value = ''; product.value = current.product;
    if (current.context) { persona.value = current.context.persona || persona.value; broadcastMode.value = current.context.broadcastMode || '单播'; platform.value = current.context.platform || '抖音'; price.value = current.context.mechanism?.price || ''; mainQuantity.value = current.context.mechanism?.mainQuantity || ''; gifts.value = current.context.mechanism?.gifts || ''; }
    renderVersions(); renderEditors(current,0); renderSources(current); saveButton.disabled = false; setStatus(`已打开 ${dateTime(current.updatedAt || current.generatedAt)} 的草稿`);
    setEditorsReadOnly(false);updateReviewButton();
  }
  function renderHistory() {
    historyRoot.innerHTML = drafts.length ? drafts.map((draft,index)=>`<button type="button" data-draft-index="${index}"><b>${gEsc(draft.product)}</b><span>${gEsc(draft.context?.persona || '旧版人设待补充')} · ${dateTime(draft.updatedAt)}</span></button>`).join('') : '暂无已保存草稿。';
    historyRoot.querySelectorAll('[data-draft-index]').forEach(button => button.addEventListener('click',()=>openDraft(drafts[Number(button.dataset.draftIndex)])));
  }
  window.MaterialShared?.subscribe(()=>loadHistory());
  async function loadHistory() { const payload = await api('/api/script-generator/drafts'); drafts = payload.drafts || []; renderHistory(); }
  async function loadConfig() {
    if (config) return;
    const payload = await api('/api/script-generator/config'); config = payload;
    product.innerHTML = payload.products.map(name => `<option value="${gEsc(name)}">${gEsc(name)}</option>`).join('');
    persona.innerHTML = (payload.personas || ['专业顾问型']).map(name=>`<option>${gEsc(name)}</option>`).join('');
    renderProductSource();
    setStatus(payload.configured ? `模型 ${payload.model} 已就绪 · 产品库${payload.productCatalogStatus}` : '模型服务尚未配置，当前不可生成', !payload.configured);
    await loadHistory();
    await loadReviews();
    const reviewId=new URLSearchParams(location.search).get('review');
    if(reviewId){await openReview(reviewId);return;}
    const draftId=new URLSearchParams(location.search).get('draft');
    if(draftId){const result=await api('/api/script-generator/drafts/'+encodeURIComponent(draftId));openDraft(result.draft)}
  }
  async function generate() {
    const pickedStages = selectedStages(), name = selectedProduct();
    if (!pickedStages.length) return setStatus('请至少选择一个生成环节。', true);
    if (!name) return setStatus('请选择或填写产品。', true);
    if (customProduct.value.trim() && !sourceUrls.value.trim()) return setStatus('新增产品必须提供可验证的飞书资料链接。', true);
    generateButton.disabled = true; saveButton.disabled = true; setStatus('正在读取产品原文、生成完整稿并做合规复核…');
    try {
      const payload = await api('/api/script-generator/generate',{method:'POST',body:JSON.stringify({requestId:crypto.randomUUID(),product:name,persona:selectedPersona(),broadcastMode:broadcastMode.value,platform:platform.value,mechanism:{price:price.value.trim(),mainQuantity:mainQuantity.value.trim(),gifts:gifts.value.trim()},stages:pickedStages,count:Number(count.value),brief:brief.value.trim(),sourceUrls:sourceUrls.value.split(/\r?\n/u).map(item=>item.trim()).filter(Boolean)})});
      viewingReview=false;reviewDetail.hidden=true;current = payload.data; activeIndex = 0; renderVersions(); renderEditors(current,0); renderSources(current); saveButton.disabled = false;setEditorsReadOnly(false);updateReviewButton();
      const notice=current.notification?.state==='sent'?'已飞书通知本人':current.notification?.state==='failed'?'飞书通知未发送，请核对本人飞书绑定':'飞书通知结果待确认';
      setStatus(`已生成 ${current.scripts?.length || 1} 篇并自动保存 · ${current.model} · ${notice}`);
      await loadHistory();
    } catch (error) { setStatus(error.message,true); }
    finally { generateButton.disabled = false;updateReviewButton(); }
  }

  function setEditorsReadOnly(value){editors.querySelectorAll('textarea').forEach(x=>x.readOnly=value);fullScript.readOnly=value;$('#combineCommunication').disabled=value;saveButton.disabled=value||!current;}
  async function loadReviews(){
    try{const payload=await api('/api/script-generator/reviews');reviewList.innerHTML=payload.items.length?payload.items.map(r=>`<button type="button" data-review-id="${gEsc(r.id)}"><b>${gEsc(r.product)} · ${reviewLabel[r.status]||'待确认'}</b><span>提交人：${gEsc(r.submitter.name)} · 审核人：${gEsc(r.reviewer.name)} · ${dateTime(r.submittedAt)}${r.canDecide?' · 待我审核':''}</span></button>`).join(''):'暂无相关审核记录。';reviewList.querySelectorAll('[data-review-id]').forEach(b=>b.addEventListener('click',()=>openReview(b.dataset.reviewId).catch(e=>reviewStatus.textContent=e.message)))}catch(e){reviewList.textContent=e.message}
  }
  function noticeLabel(r){return r.notification?.state==='sent'?'已飞书通知提交人':r.notification?.state==='failed'?'飞书通知失败，审核结果已保存':r.notification?.state==='uncertain'||r.notification?.state==='pending'?'飞书通知结果待确认':''}
  function submissionLabel(r){return ({sent:'已飞书通知审核人',failed:'飞书发送失败，可到审核记录重试',uncertain:'飞书发送结果待确认',pending:'飞书发送结果待确认'})[r.submissionNotification?.state]||'未发送，可到审核记录补发';}
  function renderReview(r){
    reviewDetail.hidden=false;reviewDetail.innerHTML=`<h4>${reviewLabel[r.status]} · 本次提交快照</h4><p>提交人：${gEsc(r.submitter.name)} · 审核人：${gEsc(r.reviewer.name)} · ${dateTime(r.submittedAt)}</p><p>${gEsc(r.comment||'')}</p><p>${gEsc(noticeLabel(r))}</p>${r.canDecide?'<label for="reviewComment">审核意见（驳回必填）</label><textarea id="reviewComment" rows="3" maxlength="2000" placeholder="填写审核意见或驳回原因"></textarea><div class="review-decisions"><button type="button" data-decision="approved">通过</button><button type="button" data-decision="rejected">驳回</button></div>':''}${r.status!=='pending'?'<button type="button" id="editReviewSnapshot">以此稿件继续编辑</button>':''}`;
    const submissionStatus=document.createElement('p');submissionStatus.textContent='审核人通知：'+submissionLabel(r);reviewDetail.prepend(submissionStatus);
    reviewDetail.querySelectorAll('[data-decision]').forEach(button=>button.addEventListener('click',async()=>{
      const decision=button.dataset.decision,comment=$('#reviewComment').value.trim();if(decision==='rejected'&&!comment){reviewStatus.textContent='请填写驳回原因。';return;}
      reviewDetail.querySelectorAll('button').forEach(b=>b.disabled=true);
      try{const payload=await api('/api/script-generator/reviews/'+r.id,{method:'POST',body:JSON.stringify({decision,comment})});renderReview(payload.review);reviewStatus.textContent=`${reviewLabel[payload.review.status]} · ${noticeLabel(payload.review)}`;await loadReviews()}catch(e){reviewStatus.textContent=e.message;reviewDetail.querySelectorAll('button').forEach(b=>b.disabled=false)}
    }));
    $('#editReviewSnapshot')?.addEventListener('click',()=>{openDraft(r.snapshot);reviewStatus.textContent='正在编辑副本，保存或重新提交不会改变此前审核快照。';});
  }
  async function openReview(id){const payload=await api('/api/script-generator/reviews/'+encodeURIComponent(id));openDraft(payload.review.snapshot);viewingReview=true;setEditorsReadOnly(true);updateReviewButton();renderReview(payload.review);setStatus('当前显示人工审核的提交快照');}
  reviewerSearch.addEventListener('input',()=>{
    selectedReviewer=null;reviewRequest=null;updateReviewButton();clearTimeout(searchTimer);const sequence=++searchSequence,q=reviewerSearch.value.trim();reviewerResults.replaceChildren();if(!q)return;
    reviewerResults.textContent='正在查询…';searchTimer=setTimeout(async()=>{try{const payload=await api('/api/script-generator/reviewers?q='+encodeURIComponent(q));if(sequence!==searchSequence)return;reviewerResults.innerHTML=payload.items.length?payload.items.map((p,i)=>`<button type="button" data-person="${i}"><b>${gEsc(p.name)}</b><span>${gEsc(p.number)} · ${gEsc(p.department)}</span></button>`).join(''):'未找到匹配的在职人员，请调整姓名。';reviewerResults.querySelectorAll('[data-person]').forEach(b=>b.addEventListener('click',()=>{selectedReviewer=payload.items[Number(b.dataset.person)];reviewerSearch.value=selectedReviewer.name;reviewerResults.replaceChildren();updateReviewButton()}))}catch(e){if(sequence===searchSequence)reviewerResults.textContent='人员查询暂不可用，请稍后重试。'}},250);
  });
  submitReview.addEventListener('click',async()=>{
    if(!current||!selectedReviewer||viewingReview)return;syncActive();current.context={persona:selectedPersona(),broadcastMode:broadcastMode.value,platform:platform.value,mechanism:{price:price.value.trim(),mainQuantity:mainQuantity.value.trim(),gifts:gifts.value.trim()}};
    const content=JSON.stringify({draft:current,reviewerNumber:selectedReviewer.number});if(reviewRequest?.content!==content)reviewRequest={content,id:crypto.randomUUID()};submitReview.disabled=true;reviewStatus.textContent='正在保存并提交审核…';
    try{const payload=await api('/api/script-generator/reviews',{method:'POST',body:JSON.stringify({...JSON.parse(content),requestId:reviewRequest.id})});reviewStatus.textContent=`已提交 ${payload.review.reviewer.name} 审核 · ${submissionLabel(payload.review)}`;await openReview(payload.review.id);await loadReviews();await loadHistory()}catch(e){reviewStatus.textContent=e.message}finally{updateReviewButton()}
  });
  $('#refreshCommunicationReviews').addEventListener('click',loadReviews);
  async function save() {
    if (!current) return;
    syncActive(); saveButton.disabled = true; setStatus('正在保存草稿…');
    try {
      current.context = {persona:selectedPersona(),broadcastMode:broadcastMode.value,platform:platform.value,mechanism:{price:price.value.trim(),mainQuantity:mainQuantity.value.trim(),gifts:gifts.value.trim()}};
      const payload = await api('/api/script-generator/save',{method:'POST',body:JSON.stringify(current)}); current={...current,...payload.draft}; setStatus(`草稿已保存 · ${dateTime(payload.draft.updatedAt)} · ${payload.draft.updatedBy}`); await loadHistory();
    } catch (error) { setStatus(error.message,true); }
    finally { saveButton.disabled = false; }
  }

  renderStageSelectors(); renderEditors();
  loadConfig().catch(error=>setStatus(error.message,true));
  product.addEventListener('change',renderProductSource); versionSelect.addEventListener('change',()=>{if(!viewingReview)syncActive();renderEditors(current,Number(versionSelect.value));setEditorsReadOnly(viewingReview);});
  $('#combineCommunication').addEventListener('click',combine); generateButton.addEventListener('click',generate); saveButton.addEventListener('click',save);
})();
