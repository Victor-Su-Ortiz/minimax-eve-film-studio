import assert from "node:assert/strict";
import { getProject, mutateProject, postgresPool } from "../lib/store";
if (!process.env.DATABASE_URL)
  throw new Error("Use the isolated Neon test branch.");
process.env.STUDIO_PROJECT_ID = "deployment-verification";
try {
  await getProject();
  await mutateProject((p) => {
    p.events = [];
    p.name = "Neon deployment verification";
  });
  await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      mutateProject((p) => {
        p.events.push({
          id: String(i),
          at: new Date().toISOString(),
          type: "test",
          message: "Concurrent write",
        });
      }),
    ),
  );
  assert.equal(
    (await getProject()).events.length,
    12,
    "Concurrent writes must not be lost.",
  );
  await assert.rejects(
    () =>
      mutateProject((p) => {
        p.name = "should roll back";
        throw new Error("rollback-test");
      }),
    /rollback-test/,
  );
  assert.equal((await getProject()).name, "Neon deployment verification");
  console.log("Neon concurrency and rollback verified.");
} finally {
  await postgresPool().end();
}
