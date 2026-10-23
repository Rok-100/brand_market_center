// Historical reference scripts may contain obsolete prices. They are not the
// operator's current commercial terms, so omit them from model evidence.
export function communicationEvidenceText(value,mechanism={}){
 let text=String(value||'');
 if(!mechanism.price)text=text.replace(/[¥￥]\s*\d+(?:\.\d+)?/gu,'[历史金额省略]')
  .replace(/\d+(?:\.\d+)?\s*(?:元|块钱)/gu,'[历史金额省略]')
  .replace(/(?:到手价|日常价|专柜价|活动价|价格|售价|现价|原价)\s*[:：]?\s*\d+(?:\.\d+)?/gu,'[历史价格省略]');
 if(!mechanism.gifts)text=text.replace(/[^。\n！？]*(?:加赠|赠送|赠品)[^。\n！？]*/gu,'[历史赠品机制省略]');
 return text;
}
