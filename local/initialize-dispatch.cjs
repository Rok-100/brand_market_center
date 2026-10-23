// Establish a clearly synthetic epoch using the original offline initializer.
const fs=require('fs');
if(process.env.LOCAL_SIMULATION!=='1'||process.env.DATA_DIR!=='/app/data')throw new Error('Local sandbox required');
const root='/app/data';
const marker=root+'/LOCAL_SIMULATION.json';
const api=require('/app/schedule-api-server.js');
(async()=>{
  if(fs.existsSync(marker)) {await api.readPlanningEpoch();console.log('Existing local simulation epoch preserved');return;}
  if(fs.existsSync(root+'/planning-baseline-manifest.json'))throw new Error('Unmarked baseline exists; refusing overwrite');
  fs.writeFileSync(marker,JSON.stringify({localSimulation:true,productionHistory:false}),{flag:'wx'});
  fs.writeFileSync(root+'/planning-baseline-manifest.json',JSON.stringify({schemaVersion:1,
    spreadsheetToken:'Wj4zs3oDfhGUfetlTXicxblmnHe',sheetId:'0jFdXf',revision:1,
    checkedAt:new Date().toISOString(),historyStatus:'pending_recovery'}),{flag:'wx'});
  await api.initializePlanningEpoch({confirm:true});
  console.log('Local synthetic baseline and audit epoch initialized');
})().catch(error=>{console.error(error.message);process.exitCode=1});
