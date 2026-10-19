import {
  soundtrackInput,
  projectSoundtrack,
  type Soundtrack,
  type Project,
} from "./domain";
import { event, getProject, mediaPath, mutateProject } from "./store";
import { probe } from "./media";
import { ensureMedia } from "./media-storage";

export async function resolveSourceSoundtrack(
  project: Project,
  soundtrack: Soundtrack,
) {
  if (soundtrack.mode !== "source") return undefined;
  const asset = project.assets.find((a) => a.id === soundtrack.sourceAssetId);
  if (
    !asset ||
    !/^(audio|video)\//.test(asset.mime) ||
    !["upload", "social"].includes(asset.origin)
  )
    throw new Error(
      "Choose an imported original clip or uploaded audio file, not an H3 take or an export.",
    );
  const metadata = await probe(await ensureMedia(asset.id));
  if (
    !metadata.hasAudio ||
    !metadata.audioDuration ||
    !Number.isFinite(metadata.audioDuration) ||
    metadata.audioDuration <= 0
  )
    throw new Error(
      "That source has no usable audio track. Choose a reference with sound.",
    );
  return { asset, audioDuration: metadata.audioDuration };
}

export async function setSoundtrack(input: Soundtrack) {
  const soundtrack = soundtrackInput.parse(input);
  if (soundtrack.mode === "source") {
    soundtrack.playback ??= "once";
    soundtrack.fit ??= "keep-film";
  }
  const source = await resolveSourceSoundtrack(await getProject(), soundtrack);
  return await mutateProject((project) => {
    if (source && !project.assets.some((a) => a.id === source.asset.id))
      throw new Error(
        "The campaign changed while checking audio. Choose the source again.",
      );
    if (
      JSON.stringify(projectSoundtrack(project)) !==
        JSON.stringify(soundtrack) ||
      !project.soundtrack
    ) {
      project.soundtrack = soundtrack;
      event(
        project,
        "soundtrack.changed",
        source
          ? `Use original audio from ${source.asset.name} (${soundtrack.playback === "loop" ? "looped" : "once"}); replace H3 shot audio`
          : soundtrack.mode === "silent"
            ? "Remove all audio from the final film"
            : `Use one ${soundtrack.mood} instrumental score; remove all clip audio`,
      );
    }
    return soundtrack;
  });
}
