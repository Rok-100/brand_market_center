// Feishu Card 2.0. The existing message remains the source of business facts.
const escape = value => String(value ?? '').replace(/[&<>*~_\[\]`#]/g, ch => `&#${ch.charCodeAt(0)};`);
const markdown = (content, extra = {}) => ({tag:'markdown',content,...extra});
export function notificationCard(text,{recipientName='',buttonLabel='查看任务'}={}) {
 const lines=String(text).split('\n').map(x=>x.trim()).filter(Boolean);
 const header=lines.shift()||'任务通知',title=lines.shift()||'任务状态更新';
 const tail=lines.at(-1)||'',urlText=tail.replace(/^(?:打开工作台|查看稿件)[：:]\s*/, '');
 let url;try{const parsed=new URL(urlText);if(['http:','https:'].includes(parsed.protocol)&&!parsed.username&&!parsed.password)url=parsed.href;}catch{}
 if(url)lines.pop();
 const fields=[],details=[];
 for(const line of lines){
  const match=line.match(/^(当前环节|截止|截止时间|事件时间|指派范围|操作人|办理人|生成时间|篇数|产品|单品|业务编号)[：:]\s*(.*)$/);
  if(match)fields.push([match[1]==='截止'?'截止时间':match[1],match[2]]);else details.push(line);
 }
 if(recipientName&&!fields.some(([label])=>label==='办理人'))fields.splice(1,0,['办理人',recipientName]);
 const columns=[[],[]];fields.forEach(([label,value],i)=>columns[i%2].push(`**${escape(label)}**\n${escape(value)}`));
 const elements=[markdown(`**${escape(title)}**`,{text_size:'heading-3'})];
 if(fields.length)elements.push({tag:'column_set',flex_mode:'none',horizontal_spacing:'12px',columns:columns.filter(c=>c.length).map(col=>({tag:'column',width:'weighted',weight:1,vertical_spacing:'8px',elements:col.map(value=>markdown(value))}))});
 if(details.length)elements.push(markdown(details.map(escape).join('\n')));
 // Match the user's reference: a blue outline button, sized to its label.
 if(url)elements.push({tag:'button',text:{tag:'plain_text',content:buttonLabel},type:'primary',size:'medium',behaviors:[{type:'open_url',default_url:url}]});
 return {schema:'2.0',config:{update_multi:true,width_mode:'default',summary:{content:`${header} · ${title}`}},header:{template:'blue',title:{tag:'plain_text',content:header}},body:{direction:'vertical',padding:'12px',vertical_spacing:'12px',elements}};
}
