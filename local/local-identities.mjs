// Synthetic identities, exclusively for loopback local Compose services.
export const catalog=[['creative-hub','创意来源'],['ai-first-creation','一创创作'],['material-workbench','二创混剪'],['cloud-manager','WIS云管家'],['live-room-management','直播间'],['data-dashboard','经营情况总览'],['workflow-engine','流程引擎'],['data-center','数据中心'],['dispatch-center','调度中心']];
export const profiles={
 admin:{number:'FD-999999',name:'本机测试管理员',modules:catalog.map(([key])=>key),admin:true},
 creator:{number:'FD-999991',name:'本机测试创作者甲',modules:['creative-hub','ai-first-creation'],admin:false},
 creator2:{number:'FD-999992',name:'本机测试创作者乙',modules:['creative-hub','ai-first-creation'],admin:false},
 viewer:{number:'FD-999993',name:'本机测试直播成员',modules:['live-room-management','dispatch-center'],admin:false},
 denied:{number:'FD-999994',name:'本机测试未授权成员',modules:[],admin:false},
};
export function tokenFor(role){return role==='admin'?'local-development-only':'local-simulation-'+role;}
export function sessionFor(role){const p=profiles[role];if(!p)return null;return {
 allowed:true,user:{number:p.number,id:p.number,userId:p.number,realName:p.name,name:p.name,department:'品牌营销部',parentDept:'品牌营销部',center:'本机测试中心',status:'normal'},
 permissions:{super_admin:p.admin,operation_admin:p.admin,manage_permissions:p.admin},
 access:{master_access:p.modules.length>0,access_mode:p.admin?'all':'selected',allowed_modules:p.modules,modules:catalog.filter(([key])=>p.modules.includes(key)).map(([key,label])=>({key,label,purpose:'本机复现测试'}))},localTest:true};}
