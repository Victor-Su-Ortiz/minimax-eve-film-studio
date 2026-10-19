import test from "node:test";
import assert from "node:assert/strict";
import { initialProject } from "../lib/domain";
import { sourceLengthEdit } from "../lib/edit";
import { applyShotEdits } from "../lib/shot-edit";

function projectWithFootage() {
  const project = initialProject();
  const durations = [6, 8, 7, 5];
  project.shots.forEach((shot, index) => {
    shot.duration = durations[index];
    if (shot.kind === "title") return;
    shot.kind = "generated";
    shot.acceptedTakeId = `take_${index}`;
    shot.takes = [
      {
        id: shot.acceptedTakeId,
        assetId: `asset_${index}`,
        prompt: "",
        createdAt: "",
      },
    ];
    project.assets.push({
      id: `asset_${index}`,
      name: "take.mp4",
      mime: "video/mp4",
      size: 100,
      sha256: "fixture",
      origin: "h3",
      createdAt: "",
      duration: shot.duration,
    });
  });
  return project;
}

test("a 24.832-second soundtrack fits available 6/8/7-second footage and an end card", () => {
  const project = projectWithFootage();
  const before = structuredClone(project);
  const edit = sourceLengthEdit(project, 24.832);
  assert.equal(
    edit.reduce((sum, shot) => sum + Math.round(shot.duration * 24), 0),
    Math.round(24.832 * 24),
  );
  for (let i = 0; i < edit.length; i++) {
    assert.ok(edit[i].duration <= project.shots[i].duration);
    assert.ok(
      edit[i].start + edit[i].duration <= project.shots[i].duration + 1e-6,
    );
  }
  assert.ok(
    edit[3].duration >= 3,
    "Keep a readable brand finish instead of stretching the payoff",
  );
  assert.deepEqual(project, before);
});

test("short audio retains all scenes; a full-length source preserves their capacities", () => {
  const project = projectWithFootage();
  const short = sourceLengthEdit(project, 6.25);
  assert.equal(
    short.reduce((sum, shot) => sum + shot.duration, 0),
    6.25,
  );
  assert.ok(short.every((shot) => shot.duration >= 0.25));
  assert.ok(short[2].duration > short[0].duration);
  assert.ok(short[3].duration <= 1);
  assert.deepEqual(
    sourceLengthEdit(project, 26).map((s) => s.duration),
    [6, 8, 7, 5],
  );
  assert.throws(
    () => sourceLengthEdit(project, 27),
    /longer than the planned film/,
  );
  assert.throws(() => sourceLengthEdit(project, 0.5), /too short/);
});

test("actual clip lengths cap the edit even if the plan expected more footage", () => {
  const project = projectWithFootage();
  project.assets[0].duration = 4;
  assert.throws(() => sourceLengthEdit(project, 25), /needs more footage/);
  const edit = sourceLengthEdit(project, 20);
  assert.ok(edit[0].start + edit[0].duration <= 4);
});

test("an editorial in-point removes repeated action with a bounded hold and stays tied to its take", () => {
  const project = projectWithFootage();
  const shot = project.shots[2];
  project.shotEdits = [
    {
      shotId: shot.id,
      takeId: shot.acceptedTakeId!,
      start: 1.25,
      holdEnd: true,
    },
  ];
  const base = sourceLengthEdit(project, 24.832);
  const edit = applyShotEdits(project, base);
  assert.equal(edit[2].start, 1.25);
  assert.equal(edit[2].duration, base[2].duration);
  assert.deepEqual(edit.slice(0, 2), base.slice(0, 2));
  project.shotEdits[0].holdEnd = false;
  assert.throws(
    () => applyShotEdits(project, base),
    /allowed final-frame hold/,
  );
  project.shotEdits[0].holdEnd = true;
  project.shotEdits[0].start = 3;
  assert.throws(
    () => applyShotEdits(project, base),
    /allowed final-frame hold/,
  );
  project.shotEdits[0].start = 1.25;
  shot.acceptedTakeId = "another_take";
  assert.throws(() => applyShotEdits(project, base), /selected take changed/);
});
