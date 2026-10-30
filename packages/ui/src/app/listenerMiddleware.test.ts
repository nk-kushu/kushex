import type { UpdateUserSettingsRequest, UserSettingsDto } from "@kushex/contracts";
import { waitFor } from "@testing-library/react";
import { vi } from "vitest";
import {
  colorModeChanged,
  densityChanged,
  editorFontSizeChanged,
  settingsRequested,
  settingsSaveRetried,
  splitterSizesChanged,
} from "../features/settings/settingsSlice";
import { makeStore } from "./store";

const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("backend preferences", () => {
  it("loads preferences using the configured API base and never writes on hydration", async () => {
    const fetch = vi.fn(async (_request: Request) =>
      response({ colorMode: "dark", density: "compact" }),
    );
    vi.stubGlobal("fetch", fetch);
    const store = makeStore({ apiBaseUrl: "/custom" });
    store.dispatch(settingsRequested());
    store.dispatch(settingsRequested());
    await waitFor(() =>
      expect(store.getState().settings).toMatchObject({ colorMode: "dark", density: "compact" }),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]![0].url).toBe(new URL("/custom/settings", location.href).href);
    expect(fetch.mock.calls[0]![0].method).toBe("GET");
  });

  it("does not overwrite edits made while startup settings are loading", async () => {
    const load = deferred<Response>();
    const patches: UpdateUserSettingsRequest[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: Request) => {
        if (request.method === "GET") return load.promise;
        patches.push((await request.json()) as UpdateUserSettingsRequest);
        return response({ colorMode: "light", density: "comfortable" });
      }),
    );
    const store = makeStore({});
    store.dispatch(settingsRequested());
    store.dispatch(colorModeChanged("light"));
    load.resolve(response({ colorMode: "dark", density: "compact" }));
    await waitFor(() =>
      expect(store.getState().settings).toMatchObject({ colorMode: "light", density: "compact" }),
    );
    await waitFor(() => expect(patches).toEqual([{ colorMode: "light" }]));
  });

  it("loads and saves the editor font size, keeping a size chosen during the load", async () => {
    const load = deferred<Response>();
    const patches: UpdateUserSettingsRequest[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: Request) => {
        if (request.method === "GET") return load.promise;
        patches.push((await request.json()) as UpdateUserSettingsRequest);
        return response({});
      }),
    );
    const store = makeStore({});
    store.dispatch(settingsRequested());
    store.dispatch(editorFontSizeChanged(20));
    load.resolve(response({ colorMode: "dark", density: "compact", editorFontSize: 16, noteFontSize: 13 }));
    await waitFor(() => expect(store.getState().settings.colorMode).toBe("dark"));
    expect(store.getState().settings.editorFontSize).toBe(20);
    await waitFor(() => expect(patches).toEqual([{ editorFontSize: 20 }]));

    const untouched = makeStore({});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response({ colorMode: "dark", density: "compact", editorFontSize: 16, noteFontSize: 13 })),
    );
    untouched.dispatch(settingsRequested());
    await waitFor(() => expect(untouched.getState().settings.editorFontSize).toBe(16));
  });

  it("retries a failed editor font size save", async () => {
    const patches: UpdateUserSettingsRequest[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: Request) => {
        patches.push((await request.json()) as UpdateUserSettingsRequest);
        return patches.length === 1 ? response({}, 500) : response({});
      }),
    );
    const store = makeStore({});
    store.dispatch(editorFontSizeChanged(18));
    await waitFor(() => expect(store.getState().settings.saveError).toBe(true));
    store.dispatch(settingsSaveRetried());
    await waitFor(() => expect(store.getState().settings.saveError).toBe(false));
    expect(patches).toEqual([{ editorFontSize: 18 }, { editorFontSize: 18 }]);
  });

  it("saves partial edits in order, then a new panel loads the saved settings", async () => {
    let saved: UserSettingsDto = {
      colorMode: "system",
      density: "comfortable",
      editorFontSize: 13,
      noteFontSize: 13,
      splitterSizes: {},
    };
    const first = deferred<void>();
    const patches: UpdateUserSettingsRequest[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: Request) => {
        if (request.method === "GET") return response(saved);
        const patch = (await request.json()) as UpdateUserSettingsRequest;
        patches.push(patch);
        if (patches.length === 1) await first.promise;
        saved = { ...saved, ...patch };
        return response(saved);
      }),
    );
    const store = makeStore({});
    store.dispatch(colorModeChanged("dark"));
    store.dispatch(colorModeChanged("light"));
    store.dispatch(densityChanged("compact"));
    await waitFor(() => expect(patches).toEqual([{ colorMode: "dark" }]));
    first.resolve();
    await waitFor(() =>
      expect(saved).toEqual({
        colorMode: "light",
        density: "compact",
        editorFontSize: 13,
        noteFontSize: 13,
        splitterSizes: {},
      }),
    );
    expect(patches).toEqual([
      { colorMode: "dark" },
      { colorMode: "light" },
      { density: "compact" },
    ]);
    const reopened = makeStore({ instanceId: "another-panel" });
    reopened.dispatch(settingsRequested());
    await waitFor(() => expect(reopened.getState().settings).toMatchObject(saved));
  });

  it("reports failures and retries loading and saving without losing edits", async () => {
    let available = false;
    const patches: UpdateUserSettingsRequest[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: Request) => {
        if (!available) return response({ message: "Unavailable" }, 503);
        if (request.method === "PATCH")
          patches.push((await request.json()) as UpdateUserSettingsRequest);
        return response({ colorMode: "system", density: "comfortable", editorFontSize: 13, noteFontSize: 13 });
      }),
    );
    const store = makeStore({});
    store.dispatch(settingsRequested());
    store.dispatch(colorModeChanged("dark"));
    await waitFor(() =>
      expect(store.getState().settings).toMatchObject({ loadError: true, saveError: true }),
    );
    available = true;
    store.dispatch(settingsRequested());
    store.dispatch(settingsSaveRetried());
    await waitFor(() =>
      expect(store.getState().settings).toEqual({
        colorMode: "dark",
        density: "comfortable",
        editorFontSize: 13,
        noteFontSize: 13,
        splitterSizes: {},
        loadError: false,
        saveError: false,
      }),
    );
    expect(patches).toEqual([{ colorMode: "dark" }]);
  });

  it("merges loaded splitter sizes under local moves, saves one splitter and retries", async () => {
    const load = deferred<Response>();
    let available = false;
    const patches: UpdateUserSettingsRequest[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (request: Request) => {
        if (request.method === "GET") return load.promise;
        patches.push((await request.json()) as UpdateUserSettingsRequest);
        if (!available) return response({ message: "Unavailable" }, 503);
        return response({
          colorMode: "system",
          density: "comfortable",
          editorFontSize: 13,
          noteFontSize: 13,
          splitterSizes: {},
        });
      }),
    );
    const store = makeStore({});
    store.dispatch(settingsRequested());
    store.dispatch(splitterSizesChanged({ id: "files", sizes: [0.6, 0.4] }));
    load.resolve(
      response({
        colorMode: "system",
        density: "comfortable",
        editorFontSize: 13,
        noteFontSize: 13,
        splitterSizes: { files: [0.8, 0.2], notes: [0.3, 0.7] },
      }),
    );
    await waitFor(() =>
      expect(store.getState().settings.splitterSizes).toEqual({
        files: [0.6, 0.4],
        notes: [0.3, 0.7],
      }),
    );
    await waitFor(() => expect(store.getState().settings.saveError).toBe(true));
    available = true;
    store.dispatch(settingsSaveRetried());
    await waitFor(() => expect(store.getState().settings.saveError).toBe(false));
    expect(patches).toEqual([
      { splitterSizes: { files: [0.6, 0.4] } },
      { splitterSizes: { files: [0.6, 0.4], notes: [0.3, 0.7] } },
    ]);
  });
});
