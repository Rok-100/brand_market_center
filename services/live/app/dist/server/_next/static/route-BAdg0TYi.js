import{n as e,t}from"./central-auth-B5qDOiXr.js";import{n,r,t as i}from"./mcp-BxVxD0av.js";import{r as a}from"./coco-B62cG4eM.js";import{n as o}from"./feishu-dashboard-fallback-DfKc0FvD.js";var s=`'WIS官方旗舰店','WIS官方旗舰店甄选','WIS官方旗舰店优选','WIS燕窝面膜护肤店'`;function c(e=0){let t=new Date,n=Date.UTC(Number(new Intl.DateTimeFormat(`en-CA`,{timeZone:`Asia/Shanghai`,year:`numeric`}).format(t)),Number(new Intl.DateTimeFormat(`en-CA`,{timeZone:`Asia/Shanghai`,month:`2-digit`}).format(t))-1,Number(new Intl.DateTimeFormat(`en-CA`,{timeZone:`Asia/Shanghai`,day:`2-digit`}).format(t)));return new Date(n+e*864e5).toISOString().slice(0,10)}function l(e,t){let n=c(),r=c(-14);return{date:e&&/^\d{4}-\d{2}-\d{2}$/.test(e)&&e>=r&&e<=n?e:n,minDate:r,maxDate:n,sessionKey:t}}function u(e){let t=e.replace(/'/g,``),n=`shop_name IN (${s}) AND DATE(live_started_at) = '${t}'`;return{sessions:`WITH business_latest AS (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY shop_name, live_room_id ORDER BY snapshot_at DESC, collected_at DESC) AS rn
    FROM d_root_project_marketing_db.buyin_live_business_halfhour_snapshot
    WHERE ${n}
  ), screen_latest AS (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY shop_name, live_room_id ORDER BY snapshot_at DESC, collected_at DESC) AS rn
    FROM d_root_project_marketing_db.buyin_live_screen_halfhour_snapshot
    WHERE ${n}
  )
  SELECT b.shop_name, b.live_room_id, b.live_room_name, b.live_started_at, b.live_duration_seconds,
         b.live_status, b.transaction_amount_fen, b.qianchuan_spend_fen, b.refund_amount_fen,
         b.snapshot_at, b.collected_at, s.cumulative_watch_count, s.watch_to_transaction_rate_percent,
         s.realtime_online_count, s.realtime_audience_json, s.raw_metrics_json
  FROM business_latest b
  LEFT JOIN screen_latest s ON b.shop_name = s.shop_name AND b.live_room_id = s.live_room_id AND s.rn = 1
  WHERE b.rn = 1 ORDER BY b.shop_name, b.live_started_at DESC`,traffic:`WITH compass_ranked AS (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY shop_name, live_room_id, channel_path ORDER BY snapshot_at DESC, collected_at DESC) AS rn
    FROM d_root_project_marketing_db.douyin_compass_live_flow_channel_half_hourly_snapshot
    WHERE shop_name IN (${s}) AND DATE(live_started_at) = '${t}' AND channel_level = 1
  ), compass_grouped AS (
    SELECT shop_name, live_room_id,
      CASE
        WHEN traffic_type = 'paid' OR channel_name REGEXP '付费|广告|千川' THEN '付费推广'
        WHEN channel_name REGEXP '短视频' THEN '短视频引流'
        WHEN channel_name REGEXP '关注|粉丝' THEN '粉丝关注'
        WHEN channel_name REGEXP '同城' THEN '同城'
        WHEN channel_name REGEXP '分享|私域|转发' THEN '分享/私域'
        WHEN channel_name REGEXP '直播推荐|自然|推荐|直播广场' THEN '自然推荐'
        ELSE '其他'
      END AS channel_group,
      ROUND(SUM(traffic_ratio) * 100, 1) AS traffic_share_percent,
      ROUND(SUM(user_pay_amount_yuan), 2) AS transaction_amount_yuan,
      ROUND(SUM(user_pay_amount_ratio) * 100, 1) AS transaction_share_percent,
      ROUND(MAX(pay_gpm_yuan), 2) AS pay_gpm_yuan
    FROM compass_ranked WHERE rn = 1
    GROUP BY shop_name, live_room_id, channel_group
  ), legacy_ranked AS (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY shop_name, live_room_id, channel_path ORDER BY stat_date DESC, collection_time DESC, collected_at DESC, id DESC) AS rn
    FROM d_root_project_marketing_db.buyin_live_traffic_channel_halfhour_snapshot
    WHERE shop_name IN (${s}) AND DATE(started_at) = '${t}'
      AND channel_path NOT LIKE '%>%' 
  ), legacy_grouped AS (
    SELECT shop_name, live_room_id,
      CASE
        WHEN channel_name REGEXP '付费|广告|千川' THEN '付费推广'
        WHEN channel_name REGEXP '短视频' THEN '短视频引流'
        WHEN channel_name REGEXP '关注|粉丝' THEN '粉丝关注'
        WHEN channel_name REGEXP '同城' THEN '同城'
        WHEN channel_name REGEXP '分享|私域|转发' THEN '分享/私域'
        WHEN channel_name REGEXP '直播推荐|自然|推荐|直播广场' THEN '自然推荐'
        ELSE '其他'
      END AS channel_group,
      traffic_share_percent,
      transaction_amount_share_percent AS transaction_share_percent,
      channel_gpm_yuan AS pay_gpm_yuan
    FROM legacy_ranked WHERE rn = 1
  )
  SELECT shop_name, live_room_id, channel_group, traffic_share_percent,
         transaction_amount_yuan, transaction_share_percent, pay_gpm_yuan
  FROM compass_grouped
  UNION ALL
  SELECT shop_name, live_room_id, channel_group, ROUND(SUM(traffic_share_percent), 1), NULL,
         ROUND(SUM(transaction_share_percent), 1), ROUND(MAX(pay_gpm_yuan), 2)
  FROM legacy_grouped legacy
  WHERE NOT EXISTS (
    SELECT 1 FROM compass_grouped compass
    WHERE compass.shop_name = legacy.shop_name AND compass.live_room_id = legacy.live_room_id
  )
  GROUP BY shop_name, live_room_id, channel_group`,staffing:`SELECT 'anchor' AS role, live_room_name, anchor_name AS name, start_at, end_at
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
    WHERE ${n} AND TIME(live_started_at) BETWEEN '05:00:00' AND '07:00:00'
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
    WHERE ${n} AND TIME(live_started_at) BETWEEN '05:00:00' AND '07:00:00'
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
    WHERE shop_name IN (${s}) AND DATE(live_started_at) BETWEEN DATE_SUB(CURDATE(), INTERVAL 14 DAY) AND CURDATE()
  ), screen_latest AS (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY shop_name, live_room_id ORDER BY snapshot_at DESC, collected_at DESC) AS rn
    FROM d_root_project_marketing_db.buyin_live_screen_halfhour_snapshot
    WHERE shop_name IN (${s}) AND DATE(live_started_at) BETWEEN DATE_SUB(CURDATE(), INTERVAL 14 DAY) AND CURDATE()
  )
  SELECT b.shop_name, b.live_room_id, b.live_room_name, b.live_started_at, b.live_duration_seconds,
         b.live_status, b.transaction_amount_fen, b.qianchuan_spend_fen, b.refund_amount_fen,
         s.cumulative_watch_count, s.watch_to_transaction_rate_percent, s.realtime_online_count,
         s.realtime_audience_json, s.raw_metrics_json, s.snapshot_at, s.collected_at
  FROM business_latest b
  LEFT JOIN screen_latest s ON b.shop_name = s.shop_name AND b.live_room_id = s.live_room_id AND s.rn = 1
  WHERE b.rn = 1 ORDER BY b.live_started_at DESC`,audienceSnapshots:`WITH douyin_ranked AS (
    SELECT shop_name, realtime_online_count, realtime_audience_json, raw_metrics_json, snapshot_at, collected_at,
           ROW_NUMBER() OVER (PARTITION BY shop_name ORDER BY snapshot_at DESC, collected_at DESC) AS rn
    FROM d_root_project_marketing_db.buyin_live_screen_halfhour_snapshot
    WHERE shop_name IN (${s})
      AND DATE(snapshot_at) BETWEEN DATE_SUB('${t}', INTERVAL 14 DAY) AND '${t}'
      AND realtime_audience_json IS NOT NULL
      AND TRIM(CAST(realtime_audience_json AS CHAR)) NOT IN ('', '{}', '[]', 'null')
  ), wechat_ranked AS (
    SELECT 'WIS燕窝面膜护肤店' AS shop_name, audience_count AS realtime_online_count,
           audience_group_distribution_json AS realtime_audience_json,
           JSON_OBJECT('base', JSON_OBJECT('nickname', finder_account_name)) AS raw_metrics_json,
           TIMESTAMP(stat_date, collection_time) AS snapshot_at, updated_at AS collected_at,
           ROW_NUMBER() OVER (PARTITION BY finder_account_name ORDER BY stat_date DESC, collection_time DESC, updated_at DESC) AS rn
    FROM d_root_project_marketing_db.wechat_channels_live_dashboard_audience_half_hourly
    WHERE finder_account_name = 'WIS燕窝面膜护肤店'
      AND audience_scope = 'REALTIME_VIEWER'
      AND stat_date BETWEEN DATE_SUB('${t}', INTERVAL 14 DAY) AND '${t}'
      AND audience_group_distribution_json IS NOT NULL
      AND TRIM(CAST(audience_group_distribution_json AS CHAR)) NOT IN ('', '{}', '[]', 'null')
  )
  SELECT shop_name, realtime_online_count, realtime_audience_json, raw_metrics_json, snapshot_at, collected_at
  FROM douyin_ranked WHERE rn = 1
  UNION ALL
  SELECT shop_name, realtime_online_count, realtime_audience_json, raw_metrics_json, snapshot_at, collected_at
  FROM wechat_ranked WHERE rn = 1`,buyerAudience:`WITH douyin_ranked AS (
    SELECT shop_name, 'FULL_SESSION_BUYER' AS audience_scope, gender_distribution, age_distribution,
           report_date AS observed_at, collected_at,
           ROW_NUMBER() OVER (PARTITION BY shop_name ORDER BY report_date DESC, collected_at DESC) AS rn
    FROM d_root_project_mid_db_brandmarketing.douyin_compass_audience_insight_daily
    WHERE shop_name IN (${s}) AND user_scope = 'pay' AND report_date <= '${t}'
  ), wechat_ranked AS (
    SELECT 'WIS燕窝面膜护肤店' AS shop_name, audience_scope,
           gender_distribution_json AS gender_distribution,
           age_distribution_json AS age_distribution,
           stat_date AS observed_at, updated_at AS collected_at,
           ROW_NUMBER() OVER (PARTITION BY audience_scope ORDER BY stat_date DESC, collection_time DESC, updated_at DESC) AS rn
    FROM d_root_project_mid_db_brandmarketing.wechat_channels_live_dashboard_audience_half_hourly
    WHERE finder_account_name IN ('WIS燕窝面膜护肤店','WIS护肤号')
      AND audience_scope IN ('REALTIME_VIEWER','FULL_SESSION_BUYER')
      AND stat_date <= '${t}'
  )
  SELECT shop_name, audience_scope, gender_distribution, age_distribution, observed_at, collected_at
  FROM douyin_ranked WHERE rn = 1
  UNION ALL
  SELECT shop_name, audience_scope, gender_distribution, age_distribution, observed_at, collected_at
  FROM wechat_ranked WHERE rn = 1`,summary:`已为 ${t} 生成场次、每小时趋势、流量与成交、人群画像和排班的只读查询`}}var d=[{id:`7673636496284470067`,key:`WIS官方旗舰店|7673636496284470067`,shop:`WIS官方旗舰店`,title:`七夕专属好礼，拍一到手42件！`,startAt:`2026-08-14 05:50:00`,durationSeconds:27605,status:`live`,gmv:205276.73,cost:90166.43,refund:24171.05,watchers:20310,conversion:6.002,online:62},{id:`7673633859984018210`,key:`WIS官方旗舰店甄选|7673633859984018210`,shop:`WIS官方旗舰店甄选`,title:`WIS七夕宠粉专场，给自己的浪漫礼遇！`,startAt:`2026-08-14 05:40:00`,durationSeconds:28187,status:`live`,gmv:37481.81,cost:18142.09,refund:3589.39,watchers:7511,conversion:5.3921,online:27},{id:`7673654707545541430`,key:`WIS官方旗舰店优选|7673654707545541430`,shop:`WIS官方旗舰店优选`,title:`紧！亮！弹！WIS深海精华次抛重磅上新，焕亮紧致相约七夕！`,startAt:`2026-08-14 07:00:00`,durationSeconds:23382,status:`live`,gmv:6513.83,cost:4283.53,refund:589.55,watchers:1369,conversion:5.3324,online:7}],f={"WIS官方旗舰店|7673636496284470067":[{label:`短视频`,value:25.66,color:`#d7f15b`},{label:`直播推荐`,value:27.07,color:`#17694f`},{label:`其他`,value:47.27,color:`#dfe7e2`}],"WIS官方旗舰店甄选|7673633859984018210":[{label:`短视频`,value:14.5,color:`#d7f15b`},{label:`直播推荐`,value:31.24,color:`#17694f`},{label:`其他`,value:54.26,color:`#dfe7e2`}],"WIS官方旗舰店优选|7673654707545541430":[{label:`短视频`,value:21.78,color:`#d7f15b`},{label:`直播推荐`,value:17.42,color:`#17694f`},{label:`其他`,value:60.8,color:`#dfe7e2`}]},p=[[`Z世代`,3.22],[`小镇青年`,12.86],[`新锐白领`,8.76],[`精致妈妈`,9.45],[`资深中产`,15.27],[`都市蓝领`,9.99],[`都市银发`,21.9],[`小镇中老年`,18.55]].map(([e,t])=>({label:String(e),value:Number(t)})),m={"WIS官方旗舰店|7673636496284470067":[[`06:00`,11716.59,3.53],[`07:00`,25654.49,2.78],[`08:00`,30639.46,2.45],[`09:00`,46330.67,2.41],[`10:00`,33873.24,2.21],[`11:00`,17855.95,2.13],[`12:00`,17503.55,2.15],[`13:00`,18572.76,2.65]].map(([e,t,n])=>({hour:String(e),gmv:Number(t),roi:Number(n),conversion:6.002})),"WIS官方旗舰店甄选|7673633859984018210":[[`06:00`,1500.83,2.05],[`07:00`,2265.25,1.7],[`08:00`,3594.08,2.01],[`09:00`,5436.19,1.8],[`10:00`,7104.38,1.87],[`11:00`,7252.72,1.86],[`12:00`,4635.53,2.13],[`13:00`,5687.08,2.63]].map(([e,t,n])=>({hour:String(e),gmv:Number(t),roi:Number(n),conversion:5.3921})),"WIS官方旗舰店优选|7673654707545541430":[[`07:00`,183.15,.72],[`08:00`,836.39,1.27],[`09:00`,660.25,1.77],[`10:00`,736.76,1.23],[`11:00`,1058.43,2.43],[`12:00`,1139.15,2.49],[`13:00`,1897.35,1.74]].map(([e,t,n])=>({hour:String(e),gmv:Number(t),roi:Number(n),conversion:5.3324}))},h={"WIS官方旗舰店|7673636496284470067":[{role:`anchor`,name:`何嘉慧`,startAt:`2026-08-14 13:00:00`,endAt:`2026-08-14 16:00:00`},{role:`assistant`,name:`蒙万叶`,startAt:`2026-08-14 10:10:00`,endAt:`2026-08-14 15:00:00`}]};function g(e){let t=d.some(t=>t.key===e)?e:d[0].key,n=d.find(e=>e.key===t);return{date:`2026-08-14`,minDate:`2026-07-31`,maxDate:`2026-08-14`,refreshMinutes:60,agent:{name:`直播数据快照`,summary:`由已授权数据 MCP 在 2026-08-14 13:30（北京时间）生成的只读快照。`},shops:[`WIS官方旗舰店`,`WIS官方旗舰店甄选`,`WIS官方旗舰店优选`,`WIS燕窝面膜护肤店`],sessions:d,recentSessions:d,selectedSessionKey:t,traffic:f[t]??[],audience:n.shop===`WIS官方旗舰店`?p:[],trend:m[t]??[],staffing:h[t]??[],visual:{avatarUrl:``,accountName:n.shop,title:n.title,background:null},fetchedAt:`2026-08-14T13:30:03+08:00`}}function _(e){if(typeof e==`string`){let t=e.trim();if(!t||!t.startsWith(`{`)&&!t.startsWith(`[`))return e;try{return _(JSON.parse(t))}catch{return e}}return Array.isArray(e)?e.map(_):e&&typeof e==`object`?Object.fromEntries(Object.entries(e).map(([e,t])=>[e,_(t)])):e}function v(e){let t=_(e),n=t&&typeof t==`object`&&!Array.isArray(t)?t:{},r=e=>{let t=_(e);if(!t||typeof t!=`object`)return null;if(Array.isArray(t)){for(let e of t){let t=r(e);if(t)return t}return null}let n=t;for(let[e,t]of Object.entries(n))if(/(?:近.?分钟|全场).*看播|实时.*人群|人群.*分布/.test(e)&&t&&typeof t==`object`)return t;for(let e of Object.values(n)){let t=r(e);if(t)return t}return null},i=e=>{if(e&&typeof e==`object`&&!Array.isArray(e)){let t=e;return i(t.percent??t.percentage??t.share??t.ratio??t.value)}let t=String(e??``).trim(),n=Number(t.replace(/[%％,]/g,``));return Number.isFinite(n)?/[%％]/.test(t)||n>1?n:n*100:0},a=Array.isArray(t)?t:r(t)??n.近1分钟看播??n.全场看播;return(Array.isArray(a)?a.map(e=>{let t=e&&typeof e==`object`?e:{};return[String(t.label??t.name??t.audience_name??t.key??`人群`),t]}):a&&typeof a==`object`?Object.entries(a):[]).map(([e,t])=>({label:e,value:i(t)})).filter(e=>e.value>0).sort((e,t)=>t.value-e.value)}function y(e,t){let n=_(e);if(!n||typeof n!=`object`||Array.isArray(n))return[];let r=n,i=String(r.单位??``).includes(`%`),a=(t===`FULL_SESSION_VIEWER`?[`全场看播`,`全场看播用户`]:[`全场购买`,`全场购买用户`]).map(e=>r[e]).find(e=>e&&typeof e==`object`);return!a||Array.isArray(a)?[]:Object.entries(a).map(([e,t])=>{let n=String(t??``).trim(),r=Number(n.replace(/[%％,]/g,``));return{label:e,value:Number.isFinite(r)?i||/[％%]/.test(n)||r>1?r:r*100:NaN}}).filter(e=>Number.isFinite(e.value)&&e.value>=0)}var b=`edge`,x=`force-dynamic`,S=0,C=e=>{if(e==null||String(e).trim()===``)return null;let t=Number(e);return Number.isFinite(t)?t:null},w=e=>{let t=C(e);return t===null?null:t/100},T=[`WIS官方旗舰店`,`WIS官方旗舰店甄选`,`WIS官方旗舰店优选`,`WIS燕窝面膜护肤店`],E={WIS官方旗舰店:`官旗`,WIS官方旗舰店甄选:`品牌精选`,WIS官方旗舰店优选:`优选`,WIS燕窝面膜护肤店:`王鸥美肤`},ee={WIS官方旗舰店:`抖音`,WIS官方旗舰店甄选:`抖音`,WIS官方旗舰店优选:`抖音`,WIS燕窝面膜护肤店:`视频号`};function D(e){if(typeof e==`string`){let t=e.trim();if(!t||!t.startsWith(`{`)&&!t.startsWith(`[`))return e;try{return D(JSON.parse(t))}catch{return e}}return Array.isArray(e)?e.map(D):e&&typeof e==`object`?Object.fromEntries(Object.entries(e).map(([e,t])=>[e,D(t)])):e}function O(e){let t=D(e);return t&&typeof t==`object`&&!Array.isArray(t)?t:{}}function k(e){let t=O(e),n=t.base&&typeof t.base==`object`&&!Array.isArray(t.base)?t.base:{};return{avatarUrl:typeof n.avatar_uri==`string`?n.avatar_uri:``,accountName:typeof n.nickname==`string`?n.nickname:``}}async function A(e,t,n){if(!n)return{items:[],error:`未选择直播间`};try{let r={Accept:`application/json`},i=e.headers.get(`cookie`),a=e.headers.get(`x-oa-token`);i&&(r.Cookie=i),a&&(r[`X-OA-Token`]=a);let o=await fetch(`https://app.fandow.top/fd-027340/dispatch-center/api/schedule?date=${encodeURIComponent(t)}`,{headers:r,cache:`no-store`,redirect:`manual`,signal:AbortSignal.timeout(15e3)});if(!o.ok)throw Error(`调度中心返回 ${o.status}`);let s=await o.json(),c=(s.rooms??[]).find(e=>e.name===n),l=(e,n)=>{let r=Array.isArray(n)?n:[];return r.length<3||!r[2]?null:{role:e,name:String(r[2]),startAt:`${t}T${String(r[0]??``).padStart(5,`0`)}:00+08:00`,endAt:`${t}T${String(r[1]??``).padStart(5,`0`)}:00+08:00`}};return{items:[...(c?.anchors??[]).map(e=>l(`anchor`,e)),...(c?.assistants??[]).map(e=>l(`assistant`,e))].filter(e=>!!e),error:``,updatedAt:s.updatedAt??null}}catch(e){return{items:[],error:e instanceof Error?e.message:`调度中心读取失败`,updatedAt:null}}}async function j(s){let c=await e(s);if(!c.ok)return t(c);let d=new URL(s.url),f=l(d.searchParams.get(`date`),d.searchParams.get(`session`));if(process.env.DATA_SOURCE===`snapshot`)return Response.json(g(f.sessionKey));let p=u(f.date);try{let e=[[`sessions`,p.sessions,100],[`traffic`,p.traffic,300],[`staffing`,p.staffing,100],[`hourlyTrend`,p.hourlyTrend,500],[`recentSessions`,p.recentSessions,500],[`audience`,p.audienceSnapshots,20],[`buyerAudience`,p.buyerAudience,20]],t=await Promise.allSettled(e.map(([,e,t])=>i(`execute_sql`,{sql:e,limit:t}))),c=Object.fromEntries(e.map(([e],n)=>[e,t[n].status===`fulfilled`?t[n].value:{}])),l=Object.fromEntries(e.flatMap(([e],n)=>t[n].status===`rejected`?[[e,t[n].reason instanceof Error?t[n].reason.message:`MCP 数据读取失败`]]:[])),u=c.sessions??{},d=c.traffic??{},m=c.staffing??{},h=c.hourlyTrend??{},g=c.recentSessions??{},_=c.audience??{},b=c.buyerAudience??{},x=e=>{let t=String(e.live_room_id),n=String(e.shop_name),r=String(e.live_room_name??`未命名直播场次`);return{id:t,key:`${n}|${t}`,shop:n,title:r,startAt:String(e.live_started_at??``),durationSeconds:C(e.live_duration_seconds),status:String(e.live_status??``),gmv:w(e.transaction_amount_fen),cost:w(e.qianchuan_spend_fen),refund:w(e.refund_amount_fen),watchers:C(e.cumulative_watch_count),conversion:C(e.watch_to_transaction_rate_percent),online:C(e.realtime_online_count),audience:v(e.realtime_audience_json),account:k(e.raw_metrics_json),platform:ee[n]??`未知渠道`,observedAt:String(e.collected_at??e.snapshot_at??``)}},S=n(u).map(x),D=n(g).map(x),O=new Set(S.map(e=>e.key)),j=new Set(S.map(e=>e.shop)),M=new Set(D.map(e=>e.shop+`|`+e.startAt.slice(0,10))),N=l.sessions||T.some(e=>!j.has(e))?await o(f.date).catch(e=>(l.feishu=e instanceof Error?e.message:`飞书经营根表暂不可用`,null)):null;N&&(S=[...S,...N.sessions.filter(e=>!j.has(e.shop))],D=[...D,...N.recentSessions.filter(e=>!M.has(e.shop+`|`+e.startAt.slice(0,10)))]);let P=n(_),F=new Map(P.map(e=>[String(e.shop_name),{audience:v(e.realtime_audience_json),online:C(e.realtime_online_count),account:k(e.raw_metrics_json),observedAt:String(e.collected_at??e.snapshot_at??``)}])),I=e=>{let t=F.get(e.shop);return t?{...e,audience:e.audience.length?e.audience:t.audience,online:e.online??t.online,account:e.account.avatarUrl?e.account:t.account,observedAt:e.observedAt||t.observedAt}:e};S=S.map(I),D=D.map(I);let L=new Map;[...S,...D].forEach(e=>{(!L.has(e.shop)||e.account.avatarUrl)&&L.set(e.shop,e.account)});let R=new Map(await Promise.all(T.map(async e=>[e,await a(e,`当前直播间视觉`,L.get(e)??{avatarUrl:``,accountName:e})]))),z=e=>({...e,visual:R.get(e.shop)??{...e.account,title:e.title,background:null}}),B=S.map(z),V=D.map(z).sort((e,t)=>t.startAt.replace(`T`,` `).localeCompare(e.startAt.replace(`T`,` `))),H=new Date().toISOString(),U=new Set([`小镇青年`,`都市银发`,`小镇中老年`,`都市蓝领`,`资深中产`,`新锐白领`,`精致妈妈`,`Z世代`]),W=P.flatMap(e=>{let t=String(e.collected_at??e.snapshot_at??``),n=e.realtime_audience_json;return[{scope:`FULL_SESSION_VIEWER`,label:`全场看播用户`,items:y(n,`FULL_SESSION_VIEWER`)},{scope:`FULL_SESSION_BUYER`,label:`全场购买用户`,items:y(n,`FULL_SESSION_BUYER`)}].map(n=>({...n,shop:String(e.shop_name),observedAt:t}))}).filter(e=>e.items.some(e=>U.has(e.label))),G=n(b).map(e=>({shop:String(e.shop_name),scope:String(e.audience_scope),label:`全场购买用户`,items:[...v(e.gender_distribution),...v(e.age_distribution)].filter(e=>U.has(e.label)),observedAt:String(e.observed_at??e.collected_at??``)})).filter(e=>e.items.length),K=W.length?W:G,te={checkedAt:H,source:l.audience?`source_auth_pending`:P.length?`screen_snapshot`:N?`screen_snapshot_empty`:`screen_snapshot`,byShop:Object.fromEntries(T.map(e=>{let t=F.get(e),n=!!t?.audience.length;return[e,{available:n,observedAt:t?.observedAt||null,reason:n?`已读取最近一次有效直播人群快照。`:l.audience?r(String(l.audience))+`；本次未取得人群快照，不使用旧数伪装为实时。`:t?`最新人群字段存在，但没有可解析的有效占比项。`:N?`实时直播快照源未返回该直播间记录；飞书经营根表不包含人群分布。`:`最近 15 日未返回该直播间的有效人群快照。`}]}))},q=B.some(e=>e.key===f.sessionKey)?f.sessionKey:B[0]?.key??null,J=B.find(e=>e.key===q),Y=!!(q&&N&&!O.has(q)),X=new Map(n(d).filter(e=>`${String(e.shop_name)}|${String(e.live_room_id)}`===q).map(e=>[String(e.channel_group),{value:C(e.traffic_share_percent),transactionAmount:C(e.transaction_amount_yuan),transactionShare:C(e.transaction_share_percent),valuePerThousandViews:C(e.pay_gpm_yuan)}])),Z=J?E[J.shop]:``,Q=n(m).filter(e=>String(e.live_room_name)===Z).map(e=>({role:String(e.role),name:String(e.name),startAt:String(e.start_at),endAt:String(e.end_at)})),$=Q.length?{items:[],error:``,updatedAt:null}:await A(s,f.date,Z),ne=Q.length?Q:$.items,re={source:Q.length?`marketing_schedule`:$.items.length?`dispatch_center`:`unavailable`,updatedAt:$.updatedAt??null,reason:Q.length?`已读取营销排班源。`:$.items.length?`营销助理排班未返回，已同步调度中心所选日期班表。`:`营销排班与调度中心均未返回可用班次${$.error?`：${$.error}`:``}。`},ie=Y&&q?N?.trendBySession[q]??[]:n(h).filter(e=>`${String(e.shop_name)}|${String(e.live_room_id)}`===q).map(e=>({hour:String(e.hour_label),gmv:w(e.hourly_gmv_fen),roi:C(e.roi),conversion:C(e.conversion)})),ae=((Y&&q?N?.trafficBySession[q]:null)??[[`自然推荐`,`#17694f`],[`付费推广`,`#3e8f72`],[`短视频引流`,`#d7f15b`],[`粉丝关注`,`#8aa68f`],[`同城`,`#e7b56c`],[`分享/私域`,`#b798d3`],[`其他`,`#dfe7e2`]].map(([e,t])=>({label:e,value:X.get(e)?.value??null,color:t,transactionAmount:X.get(e)?.transactionAmount??null,transactionShare:X.get(e)?.transactionShare??null,paymentAmountShare:X.get(e)?.transactionShare??null,valuePerThousandViews:X.get(e)?.valuePerThousandViews??null}))).map(e=>({...e,transactionAmount:`transactionAmount`in e?e.transactionAmount:null,transactionShare:`transactionShare`in e?e.transactionShare:null,paymentAmountShare:`paymentAmountShare`in e?e.paymentAmountShare:null,valuePerThousandViews:`valuePerThousandViews`in e?e.valuePerThousandViews:null,transactionStatus:`transactionAmount`in e&&e.transactionAmount!==null?`已回传`:`待接入`}));return Response.json({date:f.date,minDate:f.minDate,maxDate:f.maxDate,refreshMinutes:60,agent:{name:`直播数据分析代理`,summary:N?`${l.sessions?r(String(l.sessions)):`实时经营数据源部分直播间未返回场次`}，已用飞书根数据表补齐缺失直播间；${p.summary}`:p.summary},shops:T,sessions:B,recentSessions:V,selectedSessionKey:q,traffic:ae,audience:(J?.audience??[]).map(e=>({...e,transactionAmount:null,transactionShare:null,transactionStatus:`待接入`})),audienceStatus:te,audienceProfiles:K,trend:ie,visual:J?.visual??null,staffing:ne,staffingStatus:re,sourceErrors:l,sourceStatus:N?.sourceStatus??null,fetchedAt:new Date().toISOString()})}catch(e){return Response.json({error:e instanceof Error?e.message:`数据服务暂不可用`},{status:503})}}export{j as GET,x as dynamic,S as revalidate,b as runtime};