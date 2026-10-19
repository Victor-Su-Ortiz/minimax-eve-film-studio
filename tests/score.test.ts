import { test } from "node:test";
import assert from "node:assert/strict";
import { composeScore } from "../lib/score";

test("instrumental score spans the film, is deterministic, non-silent and fades without clipping", () => {
  const settings = {
    mode: "instrumental" as const,
    mood: "cinematic" as const,
    tempo: 112,
  };
  const score = composeScore(30, settings);
  assert.equal(score.length, 44 + 30 * 48000 * 4);
  assert.equal(score.toString("ascii", 0, 4), "RIFF");
  assert.equal(score.readUInt16LE(22), 2);
  assert.deepEqual(score, composeScore(30, settings));
  let peak = 0;
  let energy = 0;
  for (let i = 44; i < score.length; i += 2) {
    const value = score.readInt16LE(i);
    peak = Math.max(peak, Math.abs(value));
    energy += value * value;
  }
  assert.ok(peak > 20000 && peak < 30000);
  assert.ok(energy > 0);
  assert.ok(Math.abs(score.readInt16LE(score.length - 2)) < 10);
  assert.notDeepEqual(
    score,
    composeScore(30, { ...settings, mood: "playful", tempo: 125 }),
  );
  assert.throws(() => composeScore(Infinity, settings));
  assert.throws(() => composeScore(301, settings));
});
