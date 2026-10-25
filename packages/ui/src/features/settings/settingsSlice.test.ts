import {
  colorModeChanged,
  densityChanged,
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
    expect(state).toMatchObject({ colorMode: "dark", density: "compact" });
  });

  it("maps system to antd-style auto", () => {
    expect(toThemeMode("system")).toBe("auto");
    expect(toThemeMode("light")).toBe("light");
  });
});
