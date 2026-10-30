import {
  colorModeChanged,
  densityChanged,
  editorFontSizeChanged,
  initialSettings,
  settingsSlice,
  toThemeMode,
} from "./settingsSlice";

describe("settingsSlice", () => {
  it("handles preference events", () => {
    let state = settingsSlice.reducer(undefined, { type: "init" });
    expect(state).toEqual(initialSettings);
    state = settingsSlice.reducer(state, colorModeChanged("dark"));
    state = settingsSlice.reducer(state, densityChanged("compact"));
    state = settingsSlice.reducer(state, editorFontSizeChanged(18));
    expect(state).toMatchObject({ colorMode: "dark", density: "compact", editorFontSize: 18 });
  });

  it("maps system to antd-style auto", () => {
    expect(toThemeMode("system")).toBe("auto");
    expect(toThemeMode("light")).toBe("light");
  });
});
