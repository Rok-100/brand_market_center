import {createHash} from 'node:crypto';
import {notificationCard} from './notification-card.mjs';
import {competitorChart,competitorLinkTable} from './daily-intelligence-chart.mjs';
import {reportContent,safeUrl} from './daily-intelligence.mjs';

const escape=value=>String(value??'').replace(/[&<>*~_\[\]`#()]/g,ch=>`&#${ch.charCodeAt(0)};`);
const markdown=content=>({tag:'markdown',content});
const defaultUrl='https://hub.fandow.com/yxb/wis-marketing-hub/';
function renderedLine(line) {
  const match=line.match(/^(视频|详情)：(https?:\/\/\S+)$/);
  const url=match&&safeUrl(match[2]);
  if(url)return `${match[1]}：[${match[1]==='视频'?'查看视频':'源站详情'}](${url.replace(/[\s<>()\[\]"'\\]/g,ch=>[...Buffer.from(ch)].map(n=>'%'+n.toString(16).toUpperCase().padStart(2,'0')).join(''))})`;
  return escape(line);
}
// Paginate by actual escaped UTF-8 size. Cards must preserve all text, including
// arbitrary titles, instead of silently clipping a long source item.
function pages(text) {
  const result=[];let page='';
  for(const line of text.split('\n')) {
    const rendered=renderedLine(line);
    if(Buffer.byteLength(rendered)<=6500){
      if(page&&Buffer.byteLength(page+'<br>'+rendered)>7000){result.push(page);page='';}
      // Feishu folds soft Markdown newlines, especially inside list text.
      // Explicit breaks preserve the user-requested three-line layout.
      page+=(page?'<br>':'')+rendered;
    }else{
      // A very long link or line is represented literally across continuation
      // pages, never with a half-open Markdown link or a partial HTML entity.
      for(const character of line){const value=escape(character);if(Buffer.byteLength(page+value)>6500){result.push(page);page='';}page+=value;}
      page+='<br>';
    }
  }
  if(page.trim())result.push(page);return result.length?result:['暂无可展示的来源信息'];
}

function materialPages(report,textBlocks,imageKeys){
  const groups=[];
  for(const [i,block]of textBlocks.entries()){
    const item=report.materials.status==='ready'?report.materials.items[i-1]:null;
    const imageKey=item&&imageKeys[`${item.platform}:${item.id}`],url=item&&safeUrl(item.videoUrl||item.originalUrl);
    const displayBlock=imageKey&&url?block.split('\n').filter(line=>!line.startsWith('视频：')).join('\n'):block;
    const parts=pages(displayBlock);
    if(imageKey&&url&&parts.length===1){
      groups.push({tag:'column_set',flex_mode:'none',horizontal_spacing:'12px',columns:[
        {tag:'column',width:'120px',elements:[{tag:'interactive_container',width:'fill',padding:'0px',behaviors:[{type:'open_url',default_url:url}],elements:[{tag:'img',img_key:imageKey,alt:{tag:'plain_text',content:'点击封面播放'},preview:false,size:'120px 160px',scale_type:'crop_center'}]}]},
        {tag:'column',width:'weighted',weight:1,elements:[markdown(parts[0])]},
      ]});
    }else groups.push(...pages(block).map(markdown));
  }
  const result=[];let current=[],bytes=0;
  for(const group of groups){const n=Buffer.byteLength(JSON.stringify(group));if(current.length&&(bytes+n>8500||current.length>=9)){result.push(current);current=[];bytes=0;}current.push(group);bytes+=n;}
  if(current.length)result.push(current);return result.length?result:[[markdown('暂无可展示的来源信息')]];
}

export function intelligenceCardMessages(report,target,{publicUrl=defaultUrl,imageKeys={}}={}) {
  const blocks=reportContent(report),url=safeUrl(publicUrl)||defaultUrl;
  const materials=materialPages(report,blocks.materials,imageKeys);
  const sections=materials.map((elements,i)=>({key:'materials:'+i,title:`${report.window.dataDate||report.window.date} · 凡岛素材${materials.length>1?` · ${i+1}/${materials.length}`:''}`,elements,text:blocks.materials.join('\n\n')}));
  if(report.competitors.boards){
    for(const board of report.competitors.boards){
      const ready=board.status==='ready'&&board.items.length;
      sections.push({key:'board:'+board.key,title:`${board.dataDate||report.window.dataDate||report.window.date} · ${board.label}`,text:blocks.competitors.join('\n\n'),elements:ready?[
        markdown(`${board.items.length} 条入选${board.snapshotHour!=null?' · '+String(board.snapshotHour).padStart(2,'0')+':00 截点':''}`),
        competitorChart(board),competitorLinkTable(board),
      ]:[markdown(escape(board.status==='ready'?'暂无符合条件记录':board.error||'等待完整批次'))]});
    }
  }else sections.push({key:'competitors',title:`${report.window.dataDate||report.window.date} · 竞品榜单`,text:blocks.competitors.join('\n\n'),elements:pages(blocks.competitors.join('\n\n')).map(markdown)});
  return sections.map(section=>{
    const card=notificationCard(`${section.title}\n${section.title}\n${url}`);
    card.config.summary={content:`${report.test?'本地测试 · ':''}${section.title}`};
    card.body.elements=[...section.elements,{tag:'button',text:{tag:'plain_text',content:'打开中枢平台'},type:'primary',size:'medium',behaviors:[{type:'open_url',default_url:url}]}];
    const content=JSON.stringify(card);
    if(Buffer.byteLength(content)>28000)throw Error('日报卡片超出发送大小限制');
    const version=section.key.startsWith('board:')?'card-v8-clean-axis':'card-v7-separate';
    const uuid=createHash('sha256').update(`${report.id}:${version}:${section.key}:${target.type}:${target.id}`).digest('hex').slice(0,32);
    return {text:section.title+'\n'+section.text,uuid,payload:{msg_type:'interactive',content}};
  });
}
