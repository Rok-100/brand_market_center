import {safeUrl} from './daily-intelligence.mjs';
const metric=v=>v?.display??v?.raw??v?.value??null;
const text=v=>v===null||v===undefined||v===''?'未提供':String(v);
const escape=v=>String(v??'').replace(/[&<>*~_\[\]`#()]/g,ch=>`&#${ch.charCodeAt(0)};`);
const encodedUrl=url=>url.replace(/[\s<>()\[\]"'\\]/g,ch=>[...Buffer.from(ch)].map(n=>'%'+n.toString(16).toUpperCase().padStart(2,'0')).join(''));
export function competitorChart(board){
  const creators=board.key==='live_creators',today=board.key==='today_sales';
  const values=[...board.items].sort((a,b)=>a.rank-b.rank).map(b=>{
    const name=String(b.entityName||b.name),creator=b.creatorName||b.raw?.creator_name||'未提供';
    const rise=b.isNewEntry?30-b.rank:b.rankChange;
    const sales=text(b.salesAmount),count=text(b.salesCount),average=text(b.averagePrice??metric(b.raw?.metrics?.average_price));
    const short=[...name].length>14?[...name].slice(0,14).join('')+'…':name;
    return {'排名':String(b.rank),'排名与名称':`${b.rank}  ${short}`,'排名上升数':rise,'名称':name,'入选类型':b.isNewEntry?'新上榜':'原榜上升',
      '昨日排名':b.isNewEntry?'未上榜':String(b.previousRank),'达人':creator,'销售额':sales,'销量':count,'销售客单价':average,'标签名称':short+(b.isNewEntry?' · 新':''),
    };
  });
  return {tag:'chart',height:Math.min(999,Math.max(280,values.length*40+140))+'px',preview:true,
    chart_spec:{type:'bar',direction:'horizontal',data:{values},xField:'排名上升数',yField:'排名与名称',seriesField:'入选类型',
      color:['#C4D9F6','#BDE8DB'],bar:{style:{cornerRadius:3}},
      axes:[{orient:'bottom',min:0,max:32,title:{visible:true,text:'排名上升数'}},{orient:'left',type:'band',title:{visible:false},label:{autoHide:false,style:{fontSize:11}}}],
      crosshair:{xField:{visible:false,label:{visible:false}},yField:{visible:false,label:{visible:false}}},
      legends:{visible:true,orient:'bottom'},
      label:{visible:true,position:'outside',overlap:false,smartInvert:false,formatter:'+{排名上升数}',style:{fontSize:12,fill:'#205AA3'}},
      tooltip:{trigger:'hover',activeType:['mark'],mark:{title:{valueFormatter:'{名称}'},content:[
        {key:'当前排名',valueFormatter:'第 {排名} 名'},{key:'上升位数',valueFormatter:'{排名上升数}'},{key:'昨日排名',valueFormatter:'{昨日排名}'},
        ...(today?[{key:'达人',valueFormatter:'{达人}'}]:[]),
        {key:creators?'直播销售额':'销售额',valueFormatter:'{销售额}'},{key:creators?'直播销量':'销量',valueFormatter:'{销量}'},
        ...(creators?[{key:'销售客单价',valueFormatter:'{销售客单价}'}]:[]),
      ]}},
    }};
}
export function competitorLinkTable(board){
  const creators=board.key==='live_creators',today=board.key==='today_sales';
  return {tag:'table',page_size:10,row_height:'auto',header_style:{bold:true,background_style:'grey'},columns:[
    {name:'rank',display_name:'排名',data_type:'number',width:'80px'},
    {name:'name',display_name:'品牌/达人',data_type:'lark_md',width:'auto'},
    ...(today?[{name:'creator',display_name:'达人',data_type:'text',width:'auto'}]:[]),
    {name:'sales',display_name:creators?'直播销售额':'销售额',data_type:'text',width:'120px'},
    {name:'count',display_name:creators?'直播销量':'销量',data_type:'text',width:'100px'},
    ...(creators?[{name:'average',display_name:'销售客单价',data_type:'text',width:'110px'}]:[]),
  ],rows:[...board.items].sort((a,b)=>a.rank-b.rank).map(b=>{
    const name=escape(b.entityName||b.name),url=safeUrl(b.detailUrl);
    return {rank:b.rank,name:url?`[${name}](${encodedUrl(url)})`:name,sales:text(b.salesAmount),count:text(b.salesCount),...(today?{creator:b.creatorName||b.raw?.creator_name||'未提供'}:{}),...(creators?{average:text(b.averagePrice??metric(b.raw?.metrics?.average_price))}:{})};
  })};
}
