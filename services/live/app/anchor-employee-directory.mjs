// Read employee numbers only within the existing live-center contact scope.
export function createAnchorEmployeeDirectory({get,departmentId,canonicalName=name=>String(name||'').trim(),clock=Date.now,cacheMs=10*60000}={}){
  let loaded=null,pending=null;
  async function pages(path,params){
    const items=[],seen=new Set();let page='';
    for(let count=0;count<50;count++){
      const query=new URLSearchParams(params);if(page)query.set('page_token',page);
      const data=await get(path+'?'+query);if(!Array.isArray(data.items))throw Error('通讯录返回格式异常');
      items.push(...data.items);if(!data.has_more)return items;
      page=String(data.page_token||'');if(!page||seen.has(page))throw Error('通讯录分页未完成');seen.add(page);
    }
    throw Error('通讯录读取范围过大，未完成核验');
  }
  async function load(){
    if(loaded&&clock()-loaded.at<cacheMs)return loaded;
    if(pending)return pending;
    pending=(async()=>{
      if(!/^od-[A-Za-z0-9_-]+$/u.test(String(departmentId||'')))throw Error('直播中心部门未配置');
      const children=await pages('/contact/v3/departments/'+encodeURIComponent(departmentId)+'/children',{department_id_type:'open_department_id',fetch_child:'true',page_size:'50'});
      const ids=[...new Set([departmentId,...children.map(x=>x.open_department_id)])];
      if(ids.length>100||ids.some(id=>!/^od-[A-Za-z0-9_-]+$/u.test(String(id||''))))throw Error('通讯录部门范围无法核验');
      const groups=new Map();
      for(const id of ids){
        const users=await pages('/contact/v3/users/find_by_department',{department_id:id,department_id_type:'open_department_id',user_id_type:'open_id',page_size:'50'});
        for(const user of users){
          if(user.status?.is_exited||user.status?.is_resigned)continue;
          const name=canonicalName(user.name),number=String(user.employee_no||'').trim(),openId=String(user.open_id||'');
          if(!name||!openId)continue;
          if(!groups.has(name))groups.set(name,new Map());
          groups.get(name).set(openId,{employeeNumber:/^[A-Za-z0-9._-]{1,64}$/u.test(number)?number:'',directoryName:String(user.name||'')});
        }
      }
      loaded={at:clock(),groups};return loaded;
    })();
    try{return await pending;}finally{pending=null;}
  }
  return async names=>{
    const snapshot=await load(),byName={};
    for(const name of new Set(names)){
      const group=snapshot.groups.get(canonicalName(name));
      if(group?.size===1){const person=group.values().next().value;byName[name]={...person,status:person.employeeNumber?'verified':'missing'};}
      else byName[name]={employeeNumber:'',status:group?.size>1?'ambiguous':'missing'};
    }
    return {byName,fetchedAt:new Date(snapshot.at).toISOString(),source:'feishu_live_center_directory'};
  };
}
