import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export type Activity = "projects" | "files" | "tasks" | "notes" | "settings";

/** Narrow screens show one region at a time. */
export type MobileView = "side" | "main" | "chat";

export type FileTab = Readonly<{ key: string; title: string; kind: "file" | "diff" }>;

type WorkbenchState = {
  activity: Activity;
  projectName: string | null;
  fileTabs: FileTab[];
  activeFileTab: string | null;
  mobileView: MobileView;
};

const initialState: WorkbenchState = {
  activity: "projects",
  projectName: null,
  fileTabs: [
    { key: "file:file.ts", title: "file.ts", kind: "file" },
    { key: "file:other.ts", title: "other.ts", kind: "file" },
  ],
  activeFileTab: "file:file.ts",
  mobileView: "main",
};

export const workbenchSlice = createSlice({
  name: "workbench",
  initialState,
  reducers: {
    activityChanged(state, action: PayloadAction<Activity>) {
      state.activity = action.payload;
    },
    projectOpened(state, action: PayloadAction<string>) {
      state.projectName = action.payload;
      state.activity = "files";
    },
    fileTabOpened(state, action: PayloadAction<FileTab>) {
      if (!state.fileTabs.some((tab) => tab.key === action.payload.key)) state.fileTabs.push(action.payload);
      state.activeFileTab = action.payload.key;
      state.activity = "files";
      state.mobileView = "main";
    },
    fileTabActivated(state, action: PayloadAction<string>) {
      state.activeFileTab = action.payload;
    },
    fileTabClosed(state, action: PayloadAction<string>) {
      const index = state.fileTabs.findIndex((tab) => tab.key === action.payload);
      state.fileTabs = state.fileTabs.filter((tab) => tab.key !== action.payload);
      if (state.activeFileTab === action.payload) {
        state.activeFileTab = state.fileTabs[Math.max(0, index - 1)]?.key ?? null;
      }
    },
    mobileViewChanged(state, action: PayloadAction<MobileView>) {
      state.mobileView = action.payload;
    },
  },
  selectors: {
    selectActivity: (state) => state.activity,
    selectProjectName: (state) => state.projectName,
    selectFileTabs: (state) => state.fileTabs,
    selectActiveFileTab: (state) => state.activeFileTab,
    selectMobileView: (state) => state.mobileView,
  },
});

export const { activityChanged, projectOpened, fileTabOpened, fileTabActivated, fileTabClosed, mobileViewChanged } = workbenchSlice.actions;
export const { selectActivity, selectProjectName, selectFileTabs, selectActiveFileTab, selectMobileView } = workbenchSlice.selectors;
