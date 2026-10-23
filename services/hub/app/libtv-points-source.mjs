import { cycleStart, priceRows, pointUnits, pointsText, moneyText } from './libtv-cost-pricing.mjs';
import { readFile } from 'node:fs/promises';

export const TABLE = 'd_root_project_mid_db_brandmarketing.libtv_points_consumption';
const DAY = 86400000;
export function dateText(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
export function filtersFrom(params, now = new Date()) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const endDate = params.get('endDate') || today;
  const days = Number(params.get('days') || 7);
  const startDate = params.get('startDate') || (dateText(endDate) ? new Date(Date.parse(`${endDate}T00:00:00Z`) - ([7,15,30,90].includes(days) ? days - 1 : 6) * DAY).toISOString().slice(0,10) : '');
  if (!dateText(startDate) || !dateText(endDate) || startDate > endDate) throw Object.assign(new Error('请选择有效的起止日期，开始日期不能晚于结束日期'), { status: 400 });
  const length = Math.round((Date.parse(endDate) - Date.parse(startDate)) / DAY) + 1;
  if (length > 366) throw Object.assign(new Error('单次日期范围最多支持 366 天'), { status: 400 });
  const teamMember = params.get('team_member') || '';
  const modelName = params.get('model_name') || '';
  if (teamMember.length > 255 || modelName.length > 255) throw Object.assign(new Error('筛选值过长'), { status: 400 });
  return { startDate, endDate, days: length, teamMember, modelName };
}

// Read the shared account from its pricing-cycle boundary, before UI filters.
export function aggregateSql(filters) {
  if (!dateText(filters.startDate) || !dateText(filters.endDate)) throw new Error('无效查询日期');
  return `SELECT CAST(id AS CHAR) AS id, DATE_FORMAT(consumed_at, '%Y-%m-%d %H:%i:%s.%f') AS consumedAt, team_member, model_name, CAST(-consumed_points AS CHAR) AS points FROM ${TABLE} WHERE consumed_at >= ? AND consumed_at < ? ORDER BY consumed_at, id`;
}

export function summarize(rows, filters, source) {
  const within=rows.filter(r=>r.date>=filters.startDate && r.date<=filters.endDate);
  const selected=within.filter(r=>(!filters.teamMember||r.team_member===filters.teamMember)&&(!filters.modelName||r.model_name===filters.modelName));
  const series=Array.from({length:filters.days},(_,i)=>({date:new Date(Date.parse(filters.startDate)+i*DAY).toISOString().slice(0,10),q:0n,amount:0n,transactionCount:0,complete:true}));
  const daily=new Map(series.map(r=>[r.date,r]));
  let total=0n, amount=0n, complete=true, count=0;
  const incompleteCycles=new Set();
  for(const row of selected){
    const q=pointUnits(row.consumed), value=row.estimatedUnits===null?null:BigInt(row.estimatedUnits), target=daily.get(row.date);
    total+=q;count+=row.transactionCount;target.q+=q;target.transactionCount+=row.transactionCount;
    if(value===null){complete=false;target.complete=false;incompleteCycles.add(row.cycleStart)}else{amount+=value;target.amount+=value;}
  }
  return {schemaVersion:4,generatedAt:new Date().toISOString(),status:'ready',
    range:{startDate:filters.startDate,endDate:filters.endDate,timezone:'Asia/Shanghai'},filters,
    options:{teamMembers:[...new Set(within.map(r=>r.team_member).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-CN')),modelNames:[...new Set(within.map(r=>r.model_name).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-CN'))},
    summary:{consumed:Number(pointsText(total)),consumedExact:pointsText(total),dailyAverage:Number(pointsText((total+BigInt(filters.days)/2n)/BigInt(filters.days))),transactionCount:count,estimatedAmount:moneyText(complete?amount:null),dailyAverageAmount:moneyText(complete?amount:null,filters.days)},
    series:series.map(r=>({date:r.date,consumed:Number(pointsText(r.q)),consumedExact:pointsText(r.q),transactionCount:r.transactionCount,estimatedAmount:moneyText(r.complete?r.amount:null)})),
    members:[],models:[],
    pricing:{name:'积分消耗估算金额',quota:'132000',includedRate:'0.019',excessRate:'0.035',resetDay:16,complete,incompleteCycles:[...incompleteCycles],note:complete?'全账号共享额度，先计价后筛选；根据现有流水估算，非实际账单。':'所选历史周期缺少起点前段流水，相关金额待核验。'},source};
}

export async function mysqlOptions(env = process.env, read = readFile) {
  let config = {};
  if (env.LIBTV_MYSQL_CONFIG_FILE) {
    const payload = JSON.parse((await read(env.LIBTV_MYSQL_CONFIG_FILE, 'utf8')).replace(/^\uFEFF/, ''));
    config = payload.mysql || payload;
  }
  const host = config.host || env.LIBTV_MYSQL_HOST || env.ROOT_MYSQL_HOST;
  const user = config.user || env.LIBTV_MYSQL_USER || env.ROOT_MYSQL_USER;
  const password = config.password ?? env.LIBTV_MYSQL_PASSWORD ?? env.ROOT_MYSQL_PASSWORD;
  const port = Number(config.port || env.LIBTV_MYSQL_PORT || env.ROOT_MYSQL_PORT || 3306);
  if (!host || !user || password === undefined || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('LibTV MySQL只读连接尚未配置');
  return { host, user, password, port, database: 'd_root_project_mid_db_brandmarketing',
    charset: 'utf8mb4', timezone: '+08:00', dateStrings: true,
    connectTimeout: 10000, waitForConnections: true, connectionLimit: 2,
    maxIdle: 2, idleTimeout: 60000, queueLimit: 20, multipleStatements: false,
    ...(config.ssl ? { ssl: config.ssl } : {}),
  };
}

export function createMysqlReader({ env = process.env, read = readFile, loadDriver = () => import('mysql2/promise') } = {}) {
  let poolPromise;
  async function pool() {
    if (!poolPromise) {
      poolPromise = (async () => {
        const options = await mysqlOptions(env, read);
        const driver = await loadDriver();
        return driver.createPool(options);
      })().catch(error => { poolPromise = null; throw error; });
    }
    return poolPromise;
  }
  const query = async filters => {
    const db = await pool();
    const connection = await db.getConnection();
    let reusable = false;
    try {
      // MySQL enforces read-only access for every transaction in this reader.
      await connection.query("SET SESSION time_zone = '+08:00'");
      await connection.query('SET TRANSACTION READ ONLY');
      await connection.beginTransaction();
      const nextDate = new Date(Date.parse(filters.endDate) + DAY).toISOString().slice(0, 10);
      const [coverage] = await connection.query(`SELECT MIN(consumed_at) AS firstAt, MAX(consumed_at) AS lastAt FROM ${TABLE}`);
      const [rows] = await connection.execute({ sql: aggregateSql(filters), timeout: 15000 }, [`${cycleStart(filters.startDate)} 00:00:00`, `${nextDate} 00:00:00`]);
      await connection.rollback();
      reusable = true;
      return { rows, historyStart:coverage[0].firstAt, latestConsumedAt:coverage[0].lastAt };
    } finally {
      // A failed/aborted transaction never goes back into the reusable pool.
      if (reusable) connection.release(); else connection.destroy();
    }
  };
  query.close = async () => { if (poolPromise) { const db = await poolPromise; poolPromise = null; await db.end(); } };
  return query;
}

export function createLibtvPointsSource({ env = process.env, read = readFile, query = createMysqlReader({ env, read }) } = {}) {
  const cache = new Map(), pending = new Map();
  return async function load(filters, force = false) {
    const snapshot = env.LOCAL_SIMULATION === '1' && (env.LIBTV_POINTS_SNAPSHOT_FILE || new URL('./libtv-points-snapshot.json', import.meta.url));
    const key = JSON.stringify([filters.startDate, filters.endDate]);
    let result = cache.get(key);
    if (!force && result && Date.now() - result.at < 300000) return summarize(result.rows, filters, result.source);
    let task = pending.get(key);
    if (!task) {
      task = (async () => {
        let rows, source;
        if (snapshot) {
          const payload = JSON.parse((await read(snapshot, 'utf8')).replace(/^\uFEFF/, ''));
          if (payload.table !== TABLE || !Array.isArray(payload.rows) || !Number.isFinite(Date.parse(payload.capturedAt))) throw new Error('本地积分快照无效');
          rows = priceRows(payload.rows, payload.historyStart);
          source = { label: '根数据 · LibTV 积分', mode: 'snapshot', latestConsumedAt:payload.latestConsumedAt, updatedAt: payload.capturedAt, note: '本地合成模拟数据；非真实流水。' };
        } else {
          const payload = await query(filters);
          rows = priceRows(payload.rows, payload.historyStart);
          source = { label: 'MySQL只读 · LibTV 积分', mode: 'mysql', latestConsumedAt:payload.latestConsumedAt, updatedAt: new Date().toISOString(), note: 'MySQL只读事务按北京时间每日汇总；消耗积分以正数展示。' };
        }
        // Validate before caching; a broken source never becomes a zero chart.
        summarize(rows, filters, source);
        if (cache.size >= 32) cache.delete(cache.keys().next().value);
        const value = { rows, source, at: Date.now() }; cache.set(key, value); return value;
      })().finally(() => pending.delete(key));
      pending.set(key, task);
    }
    result = await task;
    return summarize(result.rows, filters, result.source);
  };
}
