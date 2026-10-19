import { test } from "node:test";
import assert from "node:assert/strict";
import type { ConversationState } from "eve/react";
import { crewProgress } from "../lib/crew";

function conversation(): ConversationState {
  return {
    messages: [],
    turns: { first: { turnId: "first", status: "active" } },
    inputs: {},
    tasks: {},
    agents: {},
    activeTurnId: "first",
  };
}
function withTask(
  status: "working" | "completed" | "failed" | "cancelled",
  output?: string,
): ConversationState {
  return {
    ...conversation(),
    tasks: {
      scout: {
        taskId: "scout",
        name: "eve:subagent:trend_scout",
        kind: "agent",
        calls: {
          call: {
            callId: "call",
            turnId: "first",
            status,
            output,
            error:
              status === "failed"
                ? { message: "Provider unavailable" }
                : undefined,
          },
        },
      },
    },
  };
}

test("crew stays on standby until a real task starts and a receipt cannot mark completion", () => {
  assert.equal(crewProgress(conversation(), "trend_scout").status, "standby");
  const state: ConversationState = {
    ...withTask("working"),
    messages: [
      {
        id: "receipt",
        role: "assistant",
        parts: [
          {
            type: "dynamic-tool",
            toolCallId: "call",
            toolName: "trend_scout",
            state: "output-available",
            input: {},
            output: { taskId: "scout" },
          },
        ],
      },
    ],
  };
  const result = crewProgress(state, "trend_scout");
  assert.equal(result.status, "working");
  assert.equal(result.report, "");
});

test("child tool labels are visible without exposing reasoning or treating a stream error as a task failure", () => {
  const state: ConversationState = {
    ...withTask("working"),
    agents: {
      child: {
        sessionId: "child",
        name: "trend_scout",
        taskId: "scout",
        callId: "call",
        turnId: "first",
        observation: {
          status: "following",
          conversation: {
            ...conversation(),
            messages: [
              {
                id: "request",
                role: "user",
                parts: [{ type: "text", text: "Find examples" }],
              },
              {
                id: "child-message",
                role: "assistant",
                parts: [
                  { type: "reasoning", text: "PRIVATE REASONING" },
                  {
                    type: "dynamic-tool",
                    toolCallId: "search",
                    toolName: "search_trend_videos",
                    state: "input-available",
                    input: {},
                    toolMetadata: {
                      eve: {
                        kind: "tool-call",
                        name: "search_trend_videos",
                        label: "Find real videos: dancing dogs",
                      },
                    },
                  },
                ],
              },
            ],
          },
        },
      },
    },
  };
  assert.equal(
    crewProgress(state, "trend_scout").activity,
    "Find real videos: dancing dogs",
  );
  assert.ok(
    !JSON.stringify(crewProgress(state, "trend_scout")).includes(
      "PRIVATE REASONING",
    ),
  );
  const unavailable: ConversationState = {
    ...state,
    agents: {
      child: { ...state.agents.child, observation: { status: "unavailable" } },
    },
  };
  assert.equal(crewProgress(unavailable, "trend_scout").status, "working");
  assert.equal(
    crewProgress(unavailable, "trend_scout").streamUnavailable,
    true,
  );
});

test("a lagging child stream cannot show an earlier call's activity or report", () => {
  const state = withTask("completed", "Earlier result");
  const next: ConversationState = {
    ...state,
    tasks: {
      scout: {
        ...state.tasks.scout,
        calls: {
          ...state.tasks.scout.calls,
          retry: { callId: "retry", turnId: "first", status: "working" },
        },
      },
    },
    agents: {
      child: {
        sessionId: "child",
        name: "trend_scout",
        taskId: "scout",
        callId: "call",
        turnId: "first",
        observation: {
          status: "following",
          conversation: {
            ...conversation(),
            messages: [
              {
                id: "old-request",
                role: "user",
                parts: [{ type: "text", text: "Old request" }],
              },
              {
                id: "old-response",
                role: "assistant",
                parts: [
                  { type: "text", text: "STALE FINDINGS" },
                  {
                    type: "dynamic-tool",
                    toolCallId: "old-tool",
                    toolName: "search_trend_videos",
                    state: "input-available",
                    input: {},
                    toolMetadata: {
                      eve: {
                        kind: "tool-call",
                        name: "search_trend_videos",
                        label: "OLD ACTIVITY",
                      },
                    },
                  },
                ],
              },
            ],
          },
        },
      },
    },
  };
  assert.equal(
    crewProgress(next, "trend_scout").activity,
    "Working on the director’s brief",
  );
  assert.equal(crewProgress(next, "trend_scout").report, "");
  const settled: ConversationState = {
    ...next,
    tasks: {
      scout: {
        ...next.tasks.scout,
        calls: {
          ...next.tasks.scout.calls,
          retry: { callId: "retry", turnId: "first", status: "completed" },
        },
      },
    },
  };
  assert.equal(crewProgress(settled, "trend_scout").report, "");
});

test("old crew results remain labelled previous after a later director turn ends", () => {
  const state = withTask("completed", "Earlier result");
  const later: ConversationState = {
    ...state,
    activeTurnId: undefined,
    turns: {
      first: { turnId: "first", status: "completed" },
      second: { turnId: "second", status: "completed" },
    },
  };
  assert.equal(crewProgress(later, "trend_scout").previous, true);
});

test("settled results, failures and cancellation retain their actual status after replay", () => {
  assert.equal(
    crewProgress(
      withTask("completed", "Two relevant source clips found."),
      "trend_scout",
    ).report,
    "Two relevant source clips found.",
  );
  assert.equal(
    crewProgress(withTask("failed"), "trend_scout").report,
    "Provider unavailable",
  );
  assert.equal(
    crewProgress(withTask("cancelled"), "trend_scout").status,
    "cancelled",
  );
  const state = withTask("completed", "Earlier result");
  const continued: ConversationState = {
    ...state,
    activeTurnId: "second",
    turns: { ...state.turns, second: { turnId: "second", status: "active" } },
    tasks: {
      scout: {
        ...state.tasks.scout,
        calls: {
          ...state.tasks.scout.calls,
          continued: {
            callId: "continued",
            turnId: "second",
            status: "working",
          },
        },
      },
    },
  };
  assert.equal(crewProgress(continued, "trend_scout").status, "working");
  assert.equal(crewProgress(continued, "trend_scout").report, "");
});
