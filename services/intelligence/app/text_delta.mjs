import {createHash} from 'node:crypto';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

// Compare bytes so a shared prefix inside a UTF-8 character remains exact.
export function textDelta(before,after) {
  const old=Buffer.from(before),next=Buffer.from(after),limit=Math.min(old.length,next.length);
  let prefix=0,suffix=0;
  while(prefix+65536<=limit&&old.subarray(prefix,prefix+65536).equals(next.subarray(prefix,prefix+65536)))prefix+=65536;
  while(prefix<limit&&old[prefix]===next[prefix])prefix++;
  while(suffix+65536<=limit-prefix&&old.subarray(old.length-suffix-65536,old.length-suffix).equals(next.subarray(next.length-suffix-65536,next.length-suffix)))suffix+=65536;
  while(suffix<limit-prefix&&old[old.length-suffix-1]===next[next.length-suffix-1])suffix++;
  const delta={baseSha256:hash(old),sha256:hash(next),prefix,remove:old.length-prefix-suffix,
    insert:next.subarray(prefix,next.length-suffix).toString('base64'),bytes:next.length};
  if(delta.insert.length<256*1024)return delta;
  const oldEnd=old.length-suffix,newEnd=next.length-suffix,hunks=[];
  let a=prefix,b=prefix;
  while(a<oldEnd||b<newEnd){
    while(a+65536<=oldEnd&&b+65536<=newEnd&&old.subarray(a,a+65536).equals(next.subarray(b,b+65536))){a+=65536;b+=65536;}
    while(a<oldEnd&&b<newEnd&&old[a]===next[b]){a++;b++;}
    if(a===oldEnd&&b===newEnd)break;
    let match=null;
    for(let probe=b+32768;probe+32768<=newEnd;probe+=32768){
      const position=old.indexOf(next.subarray(probe,probe+32768),a);
      if(position>=a&&position+32768<=oldEnd){match={old:position,next:probe};break;}
    }
    const stopOld=match?.old??oldEnd,stopNew=match?.next??newEnd;
    hunks.push({prefix:a,remove:stopOld-a,insert:next.subarray(b,stopNew).toString('base64')});
    if(hunks.length>32)return delta;
    a=stopOld+(match?32768:0);b=stopNew+(match?32768:0);
  }
  const size=hunks.reduce((sum,hunk)=>sum+hunk.insert.length,0);
  return size<delta.insert.length/2?{baseSha256:delta.baseSha256,sha256:delta.sha256,bytes:delta.bytes,hunks}:delta;
}

export const deltaTransportBytes=delta=>delta.hunks?delta.hunks.reduce((sum,hunk)=>sum+hunk.insert.length,0):delta.insert.length;
