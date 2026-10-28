import type { AgentRunDebugEventsDto, RecordedDebugEventDto } from "@kushex/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "../../shared/api/errorMessage";
import { useLazyAgentRunDebugEventsQuery } from "../../shared/api/kushexApi";
import { isFinished } from "../runs/runsSlice";

/** While the run works, new events are fetched this often. */
const POLL_MS = 1000;
/** After an error, the next attempt waits this long. */
const RETRY_MS = 3000;
/** Events reported just before the run ended are stored shortly after; look once more. */
const SETTLE_MS = 1500;

export type RunDebugEvents = Readonly<{
  run: AgentRunDebugEventsDto["run"] | null;
  recording: boolean;
  events: readonly RecordedDebugEventDto[];
  loading: boolean;
  /** Fetching continues while the run is active. */
  live: boolean;
  error: string | null;
  refresh: () => void;
}>;

/** A run's debug events: fetched page by page, then only newer ones while the run works. */
export function useRunDebugEvents(runId: string): RunDebugEvents {
  const [fetchPage] = useLazyAgentRunDebugEventsQuery();
  const [run, setRun] = useState<AgentRunDebugEventsDto["run"] | null>(null);
  const [recording, setRecording] = useState(true);
  const [events, setEvents] = useState<readonly RecordedDebugEventDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const cursor = useRef<string | undefined>(undefined);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const next = (delay: number) => {
      if (!stopped) timer = setTimeout(() => void tick(), delay);
    };
    const tick = async () => {
      try {
        const page = await fetchPage({ runId, after: cursor.current }, false).unwrap();
        if (stopped) return;
        cursor.current = page.cursor;
        setRun(page.run);
        setRecording(page.recording);
        if (page.events.length) setEvents((all) => [...all, ...page.events]);
        setError(null);
        setLoading(false);
        const active = page.run.status !== null && !isFinished(page.run.status);
        setLive(active);
        if (page.more) return next(0);
        if (active) return next(POLL_MS);
        if (!settled && page.run.status !== null) {
          settled = true;
          return next(SETTLE_MS);
        }
      } catch (failure) {
        if (stopped) return;
        setError(errorMessage(failure));
        setLoading(false);
        next(RETRY_MS);
      }
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [fetchPage, runId, generation]);

  const refresh = useCallback(() => setGeneration((value) => value + 1), []);
  return { run, recording, events, loading, live, error, refresh };
}
