import type {
  ConversationState,
  ConversationTask,
  ConversationTaskCall,
} from "eve/react";

export const filmCrew = [
  {
    id: "trend_scout",
    name: "Trend scout",
    description: "Finds and visually matches videos",
  },
  {
    id: "reference_analyst",
    name: "Reference analyst",
    description: "Studies the actual footage",
  },
  {
    id: "take_reviewer",
    name: "Take reviewer",
    description: "Checks the generated take",
  },
] as const;
export type CrewRole = (typeof filmCrew)[number]["id"];

export function crewRole(name: string): CrewRole | undefined {
  return filmCrew.find(({ id }) => name === id || name === `eve:subagent:${id}`)
    ?.id;
}

function outputText(output: unknown): string {
  if (typeof output === "string") return output;
  if (!output || typeof output !== "object" || Array.isArray(output)) return "";
  const value = output as Record<string, unknown>;
  return typeof value.message === "string"
    ? value.message
    : typeof value.text === "string"
      ? value.text
      : "";
}

export function crewProgress(data: ConversationState, role: CrewRole) {
  const turns = Object.keys(data.turns);
  const calls: { task: ConversationTask; call: ConversationTaskCall }[] = [];
  for (const task of Object.values(data.tasks)) {
    if (task.kind === "agent" && crewRole(task.name) === role)
      for (const call of Object.values(task.calls)) calls.push({ task, call });
  }
  calls.sort(
    (a, b) => turns.indexOf(a.call.turnId) - turns.indexOf(b.call.turnId),
  );
  const latest =
    calls.findLast(({ call }) => call.status === "working") || calls.at(-1);
  if (!latest)
    return {
      status: "standby" as const,
      activity: "",
      report: "",
      previous: false,
      streamUnavailable: false,
    };
  const { task, call } = latest;
  const child = Object.values(data.agents).find(
    (agent) => agent.taskId === task.taskId,
  );
  const observation = child?.observation;
  const conversation =
    observation && "conversation" in observation
      ? observation.conversation
      : undefined;
  // A followed child stream can lag the parent's new call. Match the k-th
  // child user message to the k-th call, as eve's agent task protocol does.
  // Never borrow activity or findings from an earlier call while catching up.
  const history = conversation?.messages || [];
  const userOffsets = history.flatMap((message, index) =>
    message.role === "user" ? [index] : [],
  );
  const callIndex = Object.keys(task.calls).indexOf(call.callId);
  const start = userOffsets[callIndex];
  const messages =
    start === undefined ? [] : history.slice(start, userOffsets[callIndex + 1]);
  const tools = messages.flatMap((message) =>
    message.parts.flatMap((part) =>
      part.type === "dynamic-tool" ? [part] : [],
    ),
  );
  const activeTool = tools.findLast(
    (part) =>
      !["output-available", "output-error", "output-denied"].includes(
        part.state,
      ),
  );
  // A task receipt is not a result. Only task.settled can mark completion.
  const report =
    call.status === "completed"
      ? outputText(call.output)
      : call.status === "failed"
        ? call.error?.message || "The task failed."
        : "";
  return {
    status: call.status,
    activity:
      call.status === "working"
        ? activeTool?.toolMetadata?.eve?.label ||
          "Working on the director’s brief"
        : "",
    report:
      report.length > 6000
        ? `${report.slice(0, 6000)}\n\n[Report shortened for display. Ask the director for a concise version.]`
        : report,
    previous: (data.activeTurnId || turns.at(-1)) !== call.turnId,
    streamUnavailable: observation?.status === "unavailable",
  };
}
