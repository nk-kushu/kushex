import { expect, it } from "vitest";
import { fileTabOpened, projectOpened, workbenchSlice } from "./workbenchSlice";

it("keeps tabs local to the selected project and starts without fixture tabs", () => {
  let state = workbenchSlice.reducer(undefined, { type: "init" });
  expect(state.fileTabs).toEqual([]);
  state = workbenchSlice.reducer(state, projectOpened("first"));
  state = workbenchSlice.reducer(
    state,
    fileTabOpened({
      key: "file:src/index.ts",
      title: "index.ts",
      path: "src/index.ts",
      kind: "file",
    }),
  );
  expect(workbenchSlice.reducer(state, projectOpened("first")).fileTabs).toHaveLength(1);
  state = workbenchSlice.reducer(state, projectOpened("second"));
  expect(state.projectId).toBe("second");
  expect(state.fileTabs).toEqual([]);
  expect(state.activeFileTab).toBeNull();
});
