// Run periodically from an external scheduler; never from request handlers.
import { pool, transaction } from "./db.mjs";
if (!pool) throw new Error("DATABASE_URL is required");
try {
  await transaction(async (c) => {
    for (const table of ["sessions", "email_tokens"])
      await c.query(`DELETE FROM ${table} WHERE expires_at<now()`);
    await c.query("DELETE FROM auth_limits WHERE until_at<now()");
  });
} finally {
  await pool.end();
}
