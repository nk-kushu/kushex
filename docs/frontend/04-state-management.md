# 04 — State management with Redux Toolkit

## Split of state

| Kind | Where | Examples |
| --- | --- | --- |
| **Server state** | RTK Query cache (`api` reducer) | runs, step attempts, sessions, artifacts, usage snapshots, debug event pages |
| **Live stream state** | RTK Query cache, patched by the SSE listener | lifecycle transitions and new debug events for runs being viewed |
| **Client / UI state** | Feature slices | list filters, sort, selected row, open drawer, panel sizes, color mode |
| **Local component state** | `useState` | input drafts, hover, a single modal's open flag when nothing else needs it |
| **URL state** | Router search params | run id, active tab, filters that should be shareable |

Rule: if it came from the server, it lives in RTK Query. Slices hold only what the
server doesn't know about.

As implemented, the runs list filters (`status`, `q`, `page`, `pageSize`, `sort`)
and the run detail tab live **only** in the URL. `runsSlice` keeps what is not worth
sharing: the selected step and expanded step rows. Other slices: `settings`
(persisted preferences), `scope` (mirror of `?project=&workspace=`), `live`
(per-run stream status) and `notices` (toasts raised by listeners).

## Store factory

The store is created per panel instance, never as a module-level singleton, so two
embedded panels (or tests) never share state.

```ts
// app/store.ts
import { combineSlices, configureStore } from "@reduxjs/toolkit";
import { setupListeners } from "@reduxjs/toolkit/query";
import { baseApi } from "../api/baseApi";
import { runsSlice } from "../features/runs/runsSlice";
import { settingsSlice } from "../features/settings/settingsSlice";
import { listenerMiddleware } from "./listenerMiddleware";

const rootReducer = combineSlices(baseApi, runsSlice, settingsSlice);

export type RootState = ReturnType<typeof rootReducer>;

export type StoreOptions = Readonly<{
  apiBaseUrl: string;
  getAuthToken?: () => Promise<string | undefined>;
  preloadedState?: Partial<RootState>;
}>;

export function makeStore(options: StoreOptions) {
  const store = configureStore({
    reducer: rootReducer,
    preloadedState: options.preloadedState,
    middleware: (getDefault) =>
      getDefault({ thunk: { extraArgument: options } })
        .prepend(listenerMiddleware.middleware)
        .concat(baseApi.middleware),
  });
  setupListeners(store.dispatch);
  return store;
}

export type AppStore = ReturnType<typeof makeStore>;
export type AppDispatch = AppStore["dispatch"];
```

```ts
// app/hooks.ts
import { useDispatch, useSelector } from "react-redux";
import type { AppDispatch, RootState } from "./store";

export const useAppDispatch = useDispatch.withTypes<AppDispatch>();
export const useAppSelector = useSelector.withTypes<RootState>();
```

`combineSlices` lets features that load lazily inject their slice later with
`rootReducer.inject(...)`.

As built, `listenerMiddleware.ts` exports `createListeners(options)` rather than a
module-level middleware, so no listener is shared between panel instances.
`StoreOptions` live in `app/storeOptions.ts` to avoid an import cycle with
`baseApi.ts`.

**Scope.** `baseQuery` sends the picked scope as `x-kushex-project` /
`x-kushex-workspace` headers. When the scope changes, a listener invalidates every
tag, so all mounted queries refetch for the new scope.

## RTK Query: one API, endpoints injected per feature

```ts
// api/baseApi.ts
import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import type { StoreOptions } from "../app/store";

export const baseApi = createApi({
  reducerPath: "api",
  baseQuery: async (args, api, extra) => {
    const options = (api.extra as StoreOptions);
    const raw = fetchBaseQuery({
      baseUrl: options.apiBaseUrl,
      prepareHeaders: async (headers) => {
        const token = await options.getAuthToken?.();
        if (token) headers.set("authorization", `Bearer ${token}`);
        return headers;
      },
    });
    return raw(args, api, extra);
  },
  tagTypes: ["Run", "StepRun", "Session", "Artifact", "Usage", "DebugEvents", "Publication"],
  endpoints: () => ({}),
});
```

```ts
// features/runs/runsApi.ts
import { baseApi } from "../../api/baseApi";
import type { RunSummary, RunDetail, RunListQuery, Page } from "./types";

export const runsApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    listRuns: build.query<Page<RunSummary>, RunListQuery>({
      query: (q) => ({ url: "/runs", params: q }),
      providesTags: (res) => [
        { type: "Run", id: "LIST" },
        ...(res?.items.map((r) => ({ type: "Run" as const, id: r.runId })) ?? []),
      ],
    }),
    getRun: build.query<RunDetail, string>({
      query: (runId) => `/runs/${runId}`,
      providesTags: (_r, _e, runId) => [{ type: "Run", id: runId }],
    }),
    stopRun: build.mutation<RunCommandReceipt, { runId: string; commandId: string; reason: string }>({
      query: ({ runId, ...body }) => ({ url: `/runs/${runId}/stop`, method: "POST", body }),
      invalidatesTags: (_r, _e, { runId }) => [{ type: "Run", id: runId }, { type: "Run", id: "LIST" }],
    }),
  }),
});

export const { useListRunsQuery, useGetRunQuery, useStopRunMutation } = runsApi;
```

### Commands and idempotency

kushibot treats commands as identified operations (it raises
`CommandIdentityConflictError` on reuse with different content). The UI therefore:

- generates a `commandId` (`crypto.randomUUID()`) when the confirm dialog opens,
  and reuses it if the user retries the same action;
- does **not** use optimistic updates for run commands; it waits for the
  server's receipt and then invalidates tags;
- shows conflicts (`409`) as "the run changed since you opened this; reload", not
  as a generic error.

### Pagination

Artifacts and debug events are paged by cursor on the server. Use RTK Query
**infinite queries** (`build.infiniteQuery`, RTK 2.6+) with
`getNextPageParam: (last) => last.nextCursor`. Large lists render in antd
`Table` with `virtual` enabled.

## Live updates (SSE)

The server exposes `GET /api/runs/:runId/events` as Server-Sent Events carrying
`DebugEvent`s (lifecycle and diagnostic channels). Wire it with
`onCacheEntryAdded` so the stream lives exactly as long as some component is
subscribed to that run.

**As implemented** (`features/debug/debugApi.ts`, `api/sse.ts`), there are two
differences from the sketch below:

- The stream is its own cache entry, `streamRunEvents(runId)`, separate from the
  paged `getRunDebugEvents` infinite query. `RunDetailPage` subscribes while the
  run is non-terminal; the Debug tab merges both lists and de-duplicates them by
  `eventId`.
- `EventSource` cannot send the `authorization` header that `getAuthToken`
  provides, so `openEventStream()` reads SSE over `fetch`. It resumes with
  `Last-Event-ID` and reports `connecting / open / reconnecting / failed`. After 5
  failed retries it reports `failed`, and the run detail switches to 3 s polling.

The original sketch:

```ts
getRunEvents: build.query<DebugEventPage, string>({
  query: (runId) => `/runs/${runId}/debug-events`,   // initial page
  async onCacheEntryAdded(runId, { updateCachedData, cacheDataLoaded, cacheEntryRemoved, dispatch, extra }) {
    await cacheDataLoaded;
    const { apiBaseUrl } = extra as StoreOptions;
    const source = new EventSource(`${apiBaseUrl}/runs/${runId}/events`);
    source.onmessage = (msg) => {
      const event = JSON.parse(msg.data) as DebugEvent;
      updateCachedData((draft) => { appendBounded(draft.items, event, 2_000); });
      if (event.channel === "lifecycle") {
        dispatch(baseApi.util.invalidateTags([{ type: "Run", id: runId }]));
      }
    };
    await cacheEntryRemoved;
    source.close();
  },
}),
```

Notes:
- Keep the in-memory event list **bounded** (e.g. last 2,000); older events are
  read through the paged endpoint. kushibot bounds its debug publisher too.
- De-duplicate by `eventId` — reconnects can replay.
- Lifecycle events invalidate the run so status, step table and usage refetch
  from the source of truth instead of being rebuilt in the browser.
- If SSE is unavailable (some proxies), fall back to `pollingInterval: 3000` on
  `getRun` while the run is non-terminal.

## Slices (UI state)

```ts
// features/runs/runsSlice.ts
import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { LifecycleStatus } from "@kushibot/core";

type RunsUiState = {
  statusFilter: LifecycleStatus[];
  search: string;
  selectedStepRunId?: string;
  detailTab: "steps" | "timeline" | "artifacts" | "usage" | "debug";
};

const initialState: RunsUiState = { statusFilter: [], search: "", detailTab: "steps" };

export const runsSlice = createSlice({
  name: "runsUi",
  initialState,
  reducers: {
    statusFilterChanged(state, a: PayloadAction<LifecycleStatus[]>) { state.statusFilter = a.payload; },
    searchChanged(state, a: PayloadAction<string>) { state.search = a.payload; },
    stepSelected(state, a: PayloadAction<string | undefined>) { state.selectedStepRunId = a.payload; },
    detailTabChanged(state, a: PayloadAction<RunsUiState["detailTab"]>) { state.detailTab = a.payload; },
  },
  selectors: {
    selectRunFilters: (s) => ({ status: s.statusFilter, search: s.search }),
  },
});
```

- Name actions as events (`searchChanged`, `stepSelected`), not setters.
- Derived data uses `createSelector`; never store derived values.
- Persist color mode and density through the backend settings API. A per-store
  listener loads `GET /settings` and serializes partial `PATCH /settings` updates.
  Startup loading preserves edits made while the request is in flight. Settings
  are scoped to the backend actor; host color mode overrides remain local.
  Settings-screen alerts expose load/save failures with retry controls.

## Errors

A single `rtkQueryErrorLogger` listener catches rejected mutations and shows
`App.useApp().notification` with the server's error code and message. Query
errors are rendered in place (antd `Result` / `Alert`) by the screen, not as
toasts.
