import {creativeSchema} from './creative_schema.mjs';
import {mysqlMediaBucket} from './r2_mysql_metadata.mjs';
// Preserve the asynchronous D1 interface used by the existing creative app.
// Credentials are server-only bindings. Native MySQL is the authoritative store.
export function createD1Mysql(bindings, fetchImpl = fetch) {
  const base = String(bindings.PINYING_DATA_URL || '').replace(/\/+$/u, '');
  const token = String(bindings.PINYING_DATA_TOKEN || '');
  if (!/^http:\/\/brand-marketing-fd-026222-data-gateway:8080$/u.test(base) || !token) {
    throw new Error('Private business database is not configured');
  }
  async function send(statements) {
    const id = crypto.randomUUID();
    const body = JSON.stringify({id, queries: statements.map(({sql, params}) => ({sql, params}))});
    let failure;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetchImpl(base + '/sql/creative', {
          method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + token},
          body, signal: AbortSignal.timeout(45000), redirect: 'manual',
        });
        if (response.status >= 300 && response.status < 400) throw new Error('Private database redirected unexpectedly');
        const payload = await response.json();
        if (!response.ok) {
          const error = new Error(payload.error || 'Business database is unavailable');
          error.status = response.status;
          error.code = payload.code;
          error.retryable = payload.retryable;
          throw error;
        }
        return payload;
      } catch (error) {
        failure = error;
        if (error.retryable === false || (error.status && error.status < 500)) throw error;
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
      }
    }
    throw failure;
  }
  // Only immutable schema validations are cached; business rows stay fresh.
  const validations = new Map();
  async function submit(statements) {
    const validating = statements.every(({sql,params}) => !params.length &&
      (/^\s*CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)\s+IF\s+NOT\s+EXISTS\b/iu.test(sql) ||
       /^\s*PRAGMA\s+table_info\s*\(/iu.test(sql)));
    if (!validating) return send(statements);
    const key = JSON.stringify(statements);
    const cached = validations.get(key);
    if (cached && cached.until > Date.now()) return structuredClone(await cached.pending);
    const entry = {until: Date.now() + 300000, pending: send(statements)};
    validations.set(key, entry);
    try { return structuredClone(await entry.pending); }
    catch (error) { if (validations.get(key) === entry) validations.delete(key); throw error; }
  }
  let schemaPending, schemaUntil = 0;
  async function ensureProductionSchema() {
    if (!schemaPending || schemaUntil <= Date.now()) {
      schemaUntil = Date.now() + 300000;
      schemaPending = (async () => {
        const tables = Object.keys(creativeSchema);
        const rows = await submit(tables.map(table => new Statement('PRAGMA table_info(' + table + ')')));
        for (let i = 0; i < tables.length; i++) {
          const present = new Set(rows[i].results.map(column => column.name));
          if (!creativeSchema[tables[i]].every(column => present.has(column)))
            throw new Error('Creative schema requires a verified production migration');
        }
      })();
    }
    try { await schemaPending; } catch (error) { schemaUntil = 0; validations.clear(); throw error; }
  }
  class Statement {
    constructor(sql, params = []) { this.sql = sql; this.params = params; }
    bind(...params) {
      return new Statement(this.sql, params.map(value => {
        if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
          const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
          let encoded = ''; for (const byte of bytes) encoded += String.fromCharCode(byte);
          return {__pinying_bytes__: btoa(encoded)};
        }
        if (typeof value === 'boolean') return Number(value);
        return value;
      }));
    }
    async all() { return (await submit([this]))[0]; }
    async run() { return (await submit([this]))[0]; }
    async first(column) {
      const row = (await this.all()).results[0];
      if (!row) return null;
      if (column !== undefined) {
        if (!Object.hasOwn(row, column)) throw new Error('D1_ERROR: Column not found');
        return row[column];
      }
      return row;
    }
    async raw(options = {}) {
      const response = await this.all();
      return options.columnNames ? [response.columns, ...response.raw] : response.raw;
    }
  }
  return {
    isProductionMysql: true,
    ensureProductionSchema,
    async isWritable() {
      const row = await new Statement('PRAGMA pinying_database_status').first();
      return !row.read_only;
    },
    prepare(sql) { return new Statement(sql); },
    batch(statements) {
      if (statements.some(statement => !(statement instanceof Statement))) throw new Error('Invalid database statement');
      return submit(statements);
    },
    async exec() { throw new Error('Schema changes require a versioned migration'); },
    withSession() { return this; },
  };
}

export function mysqlEnvironment(nativeBindings) {
  let database,media;
  return new Proxy(nativeBindings, {
    get(target, key) {
      if (key === 'DB') return database ||= createD1Mysql(target);
      if (key === 'MEDIA') return media ||= mysqlMediaBucket(target.MEDIA,target);
      return Reflect.get(target, key);
    },
  });
}
