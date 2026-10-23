// Attribution is an explicit statement in the learning-group message, never a roster lookup.
const roomPattern=/官旗|品牌精选|优选|王鸥美肤/gu;
export function parseRecordingCaption(value) {
  const text=String(value||'').replace(/<\/(?:p|div)>|<br\s*\/?\s*>/giu,'\n').replace(/<[^>]*>/gu,' ')
    .replace(/&nbsp;|&#160;/giu,' ').replace(/&amp;/giu,'&').replace(/&lt;/giu,'<').replace(/&gt;/giu,'>').trim();
  const candidates=[];
  for(const match of text.matchAll(roomPattern)){
    const rest=text.slice(match.index+match[0].length);
    const name=rest.match(/^[\s:：|/，,、\-—【】\[\]]*(?:主播\s*[:：]?\s*)?([\p{Script=Han}·]{1,8}|[A-Za-z][A-Za-z·.\-]{0,39})(?=[\s（(，,。；;:：\[【\]】]|$)/u);
    if(!name||/主播|直播间|录屏|声音|麦克风|背景音乐|无异常|正常|[与和及]/u.test(name[1]))return null;
    const tail=rest.slice(name[0].length);
    if(/^\s*[、&＆/]/u.test(tail)||/^\s*[与和及]\s*\p{Script=Han}/u.test(tail))return null;
    candidates.push({name:name[1],room:match[0]});
  }
  const unique=new Map(candidates.map(x=>[x.room+'|'+x.name,x]));
  return unique.size===1?{...unique.values().next().value,text:String(value||'')}:null;
}

export function recordingMessageCaption(message,messages) {
  const own=parseRecordingCaption(message.text);
  if(own)return {...own,captionMessageId:message.messageId,captionCreatedAt:message.createdAt,association:'own_message'};
  // An ambiguous explicit caption cannot be replaced by a neighbouring caption.
  if(/官旗|品牌精选|优选|王鸥美肤/u.test(String(message.text||'')))return null;
  const sender=message.sender?.id||message.sender?.name;
  if(!sender)return null;
  const candidates=messages.filter(item=>(item.sender?.id||item.sender?.name)===sender
    &&Math.abs(Date.parse(item.createdAt)-Date.parse(message.createdAt))<=300000)
    .map(item=>({item,caption:parseRecordingCaption(item.text)})).filter(x=>x.caption);
  const identities=new Set(candidates.map(x=>x.caption.room+'|'+x.caption.name));
  if(identities.size!==1){
    // Operators may post several distinct video + caption pairs in one batch.
    // Accept only complete, unambiguous short pairs; a nearest-name guess alone
    // is insufficient when captions conflict or one video attracts two names.
    const videos=[...new Map(messages.filter(item=>(item.sender?.id||item.sender?.name)===sender
      &&Math.abs(Date.parse(item.createdAt)-Date.parse(message.createdAt))<=300000
      &&item.resources?.some(resource=>resource.type==='video'||/\.(?:mp4|mov|webm|m4v)$/iu.test(resource.name||'')))
      .map(item=>[item.messageId,item])).values()];
    if(videos.length<2||!videos.some(item=>item.messageId===message.messageId))return null;
    const assigned=new Map();
    for(const candidate of candidates){
      const nearest=videos.map(video=>({video,distance:Math.abs(Date.parse(video.createdAt)-Date.parse(candidate.item.createdAt))})).sort((a,b)=>a.distance-b.distance);
      if(!nearest.length||nearest[0].distance>15000||nearest[1]?.distance===nearest[0].distance)return null;
      const key=nearest[0].video.messageId,list=assigned.get(key)||[];list.push(candidate);assigned.set(key,list);
    }
    for(const list of assigned.values())if(new Set(list.map(x=>x.caption.room+'|'+x.caption.name)).size!==1)return null;
    const pair=assigned.get(message.messageId);if(!pair?.length)return null;
    pair.sort((a,b)=>Math.abs(Date.parse(a.item.createdAt)-Date.parse(message.createdAt))-Math.abs(Date.parse(b.item.createdAt)-Date.parse(message.createdAt)));
    const {item,caption}=pair[0];
    return {...caption,captionMessageId:item.messageId,captionCreatedAt:item.createdAt,association:'same_sender_adjacent_pair'};
  }
  candidates.sort((a,b)=>Math.abs(Date.parse(a.item.createdAt)-Date.parse(message.createdAt))-Math.abs(Date.parse(b.item.createdAt)-Date.parse(message.createdAt)));
  const {item,caption}=candidates[0];
  return {...caption,captionMessageId:item.messageId,captionCreatedAt:item.createdAt,association:'same_sender_caption'};
}

// This known spelling alias is used only to verify the official schedule; display stays verbatim.
export const scheduleNameKey=value=>String(value||'').replace(/\s+/gu,'').replace(/^黄芷瞳$/u,'黄芷曈');
