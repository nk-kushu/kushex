import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

/** Narrow screens show one region at a time. */
export type MobileView = "side" | "main" | "chat";

export type FileTab = Readonly<{
  key: string;
  title: string;
  path?: string;
  kind: "file" | "diff";
}>;

type WorkbenchState = {
  projectId: string | null;
  fileTabs: FileTab[];
  activeFileTab: string | null;
  mobileView: MobileView;
};

const initialState: WorkbenchState = {
  projectId: null,
  fileTabs: [],
  activeFileTab: null,
  mobileView: "main",
};

export const workbenchSlice = createSlice({
  name: "workbench",
  initialState,
  reducers: {
    projectOpened(state, action: PayloadAction<string>) {
      if (state.projectId !== action.payload) {
        state.fileTabs = [];
        state.activeFileTab = null;
      }
      state.projectId = action.payload;
      state.mobileView = "side";
    },
    fileTabOpened(state, action: PayloadAction<FileTab>) {
      if (!state.fileTabs.some((tab) => tab.key === action.payload.key))
        state.fileTabs.push(action.payload);
      state.activeFileTab = action.payload.key;
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
    selectProjectId: (state) => state.projectId,
    selectFileTabs: (state) => state.fileTabs,
    selectActiveFileTab: (state) => state.activeFileTab,
    selectMobileView: (state) => state.mobileView,
  },
});

export const {
  projectOpened,
  fileTabOpened,
  fileTabActivated,
  fileTabClosed,
  mobileViewChanged,
} = workbenchSlice.actions;
export const {
  selectProjectId,
  selectFileTabs,
  selectActiveFileTab,
  selectMobileView,
} = workbenchSlice.selectors;
