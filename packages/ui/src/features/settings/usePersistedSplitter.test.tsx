import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { Provider } from "react-redux";
import { makeStore } from "../../app/store";
import { splitterSizesChanged } from "./settingsSlice";
import { usePersistedSplitter } from "./usePersistedSplitter";

function setup(id: string, panels: number) {
  const store = makeStore({});
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  return { store, ...renderHook(() => usePersistedSplitter(id, panels), { wrapper }) };
}

describe("usePersistedSplitter", () => {
  it("leaves panels on their default size until sizes are saved", () => {
    const { result } = setup("files", 2);
    expect(result.current.size(0)).toBeUndefined();
    expect(result.current.size(1)).toBeUndefined();
  });

  it("follows a drag in pixels and saves fractions when it ends", () => {
    const { store, result } = setup("workbench:side-main-chat", 3);
    act(() => result.current.splitter.onResize([300, 600, 300]));
    expect(result.current.size(1)).toBe(600);
    act(() => result.current.splitter.onResizeEnd([200, 600, 200]));
    expect(store.getState().settings.splitterSizes["workbench:side-main-chat"]).toEqual([
      0.2, 0.6, 0.2,
    ]);
    expect([0, 1, 2].map(result.current.size)).toEqual(["20%", "60%", "20%"]);
  });

  it("ignores saved sizes for a different number of panels", () => {
    const { store, result } = setup("files", 2);
    act(() => {
      store.dispatch(splitterSizesChanged({ id: "files", sizes: [0.2, 0.3, 0.5] }));
    });
    expect(result.current.size(0)).toBeUndefined();
  });
});
