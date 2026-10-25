import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import type {
  CreateProjectRequest,
  DirectoryPageDto,
  FileContentDto,
  Page,
  ProjectDto,
  UserSettingsDto,
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
  tagTypes: ["Projects"],
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
} = kushexApi;
