import type { ConversationState } from "eve/react";
import {
  Check,
  Clapperboard,
  Circle,
  LoaderCircle,
  Radar,
  ScanLine,
  UsersRound,
  X,
} from "lucide-react";
import { filmCrew, crewProgress } from "@/lib/crew";
import { DirectorText } from "./director-text";

const icons = {
  trend_scout: Radar,
  reference_analyst: ScanLine,
  take_reviewer: Clapperboard,
};
const labels = {
  standby: "Standby",
  working: "Working",
  completed: "Done",
  failed: "Needs attention",
  cancelled: "Stopped",
};

export function FilmCrew({
  conversation,
}: {
  conversation: ConversationState;
}) {
  const crew = filmCrew.map((member) => ({
    ...member,
    ...crewProgress(conversation, member.id),
  }));
  const working = crew.filter((member) => member.status === "working").length;
  return (
    <section className="nl-crew nl-section" aria-label="Your film crew">
      <div className="nl-section-heading">
        <UsersRound size={15} />
        <h2>Your film crew</h2>
        <span>M3.1 specialists · coordinated by eve</span>
      </div>
      <p className="nl-crew-summary" role="status">
        {working > 1
          ? `${working} specialists working in parallel`
          : working === 1
            ? "A specialist is working with your director"
            : "One conversation. Your director brings in the right specialist."}
      </p>
      <div className="nl-crew-grid">
        {crew.map((member) => {
          const Icon = icons[member.id];
          const Status =
            member.status === "working"
              ? LoaderCircle
              : member.status === "completed"
                ? Check
                : member.status === "failed" || member.status === "cancelled"
                  ? X
                  : Circle;
          return (
            <article
              key={member.id}
              className={`nl-crew-card ${member.status}`}
              aria-label={member.name}
            >
              <div className="nl-crew-title">
                <Icon size={17} />
                <h3>{member.name}</h3>
              </div>
              <p className="nl-crew-role">{member.description}</p>
              <div className="nl-crew-status">
                <Status size={12} />
                <span>
                  {labels[member.status]}
                  {member.previous && member.status !== "working"
                    ? " · previous task"
                    : ""}
                </span>
              </div>
              {member.activity && (
                <p className="nl-crew-activity">{member.activity}</p>
              )}
              {member.streamUnavailable && (
                <p className="nl-crew-activity">
                  Detailed updates unavailable. Task status is still tracked.
                </p>
              )}
              {member.report && (
                <>
                  <p className="nl-crew-preview">
                    <DirectorText text={member.report} />
                  </p>
                  <details>
                    <summary>
                      {member.status === "failed"
                        ? "View error"
                        : "Read findings"}
                    </summary>
                    <div className="nl-crew-report">
                      <DirectorText text={member.report} />
                    </div>
                  </details>
                </>
              )}
              {member.status === "cancelled" && (
                <p className="nl-crew-activity">
                  This task was stopped. Continue through the same prompt.
                </p>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
