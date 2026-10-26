import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import type {
  AgentDto,
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
  tagTypes: ["Projects", "Agents"],
  keepUnusedDataFor: 0,
  endpoints: (build) => ({
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
    kushibotTypes: build.query<LibraryTypesDto, void>({
      query: () => "/kushibot/types",
    }),
  }),
});
export const {
  useProjectQuery,
  useProjectsQuery,
  useCreateProjectMutation,
  useLocationsQuery,
  useTreeQuery,
  useLazyTreeQuery,
  useFileQuery,
  useAgentsQuery,
  useAgentQuery,
  useCreateAgentMutation,
  useCreateAgentFileMutation,
  useUpdateAgentFileMutation,
  useKushibotTypesQuery,
} = kushexApi;
