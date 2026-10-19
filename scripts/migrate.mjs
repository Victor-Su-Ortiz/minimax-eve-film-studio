import { readFile } from "node:fs/promises";
import pg from "pg";
const client = new pg.Client({
  connectionString:
    process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL,
});
if (!client.connectionParameters.password)
  throw new Error("Set DATABASE_URL_UNPOOLED for migrations.");
await client.connect();
try {
  await client.query("BEGIN");
  await client.query(
    await readFile(new URL("../sql/001-studio.sql", import.meta.url), "utf8"),
  );
  await client.query("COMMIT");
  console.log("Studio schema ready.");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
