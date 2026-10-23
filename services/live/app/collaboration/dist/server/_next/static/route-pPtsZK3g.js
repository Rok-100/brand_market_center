import{n as e,t}from"./mcp-C9l5vAoi.js";var n=`'WIS官方旗舰店','WIS官方旗舰店甄选','WIS官方旗舰店优选'`;function r(e=0){let t=new Date,n=Date.UTC(Number(new Intl.DateTimeFormat(`en-CA`,{timeZone:`Asia/Shanghai`,year:`numeric`}).format(t)),Number(new Intl.DateTimeFormat(`en-CA`,{timeZone:`Asia/Shanghai`,month:`2-digit`}).format(t))-1,Number(new Intl.DateTimeFormat(`en-CA`,{timeZone:`Asia/Shanghai`,day:`2-digit`}).format(t)));return new Date(n+e*864e5).toISOString().slice(0,10)}function i(e,t){let n=r(),i=r(-14);return{date:e&&/^\d{4}-\d{2}-\d{2}$/.test(e)&&e>=i&&e<=n?e:n,minDate:i,maxDate:n,sessionKey:t}}function a(e){let t=e.replace(/'/g,``),r=`shop_name IN (${n}) AND DATE(live_started_at) = '${t}'`;return{sessions:`WITH business_latest AS (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY shop_name, live_room_id ORDER BY snapshot_at DESC, collected_at DESC) AS rn
    FROM d_root_project_marketing_db.buyin_live_business_halfhour_snapshot
    WHERE ${r}
  ), screen_latest AS (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY shop_name, live_room_id ORDER BY snapshot_at DESC, collected_at DESC) AS rn
    FROM d_root_project_marketing_db.buyin_live_screen_halfhour_snapshot
    WHERE ${r}
  )
  SELECT b.shop_name, b.live_room_id, b.live_room_name, b.live_started_at, b.live_duration_seconds,
         b.live_status, b.transaction_amount_fen, b.qianchuan_spend_fen, b.refund_amount_fen,
         b.snapshot_at, b.collected_at, s.cumulative_watch_count, s.watch_to_transaction_rate_percent,
         s.realtime_online_count, s.realtime_audience_json, s.raw_metrics_json
  FROM business_latest b
  LEFT JOIN screen_latest s ON b.shop_name = s.shop_name AND b.live_room_id = s.live_room_id AND s.rn = 1
  WHERE b.rn = 1 ORDER BY b.shop_name, b.live_started_at DESC`,traffic:`WITH ranked AS (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY shop_name, live_room_id, channel_name ORDER BY stat_date DESC, collection_time DESC, collected_at DESC, id DESC) AS rn
    FROM d_root_project_marketing_db.buyin_live_traffic_channel_halfhour_snapshot
    WHERE shop_name IN (${n}) AND DATE(started_at) = '${t}'
  ), grouped AS (
    SELECT shop_name, live_room_id,
      CASE WHEN channel_name = '短视频引流' THEN '短视频' WHEN channel_name = '直播推荐' THEN '直播推荐' ELSE '其他' END AS channel_group,
      traffic_share_percent
    FROM ranked WHERE rn = 1 AND channel_name NOT IN ('推荐feed', '直播广场', '其他推荐场景', '同城')
  )
  SELECT shop_name, live_room_id, channel_group, ROUND(SUM(traffic_share_percent), 1) AS traffic_share_percent
  FROM grouped GROUP BY shop_name, live_room_id, channel_group`,staffing:`SELECT 'anchor' AS role, live_room_name, anchor_name AS name, start_at, end_at
    FROM d_root_project_marketing_db.buyin_live_anchor_schedule
    WHERE is_active = 1 AND CURRENT_TIMESTAMP BETWEEN start_at AND end_at
    UNION ALL
    SELECT 'assistant' AS role, live_room_name, assistant_name AS name, start_at, end_at
    FROM d_root_project_marketing_db.buyin_live_assistant_schedule
    WHERE is_active = 1 AND CURRENT_TIMESTAMP BETWEEN start_at AND end_at
    ORDER BY live_room_name, role`,hourlyTrend:`WITH business_ranked AS (
    SELECT shop_name, live_room_id, DATE_FORMAT(snapshot_at, '%Y-%m-%d %H:00') AS hour_at,
           CASE WHEN DATE(snapshot_at) > DATE(live_started_at) THEN CONCAT('次日 ', DATE_FORMAT(snapshot_at, '%H:00')) ELSE DATE_FORMAT(snapshot_at, '%H:00') END AS hour_label,
           transaction_amount_fen, qianchuan_spend_fen,
           ROW_NUMBER() OVER (PARTITION BY shop_name, live_room_id, DATE_FORMAT(snapshot_at, '%Y-%m-%d %H') ORDER BY snapshot_at DESC, collected_at DESC) AS rn
    FROM d_root_project_marketing_db.buyin_live_business_halfhour_snapshot
    WHERE ${r} AND TIME(live_started_at) BETWEEN '05:00:00' AND '07:00:00'
      AND snapshot_at >= TIMESTAMP(DATE(live_started_at), '05:00:00')
      AND snapshot_at < DATE_ADD(TIMESTAMP(DATE(live_started_at), '06:00:00'), INTERVAL 1 DAY)
  ), business_hourly AS (
    SELECT shop_name, live_room_id, hour_at, hour_label, transaction_amount_fen, qianchuan_spend_fen
    FROM business_ranked WHERE rn = 1
  ), business_delta AS (
    SELECT shop_name, live_room_id, hour_at, hour_label,
           GREATEST(transaction_amount_fen - COALESCE(LAG(transaction_amount_fen) OVER (PARTITION BY shop_name, live_room_id ORDER BY hour_at), 0), 0) AS hourly_gmv_fen,
           GREATEST(qianchuan_spend_fen - COALESCE(LAG(qianchuan_spend_fen) OVER (PARTITION BY shop_name, live_room_id ORDER BY hour_at), 0), 0) AS hourly_cost_fen
    FROM business_hourly
  ), screen_ranked AS (
    SELECT shop_name, live_room_id, DATE_FORMAT(snapshot_at, '%Y-%m-%d %H:00') AS hour_at,
           watch_to_transaction_rate_percent,
           ROW_NUMBER() OVER (PARTITION BY shop_name, live_room_id, DATE_FORMAT(snapshot_at, '%Y-%m-%d %H') ORDER BY snapshot_at DESC, collected_at DESC) AS rn
    FROM d_root_project_marketing_db.buyin_live_screen_halfhour_snapshot
    WHERE ${r} AND TIME(live_started_at) BETWEEN '05:00:00' AND '07:00:00'
      AND snapshot_at >= TIMESTAMP(DATE(live_started_at), '05:00:00')
      AND snapshot_at < DATE_ADD(TIMESTAMP(DATE(live_started_at), '06:00:00'), INTERVAL 1 DAY)
  )
  SELECT b.shop_name, b.live_room_id, b.hour_at, b.hour_label, b.hourly_gmv_fen, b.hourly_cost_fen,
         CASE WHEN b.hourly_cost_fen > 0 THEN ROUND(b.hourly_gmv_fen / b.hourly_cost_fen, 2) ELSE 0 END AS roi,
         COALESCE(s.watch_to_transaction_rate_percent, 0) AS conversion
  FROM business_delta b
  LEFT JOIN screen_ranked s ON s.shop_name = b.shop_name AND s.live_room_id = b.live_room_id AND s.hour_at = b.hour_at AND s.rn = 1
  ORDER BY b.shop_name, b.live_room_id, b.hour_at`,recentSessions:`WITH business_latest AS (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY shop_name, live_room_id ORDER BY snapshot_at DESC, collected_at DESC) AS rn
    FROM d_root_project_marketing_db.buyin_live_business_halfhour_snapshot
    WHERE shop_name IN (${n}) AND DATE(live_started_at) BETWEEN DATE_SUB(CURDATE(), INTERVAL 14 DAY) AND CURDATE()
  ), screen_latest AS (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY shop_name, live_room_id ORDER BY snapshot_at DESC, collected_at DESC) AS rn
    FROM d_root_project_marketing_db.buyin_live_screen_halfhour_snapshot
    WHERE shop_name IN (${n}) AND DATE(live_started_at) BETWEEN DATE_SUB(CURDATE(), INTERVAL 14 DAY) AND CURDATE()
  )
  SELECT b.shop_name, b.live_room_id, b.live_room_name, b.live_started_at, b.live_duration_seconds,
         b.live_status, b.transaction_amount_fen, b.qianchuan_spend_fen, b.refund_amount_fen,
         s.cumulative_watch_count, s.watch_to_transaction_rate_percent, s.realtime_online_count
  FROM business_latest b
  LEFT JOIN screen_latest s ON b.shop_name = s.shop_name AND b.live_room_id = s.live_room_id AND s.rn = 1
  WHERE b.rn = 1 ORDER BY b.live_started_at DESC`,summary:`已为 ${t} 生成场次、每小时趋势、流量、实时人群和当前排班的只读查询`}}var o=`edge`,s=`force-dynamic`,c=0,l=e=>Number(e??0),u=[`WIS官方旗舰店`,`WIS官方旗舰店甄选`,`WIS官方旗舰店优选`],d={WIS官方旗舰店:`官旗`,WIS官方旗舰店甄选:`品牌精选`,WIS官方旗舰店优选:`优选`};function f(e){if(typeof e!=`string`)return{};try{let t=JSON.parse(e);return t&&typeof t==`object`&&!Array.isArray(t)?t:{}}catch{return{}}}function p(e){let t=f(e),n=t.近1分钟看播??t.全场看播;return!n||typeof n!=`object`||Array.isArray(n)?[]:Object.entries(n).map(([e,t])=>({label:e,value:l(t)})).filter(e=>e.value>0).sort((e,t)=>t.value-e.value)}var m={WIS官方旗舰店:{url:`/live-backgrounds/wis-official-latest.jpg?v=20260813-current-visual`,label:`WIS直播战队 · 曾泳淇最新确认背景`,updatedAt:`2026-08-13`},WIS官方旗舰店甄选:{url:`/live-backgrounds/wis-selected-latest.jpg?v=20260813-current-visual`,label:`WIS直播战队 · 梁瑜涵最新确认背景`,updatedAt:`2026-08-13`},WIS官方旗舰店优选:{url:`/live-backgrounds/wis-preferred-latest.jpg?v=20260813-current-visual`,label:`WIS直播战队 · 李爽最新确认背景`,updatedAt:`2026-08-13`}};function h(e,t,n){let r=f(e),i=r.base&&typeof r.base==`object`&&!Array.isArray(r.base)?r.base:{},a=n.includes(`甄选`)?m.WIS官方旗舰店甄选:n.includes(`优选`)?m.WIS官方旗舰店优选:m.WIS官方旗舰店;return{avatarUrl:typeof i.avatar_uri==`string`?i.avatar_uri:``,accountName:typeof i.nickname==`string`?i.nickname:``,title:t,background:a}}async function g(n){let r=new URL(n.url),o=i(r.searchParams.get(`date`),r.searchParams.get(`session`)),s=a(o.date);try{let[n,r,i,a,c]=await Promise.all([t(`execute_sql`,{sql:s.sessions,limit:100}),t(`execute_sql`,{sql:s.traffic,limit:300}),t(`execute_sql`,{sql:s.staffing,limit:100}),t(`execute_sql`,{sql:s.hourlyTrend,limit:500}),t(`execute_sql`,{sql:s.recentSessions,limit:500})]),f=e=>{let t=String(e.live_room_id),n=String(e.shop_name),r=String(e.live_room_name??`未命名直播场次`);return{id:t,key:`${n}|${t}`,shop:n,title:r,startAt:String(e.live_started_at??``),durationSeconds:l(e.live_duration_seconds),status:String(e.live_status??``),gmv:l(e.transaction_amount_fen)/100,cost:l(e.qianchuan_spend_fen)/100,refund:l(e.refund_amount_fen)/100,watchers:l(e.cumulative_watch_count),conversion:l(e.watch_to_transaction_rate_percent),online:l(e.realtime_online_count),audience:p(e.realtime_audience_json),visual:h(e.raw_metrics_json,r,n),observedAt:String(e.collected_at??e.snapshot_at??``)}},m=e(n).map(f),g=e(c).map(f),_=m.some(e=>e.key===o.sessionKey)?o.sessionKey:m[0]?.key??null,v=m.find(e=>e.key===_),y=new Map(e(r).filter(e=>`${String(e.shop_name)}|${String(e.live_room_id)}`===_).map(e=>[String(e.channel_group),l(e.traffic_share_percent)])),b=v?d[v.shop]:``,x=e(i).filter(e=>String(e.live_room_name)===b).map(e=>({role:String(e.role),name:String(e.name),startAt:String(e.start_at),endAt:String(e.end_at)})),S=e(a).filter(e=>`${String(e.shop_name)}|${String(e.live_room_id)}`===_).map(e=>({hour:String(e.hour_label),gmv:l(e.hourly_gmv_fen)/100,roi:l(e.roi),conversion:l(e.conversion)}));return Response.json({date:o.date,minDate:o.minDate,maxDate:o.maxDate,refreshMinutes:60,agent:{name:`直播数据分析代理`,summary:s.summary},shops:u,sessions:m,recentSessions:g,selectedSessionKey:_,traffic:[{label:`短视频`,value:y.get(`短视频`)??0,color:`#d7f15b`},{label:`直播推荐`,value:y.get(`直播推荐`)??0,color:`#17694f`},{label:`其他`,value:y.get(`其他`)??0,color:`#dfe7e2`}],audience:v?.audience??[],trend:S,visual:v?.visual??null,staffing:x,fetchedAt:new Date().toISOString()})}catch(e){return Response.json({error:e instanceof Error?e.message:`数据服务暂不可用`},{status:503})}}export{g as GET,s as dynamic,c as revalidate,o as runtime};