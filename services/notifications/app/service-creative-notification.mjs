// This alias is explicit local-test configuration, never a fallback for real users.
export function creativeNotificationEvent(n,{localRecipient='',allowed=[],publicUrl='https://hub.fandow.com/yxb/wis-marketing-hub/modules/creative-hub/'}={}){
 if(localRecipient&&!allowed.includes(localRecipient))throw Error('Local creative recipient is not allowed');
 const originalRecipient=n.employee_no||'unmapped:'+n.user_id;
 let recipient=originalRecipient;
 if(recipient==='LOCAL-CREATIVE')recipient=localRecipient||n.supervisor_employee_no||recipient;
 let scriptNotification;
 if(n.type==='script_card') {
  try { scriptNotification=JSON.parse(n.script_payload); } catch { throw Error('Script notification snapshot missing'); }
  if(scriptNotification.schema!==1 || !['generated','alternative','approved'].includes(scriptNotification.kind) ||
     typeof scriptNotification.content!=='string' || !scriptNotification.content ||
     (scriptNotification.chatId && (scriptNotification.kind!=='approved'||!/^oc_[a-zA-Z0-9]{8,128}$/.test(scriptNotification.chatId)))) throw Error('Invalid script notification snapshot');
 }
 let active=true;
 if(n.title.startsWith('待审核：'))active=n.status==='pending_team_lead';
 else if(n.title.startsWith('待终审：'))active=n.status==='pending_supervisor';
 else if(n.title.startsWith('重新送审：'))active=['pending_team_lead','pending_supervisor'].includes(n.status)&&n.current_reviewer_id===n.user_id;
 else if(n.title.startsWith('脚本需修改：'))active=n.status==='returned_to_creator';
 else if(n.title.startsWith('已归档：'))active=['approved','archived'].includes(n.status);
 return {key:n.id,recipient,originalRecipient,localRecipientAlias:originalRecipient==='LOCAL-CREATIVE'&&recipient!==originalRecipient,active,
  scriptNotification,
  service:'Idea OS 创意来源',title:n.title,message:[n.detail,'脚本编号：'+n.draft_id,'产品：'+(n.product||'未分类'),'脚本版本：'+(n.version||1)].join('\n'),createdAt:n.created_at,url:publicUrl};
}
