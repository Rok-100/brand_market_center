export const monthlyRooms = [
  {code:'guanqi',room:'官旗',title:'官旗数据（2.23后）'},
  {code:'brand-selection',room:'品牌精选',title:'品牌精选'},
  {code:'preferred',room:'优选',title:'优选'},
  {code:'wangou',room:'王鸥美肤',title:'王鸥美肤'},
] as const;

export function selectMonthlySheet(sheets: Array<Record<string, unknown>>, code: string) {
  const room=monthlyRooms.find(item=>item.code===code);
  if(!room)throw new Error('无效直播间');
  const matches=sheets.filter(sheet=>String(sheet.title??'').trim()===room.title);
  if(matches.length!==1||!matches[0].sheet_id)throw new Error(`${room.room}：未找到唯一子表“${room.title}”`);
  return matches[0];
}

export function lastDailyGmv(rows: unknown[][], column: number, firstRow: number) {
  for(let index=rows.length-1;index>=0;index--){
    const value=rows[index]?.[column];
    const raw=String(value??'').trim();
    if(!raw)continue;
    const numeric=raw.replace(/[¥￥,\s]/g,'');
    const match=numeric.match(/^(\d+(?:\.\d+)?)(万)?$/);
    const gmv=match?Number(match[1])*(match[2]?10000:1):null;
    return {gmv:gmv!==null&&Number.isFinite(gmv)?gmv:null,sourceRow:firstRow+index};
  }
  return {gmv:null,sourceRow:null};
}
