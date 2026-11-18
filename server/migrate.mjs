import { pool, transaction } from "./db.mjs";
import { readdir, readFile } from "node:fs/promises";
if (!pool) throw new Error("DATABASE_URL is required");
try {
  await transaction(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(73416921)");
    await c.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    for (const file of (
      await readdir(new URL("../migrations/", import.meta.url))
    )
      .filter((f) => f.endsWith(".sql"))
      .sort()) {
      if (
        (
          await c.query("SELECT 1 FROM schema_migrations WHERE version=$1", [
            file,
          ])
        ).rowCount
      )
        continue;
      await c.query(
        await readFile(
          new URL("../migrations/" + file, import.meta.url),
          "utf8",
        ),
      );
      await c.query("INSERT INTO schema_migrations(version) VALUES($1)", [
        file,
      ]);
      console.log("Applied", file);
    }
  });
} finally {
  await pool.end();
}
