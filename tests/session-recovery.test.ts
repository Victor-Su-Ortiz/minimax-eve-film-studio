import assert from "node:assert/strict";
import { test } from "node:test";
import { ClientError } from "eve/client";
import { sendWithSessionRecovery } from "../lib/session-recovery";

test("expired conversations retry the rejected turn once in a fresh binding", async () => {
  let error: unknown;
  const calls: string[] = [];
  await sendWithSessionRecovery(
    async () => {
      calls.push("send");
      error = new ClientError(
        409,
        JSON.stringify({ code: "session_not_active" }),
      );
    },
    () => calls.push("reset"),
    () => error,
  );
  assert.deepEqual(calls, ["send", "reset", "send"]);
});

test("successful, ambiguous, rate-limited and active-session failures never replay a turn", async () => {
  for (const error of [
    undefined,
    new Error("Network connection lost"),
    new ClientError(429, JSON.stringify({ code: "rate_limit" })),
    new ClientError(409, JSON.stringify({ code: "session_not_ready" })),
    new ClientError(500, JSON.stringify({ code: "session_not_active" })),
  ]) {
    let sent = 0;
    await sendWithSessionRecovery(
      async () => {
        sent++;
      },
      () => assert.fail("Must not reset a potentially active session"),
      () => error,
    );
    assert.equal(sent, 1);
  }
});
