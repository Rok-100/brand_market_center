import{t as e}from"./mcp-C9l5vAoi.js";var t=`edge`;async function n(e){let t=new Headers({Accept:`application/json`}),n=e.headers.get(`cookie`),r=e.headers.get(`x-oa-token`);if(!n&&!r)return Response.json({error:`请先从 WIS 品牌营销中枢登录。`},{status:401});n&&t.set(`Cookie`,n),r&&t.set(`X-OA-Token`,r);let i=[...new Set([process.env.CENTRAL_AUTHORITY_BASE||`https://app.fandow.top/fd-026222/wis-central-auth/api`,process.env.CENTRAL_AUTHORITY_FALLBACK_BASE||`https://app.fandow.top/fd-026222/wis-video-center/api`].filter(Boolean).map(e=>e.replace(/\/+$/u,``)))];for(let e of i){let n;try{n=await fetch(`${e}/central-auth/me`,{headers:t,redirect:`manual`,signal:AbortSignal.timeout(15e3)})}catch{continue}if(!(n.status>=500)){if(n.status===401||n.status>=300&&n.status<400)return Response.json({error:`统一登录状态已失效。`},{status:401});if(n.status===403)return Response.json({error:`当前账号未开通中枢登录权限。`},{status:403});if(n.status!==200)break;return(await n.json().catch(()=>({}))).access?.allowed_modules?.includes(`live-room-management`)?null:Response.json({error:`当前账号未开通直播间管理权限。`},{status:403})}}return Response.json({error:`统一权限服务暂时不可用，请稍后刷新。`},{status:503})}var r=`WITH latest_hour AS (
  SELECT *, ROW_NUMBER() OVER (
    PARTITION BY advertiser_id, live_session_id, stat_time_start
    ORDER BY observed_at DESC, id DESC
  ) AS rn
  FROM d_root_project_marketing_db.qianchuan_live_room_timeslot_sales_detail
  WHERE report_date = :report_date
    AND (advertiser_name LIKE '%WIS%' OR live_room_name LIKE '%WIS%')
)
SELECT live_session_id, live_room_name,
       SUM(total_pay_order_gmv_yuan) AS gmv_yuan,
       SUM(total_cost_yuan) AS cost_yuan,
       SUM(total_pay_order_gmv_yuan) / NULLIF(SUM(total_cost_yuan),0) AS roi
FROM latest_hour WHERE rn = 1
GROUP BY live_session_id, live_room_name;`;async function i(t){let i=await n(t);if(i)return i;if(process.env.RECOVERY_READ_ONLY===`1`)return Response.json({ok:!1,code:`recovery_read_only`,error:`维护恢复中，AI 分析生成已暂停；可继续查看已授权的只读数据。`},{status:423});let a=(await t.json()).prompt?.trim()||`分析 WIS 直播表现`,o=/峰|谷|时段/.test(a)?`成交波峰时段`:/流量|短视频|推荐/.test(a)?`流量渠道占比`:`直播场次 ROI`;try{let t=await e(`search_data_dictionary`,{keyword:o,limit:3});return Response.json({prompt:a,sql:r,safeguards:[`仅允许 SELECT 查询`,`按最新小时快照去重`,`金额单位为元`,`WIS 按账户/直播间名称匹配`],dictionary:t})}catch(e){return Response.json({error:e instanceof Error?e.message:`分析服务暂不可用`},{status:503})}}export{i as POST,t as runtime};