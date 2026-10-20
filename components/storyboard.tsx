import Image from "next/image";
import { Images, LoaderCircle } from "lucide-react";
import { currentStoryboard, type Project } from "@/lib/domain";

export function Storyboard({ project }: { project: Project }) {
  if (!project.storyboards?.length) return null;
  return (
    <section className="nl-section" aria-label="Visual storyboard">
      <div className="nl-section-heading">
        <Images size={14} />
        <h2>The storyboard</h2>
        <span>MiniMax images → H3 footage</span>
      </div>
      <p className="nl-storyboard-note">
        Your film, frame by frame. These are generated planning images; the
        video comes next.
      </p>
      <div className="nl-storyboard">
        {project.shots
          .filter((shot) => shot.kind === "generated")
          .map((shot, index) => {
            const latest = project.storyboards?.findLast(
              (frame) => frame.shotId === shot.id,
            );
            const frame = currentStoryboard(project, shot);
            const asset = project.assets.find((a) => a.id === latest?.assetId);
            const stale = Boolean(
              latest && !frame && latest.status === "ready",
            );
            return (
              <article key={shot.id}>
                {asset ? (
                  <a
                    href={`/api/media/${asset.id}`}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open storyboard: ${shot.title}`}
                  >
                    <Image
                      src={`/api/media/${asset.id}`}
                      alt={`${shot.title} — generated storyboard frame`}
                      width={asset.width || 1280}
                      height={asset.height || 720}
                      unoptimized
                    />
                  </a>
                ) : (
                  <div className="nl-storyboard-placeholder" role="status">
                    {latest?.status === "generating" && (
                      <LoaderCircle size={20} className="spin" />
                    )}
                    <span>
                      {latest?.status === "generating"
                        ? "Drawing this scene…"
                        : latest?.status === "failed" ||
                            latest?.status === "unknown"
                          ? "Image unavailable"
                          : "Next on the drawing board"}
                    </span>
                  </div>
                )}
                <div className="nl-storyboard-caption">
                  <small>
                    {String(index + 1).padStart(2, "0")} · {shot.duration}s
                  </small>
                  <h3>{shot.title}</h3>
                  <p>{shot.description}</p>
                  <small>
                    {stale
                      ? "Earlier plan · needs updating"
                      : frame
                        ? "Visual guide for H3"
                        : ""}
                  </small>
                  {latest?.error && (
                    <p className="nl-storyboard-error">{latest.error}</p>
                  )}
                </div>
              </article>
            );
          })}
      </div>
    </section>
  );
}
