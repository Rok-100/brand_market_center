import {createSyncRpc} from './sync_rpc.mjs';

export function createDocumentStore(file) {
  const rpc=createSyncRpc(process.env.PINYING_DOCUMENT_CONFIG_FILE||'/run/secrets/pinying-documents.json','documents');
  return {
    snapshot(){return rpc.call('read',[file]);},
    commit(version,data){return rpc.call('commit',[file,version,data]);},
    close(){rpc.close();},
  };
}
