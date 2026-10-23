const labels={review:'拉片待审核',assignment:'视频复刻任务待接单',unassigned:'视频复刻指派已调整',accepted:'同事已接单',completed:'同事已提交处理结果',failed:'视频拉片失败，请处理'};
const values={high:'高',medium:'中',low:'低'};
const plain=(value,max=400)=>Array.from(String(value??'').replace(/[\u0000-\u001f\u007f]/gu,' ').trim()).slice(0,max).join('');
const md=value=>plain(value).replace(/[&<>*~[\]()#:_`\\]/gu,ch=>'&#'+ch.codePointAt(0)+';');
export function dissectionNotificationCard(notice,job,{publicUrl='https://hub.fandow.com/yxb/wis-marketing-hub/',context=''}={}){
  const target=new URL(publicUrl);if(!['https:','http:'].includes(target.protocol)||target.username||target.password)throw Error('通知任务链接无效');
  target.hash='dissection-review='+encodeURIComponent(job.id);
  const label=labels[notice.kind];if(!label)throw Error('未知拉片通知类型');
  const color=notice.kind==='failed'?'red':notice.kind==='unassigned'?'orange':['accepted','completed'].includes(notice.kind)?'green':'blue';
  const assessment=job.assessment;
  const owner=job.assignee?.name||job.reviewer?.name||job.reviewerNumber;
  const columns=[
    {tag:'column',width:'weighted',weight:1,padding:'12px',elements:[{tag:'markdown',content:assessment?`复刻价值\n**${md(values[assessment.value])} · ${assessment.score}/100**`:`当前环节\n**${md(label)}**`}]},
    {tag:'column',width:'weighted',weight:1,padding:'12px',elements:[{tag:'markdown',content:`${job.assignee?'处理人':'审核主管'}\n${md(owner)}`}]}
  ];
  const detail=notice.kind==='completed'?job.output?.note:notice.kind==='failed'?job.error:['assignment','unassigned','accepted'].includes(notice.kind)?job.assignment?.note:assessment?.summary;
  const elements=[
    {tag:'markdown',content:`**${md(plain(job.material.title,160))}**`},
    {tag:'column_set',flex_mode:'none',background_style:'cus-metrics',horizontal_spacing:'8px',columns},
    ...(detail?[{tag:'markdown',content:md(detail)}]:[]),
    {tag:'button',element_id:'view_task',text:{tag:'plain_text',content:'查看任务'},type:'primary_filled',width:'fill',behaviors:[{type:'open_url',default_url:target.href}]},
    ...(context?[{tag:'markdown',content:md(context),text_size:'notation'}]:[])
  ];
  return {msg_type:'interactive',content:JSON.stringify({schema:'2.0',config:{update_multi:true,width_mode:'compact',summary:{content:`${label} · ${plain(job.material.title,100)}`},style:{color:{'cus-metrics':{light_mode:'rgba(100,106,115,0.06)',dark_mode:'rgba(150,155,163,0.12)'}}}},header:{title:{tag:'plain_text',content:label},subtitle:{tag:'plain_text',content:context?'本地本人联调 · WIS 拉片审核':'WIS 拉片审核 · '+plain(job.dataDate||'')},template:color},body:{direction:'vertical',vertical_spacing:'12px',padding:'12px',elements}})};
}
