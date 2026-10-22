import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { ColorMode } from "../../types";

export type { ColorMode };
export type Density = "comfortable" | "compact";

export type SettingsState = Readonly<{ colorMode: ColorMode; density: Density }>;

export const initialSettings: SettingsState = { colorMode: "system", density: "comfortable" };

export const settingsSlice = createSlice({
  name: "settings",
  initialState: initialSettings,
  reducers: {
    colorModeChanged: (state, action: PayloadAction<ColorMode>) => ({ ...state, colorMode: action.payload }),
    densityChanged: (state, action: PayloadAction<Density>) => ({ ...state, density: action.payload }),
  },
  selectors: {
    selectColorMode: (state) => state.colorMode,
    selectDensity: (state) => state.density,
  },
});

export const { colorModeChanged, densityChanged } = settingsSlice.actions;
export const { selectColorMode, selectDensity } = settingsSlice.selectors;

/** settings "system" → antd-style ThemeProvider "auto". */
export function toThemeMode(mode: ColorMode): "light" | "dark" | "auto" {
  return mode === "system" ? "auto" : mode;
}
