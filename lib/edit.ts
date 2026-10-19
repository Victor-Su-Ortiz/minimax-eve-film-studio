import { acceptedAsset, type Project } from "./domain";

/** A short source-length edit keeps each scene and the end card at native speed. */
export function sourceLengthEdit(project: Project, audioSeconds: number) {
  const totalFrames = Math.round(audioSeconds * 24);
  const shots = project.shots;
  if (
    !Number.isFinite(audioSeconds) ||
    totalFrames < shots.length * 6 ||
    audioSeconds > 300
  )
    throw new Error(
      "The source audio is too short to retain every scene and the title card, or exceeds five minutes.",
    );
  if (audioSeconds > shots.reduce((n, shot) => n + shot.duration, 0))
    throw new Error(
      "The soundtrack is longer than the planned film. Keep the film length to trim the audio, or plan a longer film first.",
    );
  const titles = shots.filter((s) => s.kind === "title");
  const footage = shots.filter((s) => s.kind !== "title");
  if (!footage.length)
    throw new Error("A source-length edit needs at least one footage shot.");
  const capacity = (shot: (typeof shots)[number]) => {
    const asset = project.assets.find((a) => a.id === acceptedAsset(shot));
    return Math.floor(
      Math.min(shot.duration, asset?.duration || shot.duration) * 24 + 1e-6,
    );
  };
  const footageCapacity = footage.map(capacity);
  const titleCapacity = titles.map(capacity);
  // Keep a proportionate end card, then give it any time the footage cannot
  // cover. A near-full-length source must not stretch a seven-second payoff.
  const titleTotal = titles.length
    ? Math.max(
        titles.length * 6,
        totalFrames - footageCapacity.reduce((sum, frames) => sum + frames, 0),
        Math.min(
          Math.round(totalFrames * 0.16),
          titleCapacity.reduce((sum, frames) => sum + frames, 0),
          totalFrames - footage.length * 6,
        ),
      )
    : 0;
  const titleFrames = distributeFrames(
    titleTotal,
    titleCapacity,
    titles.map(() => 1),
  );
  const footageFrames = distributeFrames(
    totalFrames - titleTotal,
    footageCapacity,
    footage.map((_, index) => (index === footage.length - 1 ? 2.2 : 1)),
  );
  return shots.map((shot) => {
    if (shot.kind === "title")
      return {
        shotId: shot.id,
        start: 0,
        duration: titleFrames[titles.indexOf(shot)] / 24,
      };
    const index = footage.indexOf(shot);
    const last = index === footage.length - 1;
    const frames = footageFrames[index];
    const duration = frames / 24;
    const asset = project.assets.find((a) => a.id === acceptedAsset(shot));
    const sourceDuration = asset?.duration || shot.duration;
    if (duration > sourceDuration)
      throw new Error(
        `The source-length edit needs more footage for “${shot.title}”. Choose a shorter soundtrack or keep the existing edit.`,
      );
    const maxStart = Math.max(0, sourceDuration - duration);
    const start = last
      ? Math.max(0, maxStart - 0.15)
      : index === 0
        ? Math.min(0.3, maxStart)
        : maxStart / 2;
    return { shotId: shot.id, start: Math.floor(start * 24) / 24, duration };
  });
}

// Integer frames keep the sum exact. Cap each allocation at its real footage
// length, redistributing excess while favoring the payoff on shorter edits.
function distributeFrames(
  total: number,
  capacities: number[],
  weights: number[],
) {
  if (
    capacities.some((cap) => cap < 6) ||
    total < capacities.length * 6 ||
    total > capacities.reduce((sum, cap) => sum + cap, 0)
  )
    throw new Error(
      "The source-length edit needs more footage. Choose a shorter soundtrack or keep the existing edit.",
    );
  const frames = capacities.map(() => 6);
  for (let remaining = total - frames.length * 6; remaining > 0; remaining--) {
    let chosen = -1;
    for (let i = 0; i < frames.length; i++) {
      if (frames[i] >= capacities[i]) continue;
      if (
        chosen < 0 ||
        frames[i] / weights[i] < frames[chosen] / weights[chosen]
      )
        chosen = i;
    }
    frames[chosen]++;
  }
  return frames;
}
