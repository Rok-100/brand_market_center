export function assertFeishuCardRequest(path,body){
  if(!/^\/im\/v1\/messages(?:\?|$)|^\/im\/v1\/messages\/[^/]+\/reply(?:\?|$)/u.test(path))return;
  let card;try{card=JSON.parse(body?.content);}catch{}
  const valid=card&&typeof card==='object'&&!Array.isArray(card)&&(
    card.schema==='2.0'&&Array.isArray(card.body?.elements)
    ||!card.schema&&Array.isArray(card.elements)
    ||card.type==='card'&&typeof card.data?.card_id==='string');
  if(body?.msg_type!=='interactive'||!valid)throw Object.assign(new Error('飞书通知须使用合法的互动卡片。'),{code:'card_required',status:422});
}
