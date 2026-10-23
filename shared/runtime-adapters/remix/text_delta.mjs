import {createHash} from 'node:crypto';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

// Compare bytes so a shared prefix inside a UTF-8 character remains exact.
export function textDelta(before,after) {
  // Inputs are only read during this synchronous computation. Reuse Buffers
  // rather than copying both 50+ MB documents on every library commit.
  const old=Buffer.isBuffer(before)?before:Buffer.from(before),next=Buffer.isBuffer(after)?after:Buffer.from(after),limit=Math.min(old.length,next.length);
  let prefix=0,suffix=0;
  while(prefix+65536<=limit&&old.subarray(prefix,prefix+65536).equals(next.subarray(prefix,prefix+65536)))prefix+=65536;
  while(prefix<limit&&old[prefix]===next[prefix])prefix++;
  while(suffix+65536<=limit-prefix&&old.subarray(old.length-suffix-65536,old.length-suffix).equals(next.subarray(next.length-suffix-65536,next.length-suffix)))suffix+=65536;
  while(suffix<limit-prefix&&old[old.length-suffix-1]===next[next.length-suffix-1])suffix++;
  const header={baseSha256:hash(old),sha256:hash(next),bytes:next.length};
  const inserted=next.subarray(prefix,next.length-suffix),insertLength=4*Math.ceil(inserted.length/3);
  // Build a large fallback base64 string only when actually selected. Sparse
  // multi-hunk changes otherwise transiently allocate the entire middle span.
  const fallback=()=>({...header,prefix,remove:old.length-prefix-suffix,insert:inserted.toString('base64')});
  if(insertLength<256*1024)return fallback();
  const oldEnd=old.length-suffix,newEnd=next.length-suffix,hunks=[];
  let a=prefix,b=prefix,probes=0;
  while(a<oldEnd||b<newEnd){
    while(a+65536<=oldEnd&&b+65536<=newEnd&&old.subarray(a,a+65536).equals(next.subarray(b,b+65536))){a+=65536;b+=65536;}
    while(a<oldEnd&&b<newEnd&&old[a]===next[b]){a++;b++;}
    if(a===oldEnd&&b===newEnd)break;
    let match=null;
    for(let distance=32768;b+distance+32768<=newEnd;distance*=2){
      if(++probes>64)return fallback();
      const probe=b+distance;
      const position=old.indexOf(next.subarray(probe,probe+32768),a);
      if(position>=a&&position+32768<=oldEnd){match={old:position,next:probe};break;}
    }
    const stopOld=match?.old??oldEnd,stopNew=match?.next??newEnd;
    hunks.push({prefix:a,remove:stopOld-a,data:next.subarray(b,stopNew)});
    if(hunks.length>32)return fallback();
    a=stopOld+(match?32768:0);b=stopNew+(match?32768:0);
  }
  const size=hunks.reduce((sum,hunk)=>sum+4*Math.ceil(hunk.data.length/3),0);
  return size<insertLength/2?{...header,hunks:hunks.map(({prefix,remove,data})=>({prefix,remove,insert:data.toString('base64')}))}:fallback();
}

export const deltaTransportBytes=delta=>delta.hunks?delta.hunks.reduce((sum,hunk)=>sum+hunk.insert.length,0):delta.insert.length;
