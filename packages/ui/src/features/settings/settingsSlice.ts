import type { SplitterSizesDto, UserSettingsDto } from "@kushex/contracts";
import { createAction, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { DEFAULT_EDITOR_FONT_SIZE } from "../../shared/lib/editorFontSize";
import type { ColorMode } from "../../types";

export type { ColorMode };
export type Density = "comfortable" | "compact";

/** The font size range the settings API accepts. */
export const FONT_SIZE_RANGE = { min: 10, max: 28 } as const;

export type SettingsState = UserSettingsDto &
  Readonly<{
    loadError: boolean;
    saveError: boolean;
  }>;

export const settingsRequested = createAction("settings/requested");
export const settingsSaveRetried = createAction("settings/saveRetried");

export const initialSettings: SettingsState = {
  colorMode: "system",
  density: "comfortable",
  editorFontSize: DEFAULT_EDITOR_FONT_SIZE,
  noteFontSize: 13,
  splitterSizes: {},
  loadError: false,
  saveError: false,
};

export const settingsSlice = createSlice({
  name: "settings",
  initialState: initialSettings,
  reducers: {
    settingsLoaded: (state, action: PayloadAction<Partial<UserSettingsDto>>) => ({
      ...state,
      ...action.payload,
      loadError: false,
    }),
    settingsLoadFailed: (state) => ({ ...state, loadError: true }),
    settingsSaveErrorChanged: (state, action: PayloadAction<boolean>) => ({
      ...state,
      saveError: action.payload,
    }),
    colorModeChanged: (state, action: PayloadAction<ColorMode>) => ({
      ...state,
      colorMode: action.payload,
    }),
    densityChanged: (state, action: PayloadAction<Density>) => ({
      ...state,
      density: action.payload,
    }),
    editorFontSizeChanged: (state, action: PayloadAction<number>) => ({
      ...state,
      editorFontSize: action.payload,
    }),
    noteFontSizeChanged: (state, action: PayloadAction<number>) => ({
      ...state,
      noteFontSize: action.payload,
    }),
    splitterSizesChanged: (state, action: PayloadAction<{ id: string; sizes: number[] }>) => ({
      ...state,
      splitterSizes: { ...state.splitterSizes, [action.payload.id]: action.payload.sizes },
    }),
  },
  selectors: {
    selectColorMode: (state) => state.colorMode,
    selectDensity: (state) => state.density,
    selectEditorFontSize: (state) => state.editorFontSize,
    selectNoteFontSize: (state) => state.noteFontSize,
    selectSplitterSizes: (state): SplitterSizesDto => state.splitterSizes,
  },
});

export const {
  colorModeChanged,
  densityChanged,
  editorFontSizeChanged,
  noteFontSizeChanged,
  splitterSizesChanged,
  settingsLoaded,
  settingsLoadFailed,
  settingsSaveErrorChanged,
} = settingsSlice.actions;
export const {
  selectColorMode,
  selectDensity,
  selectEditorFontSize,
  selectNoteFontSize,
  selectSplitterSizes,
} = settingsSlice.selectors;

/** settings "system" → antd-style ThemeProvider "auto". */
export function toThemeMode(mode: ColorMode): "light" | "dark" | "auto" {
  return mode === "system" ? "auto" : mode;
}
