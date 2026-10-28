import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import type {
  AgentCodeNotesDto,
  ChatThreadDto,
  ChatThreadDetailDto,
  AgentDto,
  AgentRunDebugEventsDto,
  AgentRunDto,
  DebugBreakpointDto,
  DebugCommand,
  DebugValueDto,
  DebugVariableDto,
  EvaluateRequest,
  ScriptSourceDto,
  SetBreakpointsRequest,
  StartAgentRunRequest,
  AgentFileDto,
  AgentSummaryDto,
  CreateAgentFileRequest,
  CreateAgentRequest,
  CreateProjectRequest,
  LibraryTypesDto,
  DirectoryPageDto,
  FileContentDto,
  Page,
  ProjectDto,
  UserSettingsDto,
  UpdateAgentCodeNotesRequest,
  UpdateAgentFileRequest,
  UpdateUserSettingsRequest,
} from "@kushex/contracts";
import type { StoreOptions } from "../../app/storeOptions";

/** Each panel's store owns its cache and transport configuration. */
export const kushexApi = createApi({
  reducerPath: "kushexApi",
  baseQuery: (args, api, extraOptions) => {
    const options = api.extra as StoreOptions;
    return fetchBaseQuery({
      baseUrl: new URL(
        options.apiBaseUrl ?? "/api",
        globalThis.location?.href ?? "http://localhost",
      ).href,
      cache: "no-store",
    })(args, api, extraOptions);
  },
  tagTypes: ["Projects", "Agents", "AgentFiles", "AgentNotes", "ChatThreads"],
  keepUnusedDataFor: 0,
  endpoints: (build) => ({
    chatThreads: build.query<readonly ChatThreadDto[], string>({
      query: (projectId) => `/projects/${encodeURIComponent(projectId)}/chat-threads`,
      providesTags: ["ChatThreads"],
    }),
    chatThread: build.query<ChatThreadDetailDto, { projectId: string; id: string }>({
      query: ({ projectId, id }) =>
        `/projects/${encodeURIComponent(projectId)}/chat-threads/${encodeURIComponent(id)}`,
    }),
    createChatThread: build.mutation<ChatThreadDto, string>({
      query: (projectId) => ({
        url: `/projects/${encodeURIComponent(projectId)}/chat-threads`,
        method: "POST",
        body: {},
      }),
      invalidatesTags: ["ChatThreads"],
    }),
    deleteChatThreads: build.mutation<void, { projectId: string; id?: string }>({
      query: ({ projectId, id }) => ({
        url: `/projects/${encodeURIComponent(projectId)}/chat-threads${id ? `/${encodeURIComponent(id)}` : ""}`,
        method: "DELETE",
        body: {},
      }),
      invalidatesTags: ["ChatThreads"],
    }),
    settings: build.query<UserSettingsDto, void>({
      query: () => "/settings",
    }),
    updateSettings: build.mutation<UserSettingsDto, UpdateUserSettingsRequest>({
      query: (body) => ({ url: "/settings", method: "PATCH", body }),
    }),
    project: build.query<ProjectDto, string>({
      query: (id) => `/projects/${encodeURIComponent(id)}`,
      providesTags: ["Projects"],
    }),
    projects: build.query<Page<ProjectDto>, number>({
      query: (offset) => ({ url: "/projects", params: { offset } }),
      providesTags: ["Projects"],
    }),
    createProject: build.mutation<ProjectDto, CreateProjectRequest>({
      query: (body) => ({ url: "/projects", method: "POST", body }),
      invalidatesTags: ["Projects"],
    }),
    locations: build.query<DirectoryPageDto, number>({
      query: (offset) => ({ url: "/locations", params: { offset } }),
    }),
    tree: build.query<DirectoryPageDto, { projectId: string; path: string; offset?: number }>({
      query: ({ projectId, ...params }) => ({
        url: `/projects/${encodeURIComponent(projectId)}/tree`,
        params,
      }),
    }),
    file: build.query<FileContentDto, { projectId: string; path: string }>({
      query: ({ projectId, path }) => ({
        url: `/projects/${encodeURIComponent(projectId)}/file`,
        params: { path },
      }),
    }),
    agents: build.query<Page<AgentSummaryDto>, void>({
      query: () => "/agents",
      providesTags: ["Agents"],
    }),
    agent: build.query<AgentDto, string>({
      query: (name) => `/agents/${encodeURIComponent(name)}`,
    }),
    /**
     * The agent's files as they are on disk now. The server reports changes to the folder
     * over an event stream, and each one refetches them; so does every (re)connect, which
     * covers changes made while the stream was down.
     */
    agentFiles: build.query<readonly AgentFileDto[], string>({
      query: (name) => `/agents/${encodeURIComponent(name)}`,
      transformResponse: (agent: AgentDto) => agent.files,
      providesTags: (_result, _error, name) => [{ type: "AgentFiles", id: name }],
      async onCacheEntryAdded(name, { cacheEntryRemoved, dispatch, extra }) {
        if (typeof EventSource === "undefined") return;
        const options = extra as StoreOptions;
        const source = new EventSource(
          new URL(
            `${options.apiBaseUrl ?? "/api"}/agents/${encodeURIComponent(name)}/events`,
            globalThis.location?.href ?? "http://localhost",
          ),
        );
        const refetch = () =>
          dispatch(kushexApi.util.invalidateTags([{ type: "AgentFiles", id: name }]));
        let opened = false;
        source.onopen = () => {
          if (opened) refetch();
          opened = true;
        };
        source.onmessage = refetch;
        await cacheEntryRemoved;
        source.close();
      },
    }),
    createAgent: build.mutation<AgentDto, CreateAgentRequest>({
      query: (body) => ({ url: "/agents", method: "POST", body }),
      invalidatesTags: ["Agents"],
    }),
    // The editor keeps saved revisions itself, so file mutations do not refetch the agent.
    createAgentFile: build.mutation<AgentFileDto, CreateAgentFileRequest & { name: string }>({
      query: ({ name, ...body }) => ({
        url: `/agents/${encodeURIComponent(name)}/files`,
        method: "POST",
        body,
      }),
    }),
    updateAgentFile: build.mutation<AgentFileDto, UpdateAgentFileRequest & { name: string }>({
      query: ({ name, ...body }) => ({
        url: `/agents/${encodeURIComponent(name)}/files`,
        method: "PUT",
        body,
      }),
      invalidatesTags: ["Agents"],
    }),
    agentNotes: build.query<AgentCodeNotesDto, string>({
      query: (name) => `/agents/${encodeURIComponent(name)}/notes`,
      providesTags: (_result, _error, name) => [{ type: "AgentNotes", id: name }],
    }),
    // The saved notes replace the cached ones, so the next save is based on their revision.
    updateAgentNotes: build.mutation<
      AgentCodeNotesDto,
      UpdateAgentCodeNotesRequest & { name: string }
    >({
      query: ({ name, ...body }) => ({
        url: `/agents/${encodeURIComponent(name)}/notes`,
        method: "PUT",
        body,
      }),
      async onQueryStarted({ name }, { dispatch, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled;
          dispatch(kushexApi.util.upsertQueryData("agentNotes", name, data));
        } catch {
          // A conflict refetches the notes, so the next save starts from the latest.
          dispatch(kushexApi.util.invalidateTags([{ type: "AgentNotes", id: name }]));
        }
      },
    }),
    kushibotTypes: build.query<LibraryTypesDto, void>({
      query: () => "/kushibot/types",
    }),
    // Agent runs stream their events over EventSource (app/agentRunStreams.ts); these
    // endpoints start, stop and debug them.
    startAgentRun: build.mutation<AgentRunDto, StartAgentRunRequest & { projectId: string }>({
      query: ({ projectId, ...body }) => ({
        url: `/projects/${encodeURIComponent(projectId)}/agent-runs`,
        method: "POST",
        body,
      }),
    }),
    cancelAgentRun: build.mutation<void, string>({
      query: (runId) => ({
        url: `/agent-runs/${encodeURIComponent(runId)}/cancel`,
        method: "POST",
        body: {},
      }),
    }),
    debugCommand: build.mutation<void, { runId: string; command: DebugCommand }>({
      query: ({ runId, command }) => ({
        url: `/agent-runs/${encodeURIComponent(runId)}/debug`,
        method: "POST",
        body: { command },
      }),
    }),
    setBreakpoints: build.mutation<
      { breakpoints: readonly DebugBreakpointDto[] },
      SetBreakpointsRequest & { runId: string }
    >({
      query: ({ runId, ...body }) => ({
        url: `/agent-runs/${encodeURIComponent(runId)}/breakpoints`,
        method: "PUT",
        body,
      }),
    }),
    evaluate: build.mutation<DebugValueDto, EvaluateRequest & { runId: string }>({
      query: ({ runId, ...body }) => ({
        url: `/agent-runs/${encodeURIComponent(runId)}/evaluate`,
        method: "POST",
        body,
      }),
    }),
    /** `pause` keys the cache: object refs are only valid during the pause that made them. */
    debugVariables: build.query<
      Page<DebugVariableDto>,
      { runId: string; ref: string; pause: number }
    >({
      query: ({ runId, ref }) => ({
        url: `/agent-runs/${encodeURIComponent(runId)}/variables`,
        params: { ref },
      }),
    }),
    /** One page of a run's kushibot debug events; `after` is the previous page's cursor. */
    agentRunDebugEvents: build.query<AgentRunDebugEventsDto, { runId: string; after?: string }>({
      query: ({ runId, after }) => ({
        url: `/agent-runs/${encodeURIComponent(runId)}/debug-events`,
        params: after ? { after } : {},
      }),
    }),
    scriptSource: build.query<ScriptSourceDto, { runId: string; scriptId: string }>({
      query: ({ runId, scriptId }) =>
        `/agent-runs/${encodeURIComponent(runId)}/scripts/${encodeURIComponent(scriptId)}`,
    }),
  }),
});
export const {
  useChatThreadsQuery,
  useLazyChatThreadQuery,
  useCreateChatThreadMutation,
  useDeleteChatThreadsMutation,
  useProjectQuery,
  useProjectsQuery,
  useCreateProjectMutation,
  useLocationsQuery,
  useTreeQuery,
  useLazyTreeQuery,
  useFileQuery,
  useAgentsQuery,
  useAgentQuery,
  useAgentFilesQuery,
  useCreateAgentMutation,
  useCreateAgentFileMutation,
  useUpdateAgentFileMutation,
  useAgentNotesQuery,
  useUpdateAgentNotesMutation,
  useKushibotTypesQuery,
  useStartAgentRunMutation,
  useCancelAgentRunMutation,
  useDebugCommandMutation,
  useEvaluateMutation,
  useLazyDebugVariablesQuery,
  useLazyScriptSourceQuery,
  useLazyAgentRunDebugEventsQuery,
} = kushexApi;
