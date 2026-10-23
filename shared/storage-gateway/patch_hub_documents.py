"""Replace only storage seams; domain validation, permissions and routes stay intact."""
from pathlib import Path

ROOT=Path('/home/brand-marketing/fandow-apps/fd-026222/releases/data-storage-20261006-v1')
DEST=ROOT/'hub-documents-patch'
DEST.mkdir(exist_ok=True)


def replace_class(source,class_name,replacement):
    start=source.index('export class '+class_name)
    end=source.index('\n}\n',start)+3
    return 'import {createDocumentStore} from "./document_store_mysql.mjs";\n'+source[:start]+replacement+'\n'+source[end:]


workflow='''export class WorkflowStore {
  constructor(file){this.file=file;this.documents=createDocumentStore(file);}
  read(){const snapshot=this.documents.snapshot();return snapshot.exists?normalizeStore(snapshot.data):emptyWorkflow();}
  transaction(mutate){
    const snapshot=this.documents.snapshot();
    const state=snapshot.exists?normalizeStore(snapshot.data):emptyWorkflow();
    const result=mutate(state);
    requireFact(!result?.then,'事务不能包含异步操作',500);
    state.updatedAt=new Date().toISOString();
    try{this.documents.commit(snapshot.version,state);}catch{throw new WorkflowError(503,'任务记录正在处理，请稍后刷新；不要重复提交');}
    return structuredClone(result);
  }
}'''
spark='''export class SparkLibraryStore {
  constructor(root){need(typeof root==='string'&&root.length>0,'必须指定星火库存储目录',500);this.root=resolve(root);this.file=join(this.root,'spark-library.json');this.documents=createDocumentStore(this.file);}
  read(){const snapshot=this.documents.snapshot();return snapshot.exists?normalizeStore(snapshot.data):emptyStore();}
  transaction(fn){
    const snapshot=this.documents.snapshot();
    const state=snapshot.exists?normalizeStore(snapshot.data):emptyStore();
    const result=fn(state);need(!result?.then,'存储事务不能包含异步操作',500);
    if(result?.noWrite)return structuredClone(result.value);
    state.revision++;state.updatedAt=iso();
    need(state.items.length<=10000&&state.sources.length<=30000,'星火库已达到当前容量，请联系维护人',413);
    need(Buffer.byteLength(JSON.stringify(state))<=64*1024*1024,'星火库已达到当前容量',413);
    try{this.documents.commit(snapshot.version,state);}catch{throw new SparkError(503,'星火库正在保存，请刷新读回后再试','SPARK_STORE_BUSY');}
    return structuredClone({...result,revision:state.revision,updatedAt:state.updatedAt});
  }
}'''
for filename,name,replacement in [('workflow-store.mjs','WorkflowStore',workflow),('spark-library.mjs','SparkLibraryStore',spark)]:
    source=(ROOT/'live-source/hub'/filename).read_text()
    (DEST/filename).write_text(replace_class(source,name,replacement))
for filename in ['document_store_mysql.mjs','sync_rpc.mjs','sync_rpc_worker.mjs']:
    (DEST/filename).write_text((ROOT/'src'/filename).read_text())
print('Workflow and spark storage seams prepared')
