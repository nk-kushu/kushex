import { isAnyOf, type TypedStartListening } from "@reduxjs/toolkit";
import type { AgentRunEventDto } from "@kushex/contracts";
import type { AppDispatch, RootState } from "../../app/store";
import type { StoreOptions } from "../../app/storeOptions";
import { kushexApi } from "../../shared/api/kushexApi";
import {
  breakpointsCleared,
  breakpointsMoved,
  breakpointsSynchronized,
  breakpointToggled,
  isFinished,
  persistRuns,
  runEventReceived,
  runStarted,
  runStreamFailed,
} from "./runsSlice";

/** EventSource retries on its own; after this many failures in a row the run is given up. */
const MAX_STREAM_FAILURES = 10;

export function addRunListeners(
  startListening: TypedStartListening<RootState, AppDispatch>,
  options: StoreOptions,
) {
  // Each run streams its events until it finishes; EventSource resumes after the last
  // event it received when the connection drops.
  startListening({
    actionCreator: runStarted,
    effect: async ({ payload: run }, api) => {
      if (typeof EventSource === "undefined") return;
      const url = new URL(
        `${options.apiBaseUrl ?? "/api"}/agent-runs/${encodeURIComponent(run.id)}/events`,
        globalThis.location?.href ?? "http://localhost",
      );
      const source = new EventSource(url);
      let failures = 0;
      source.onmessage = (message: MessageEvent<string>) => {
        failures = 0;
        api.dispatch(
          runEventReceived({ runId: run.id, event: JSON.parse(message.data) as AgentRunEventDto }),
        );
      };
      source.onerror = () => {
        failures += 1;
        if (source.readyState === EventSource.CLOSED || failures > MAX_STREAM_FAILURES) {
          source.close();
          api.dispatch(runStreamFailed(run.id));
        }
      };
      await api.condition((_action, state) =>
        isFinished(state.runs.runs[run.id]?.status ?? "failed"),
      );
      source.close();
    },
  });

  // Breakpoints edited during a debug session apply to it at once.
  startListening({
    matcher: isAnyOf(breakpointToggled, breakpointsMoved, breakpointsCleared),
    effect: async (action, api) => {
      const state = api.getState().runs;
      const run = state.debugRunId ? state.runs[state.debugRunId] : undefined;
      const edit = isAnyOf(breakpointToggled, breakpointsMoved)(action) ? action.payload : null;
      const agentName = edit?.agentName ?? (breakpointsCleared.match(action) ? action.payload : "");
      if (!run || run.agentName !== agentName || isFinished(run.status)) return;
      const files = edit
        ? [edit.file]
        : Object.keys(api.getOriginalState().runs.breakpoints[agentName] ?? {});
      for (const file of files) {
        const request = api.dispatch(
          kushexApi.endpoints.setBreakpoints.initiate({
            runId: run.id,
            file,
            lines: state.breakpoints[agentName]?.[file] ?? [],
          }),
        );
        // The run reports where breakpoints bound as an event; a failure leaves them as they were.
        await request.unwrap().catch(() => undefined);
        request.reset();
      }
    },
  });

  startListening({
    predicate: (action, current, previous) =>
      !breakpointsSynchronized.match(action) &&
      (current.runs.breakpoints !== previous.runs.breakpoints ||
        current.runs.watches !== previous.runs.watches ||
        current.runs.chats !== previous.runs.chats),
    effect: (_action, api) => persistRuns(api.getState().runs, options.instanceId),
  });
}
