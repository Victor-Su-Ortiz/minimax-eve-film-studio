import type { Soundtrack } from "./domain";

// An original, deterministic studio score, synthesized from notes and percussion.
// No source recordings, speech, vocal model, or per-shot audio enters this signal.
export const SCORE_VERSION = "studio-instrumental-v1";
export function composeScore(duration: number, settings: Soundtrack): Buffer {
  if (!Number.isFinite(duration) || duration <= 0 || duration > 300)
    throw new Error("The studio score supports films up to five minutes.");
  const rate = 48000;
  const count = Math.round(duration * rate);
  const left = new Float32Array(count);
  const right = new Float32Array(count);
  const beat = 60 / settings.tempo;
  const frequency = (note: number) => 440 * 2 ** ((note - 69) / 12);
  let seed = 1234567;
  const noise = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2147483648 - 1;
  };
  function sound(
    start: number,
    length: number,
    level: number,
    pan: number,
    sample: (t: number) => number,
  ) {
    const offset = Math.round(start * rate);
    const end = Math.min(count - offset, Math.round(length * rate));
    const l = Math.sqrt((1 - pan) / 2),
      r = Math.sqrt((1 + pan) / 2);
    for (let i = 0; i < end; i++) {
      const t = i / rate;
      const envelope = Math.min(1, t / 0.008, (length - t) / 0.025);
      const value = sample(t) * envelope * level;
      left[offset + i] += value * l;
      right[offset + i] += value * r;
    }
  }
  function pluck(at: number, note: number, level: number, pan: number) {
    const f = frequency(note);
    const voice = (t: number) =>
      Math.sin(2 * Math.PI * f * t) * Math.exp(-3.5 * t) +
      0.3 * Math.sin(4 * Math.PI * f * t) * Math.exp(-7 * t) +
      0.1 * Math.sin(6 * Math.PI * f * t) * Math.exp(-12 * t);
    sound(at, 1.8, level, pan, voice);
    sound(at + beat * 0.75, 1.8, level * 0.18, -pan, voice);
  }
  const chords =
    settings.mood === "playful"
      ? [
          [60, 64, 67, 71],
          [57, 60, 64, 67],
          [53, 57, 60, 64],
          [55, 59, 62, 69],
        ]
      : [
          [57, 60, 64, 71],
          [53, 57, 60, 67],
          [60, 64, 67, 74],
          [55, 59, 62, 69],
        ];
  const outro = Math.max(duration * 0.75, duration - 5);
  for (let b = 0; b * beat < outro; b++) {
    const at = b * beat;
    const chord = chords[Math.floor(b / 8) % chords.length];
    const energy = 0.4 + 0.6 * Math.min(1, at / (duration * 0.65));
    if (b % 2 === 0 || at > duration * 0.2)
      pluck(
        at,
        chord[[0, 2, 1, 3, 2, 1, 3, 2][b % 8]] + 12,
        0.12 * energy,
        b % 2 ? 0.35 : -0.35,
      );
    if (b % 4 === 0) {
      const f = frequency(chord[0] - 12);
      sound(
        at,
        beat * 3.8,
        0.16 * energy,
        0,
        (t) => Math.sin(2 * Math.PI * f * t) * Math.exp(-1.6 * t),
      );
      if (at > duration * 0.15)
        sound(
          at,
          0.32,
          0.18 * energy,
          0,
          (t) =>
            Math.sin(2 * Math.PI * (48 * t + 4 * (1 - Math.exp(-18 * t)))) *
            Math.exp(-16 * t),
        );
    }
    if (at > duration * 0.25 && b % 2 === 1)
      sound(
        at,
        0.075,
        0.025 * energy,
        0.25,
        (t) => noise() * Math.exp(-65 * t),
      );
    if (b % 8 === 0) {
      for (const [index, note] of chord.entries()) {
        const f = frequency(note);
        sound(
          at,
          beat * 8.5,
          0.035 * energy,
          (index - 1.5) / 3,
          (t) =>
            (Math.sin(2 * Math.PI * f * t) +
              0.24 * Math.sin(2 * Math.PI * f * 1.003 * t)) *
            Math.min(1, t / 0.8) *
            Math.min(1, (beat * 8.5 - t) / 1.1),
        );
      }
    }
  }
  // One resolved chord carries across the end card rather than restarting music.
  for (const [i, note] of [57, 60, 64, 69, 76].entries())
    pluck(outro + i * 0.07, note, 0.16, (i - 2) / 4);
  let peak = 0;
  for (let i = 0; i < count; i++) {
    const t = i / rate;
    const fade = Math.min(1, t / 0.15, (duration - t) / 1.2);
    left[i] *= fade;
    right[i] *= fade;
    peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  }
  const gain = peak ? 0.7 / peak : 0;
  const bytes = Buffer.alloc(44 + count * 4);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(2, 22);
  bytes.writeUInt32LE(rate, 24);
  bytes.writeUInt32LE(rate * 4, 28);
  bytes.writeUInt16LE(4, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(count * 4, 40);
  for (let i = 0; i < count; i++) {
    bytes.writeInt16LE(Math.round(left[i] * gain * 32767), 44 + i * 4);
    bytes.writeInt16LE(Math.round(right[i] * gain * 32767), 46 + i * 4);
  }
  return bytes;
}
