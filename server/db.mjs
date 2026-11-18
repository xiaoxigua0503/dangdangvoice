import pg from "pg";
let databaseUrl = process.env.DDV_PROCESS_ROLE === 'worker'
  ? (process.env.WORKER_DATABASE_URL || process.env.DATABASE_URL)
  : process.env.DATABASE_URL;
if(databaseUrl && process.env.NODE_ENV==='production') {
  const u=new URL(databaseUrl);
  if(!['postgres:','postgresql:'].includes(u.protocol) || ['localhost','127.0.0.1','[::1]','0.0.0.0','host.docker.internal'].includes(u.hostname))throw new Error('生产必须配置外部 PostgreSQL，禁止使用本机开发库');
  if(process.env.DDV_PROCESS_ROLE==='worker' && u.hostname.includes('-pooler.'))throw new Error('AI worker 必须使用直连 PostgreSQL，不能使用事务池化地址');
  if(['prefer','require','verify-ca'].includes(u.searchParams.get('sslmode'))){u.searchParams.set('sslmode','verify-full');databaseUrl=u.toString();}
}
export const pool = databaseUrl
  ? new pg.Pool({
      connectionString: databaseUrl,
      max: 10,
      connectionTimeoutMillis: 5000,
      statement_timeout: 15000,
    })
  : null;
export async function transaction(fn) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const result = await fn(c);
    await c.query("COMMIT");
    return result;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}

// Idle disconnects must not terminate the HTTP process or expose connection details.
pool?.on("error", () => console.error("PostgreSQL idle connection failed"));
