"""Read workflow projections from the authoritative MySQL snapshot."""
from pathlib import Path

root=Path('/home/brand-marketing/fandow-apps/fd-026222/releases/data-storage-20261006-v1')
source=(root/'live-source/hub/flow-sources.mjs').read_text()
start=source.index('export function createCloudReader(file){')
end=source.index('// Preserve the existing one-shot API',start)
replacement='''export function createCloudReader(_file){
 const rpc=createSyncRpc(process.env.PINYING_CLOUD_READ_CONFIG_FILE||'/run/secrets/pinying-cloud-read.json','sql');
 function read(){
  const queries=[];
  projectCloud({prepare:sql=>({all:()=>{queries.push({sql,params:[]});return [];}})});
  const results=rpc.call(queries);let offset=0;
  const data=projectCloud({prepare:()=>({all:()=>results[offset++].results})});
  return {state:'connected',checkedAt:iso(),...data};
 }
 return {read,close:()=>rpc.close()};
}
'''
source='import {createSyncRpc} from "./sync_rpc.mjs";\n'+source[:start]+replacement+source[end:]
(root/'hub-documents-patch/flow-sources.mjs').write_text(source)
for filename in ['sync_rpc.mjs','sync_rpc_worker.mjs']:
    (root/'hub-documents-patch'/filename).write_text((root/'src'/filename).read_text())
print('Workflow source projection now uses a read-only MySQL transaction')
