import type { UserSettingsDto, UpdateUserSettingsRequest } from "@kushex/contracts";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HttpServer } from "../../transport/http/HttpServer.js";
import { ErrorResponder } from "../../transport/http/ErrorResponder.js";
import { LocalRequestGuard } from "../../transport/http/LocalRequestGuard.js";
import { RequestContextFactory } from "../../transport/http/RequestContextFactory.js";
import { SettingsService, SettingsController, type SettingsRepository } from "./public.js";

class MemorySettingsRepository implements SettingsRepository {
  readonly rows = new Map<string, UserSettingsDto>();
  async find(actorId: string): Promise<UserSettingsDto | null> {
    return this.rows.get(actorId) ?? null;
  }
  async update(actorId: string, input: UpdateUserSettingsRequest): Promise<UserSettingsDto> {
    const saved = this.rows.get(actorId);
    const settings = {
      colorMode: "system" as const,
      density: "comfortable" as const,
      editorFontSize: 13,
      noteFontSize: 13,
      ...saved,
      ...input,
      splitterSizes: { ...saved?.splitterSizes, ...input.splitterSizes },
    };
    this.rows.set(actorId, settings);
    return settings;
  }
}

let server: HttpServer;
let base: string;
let actorId: string;
let repository: MemorySettingsRepository;
const headers = { "content-type": "application/json" };

beforeEach(async () => {
  actorId = "first-user";
  repository = new MemorySettingsRepository();
  const logger = pino({ level: "silent" });
  server = new HttpServer(
    { host: "127.0.0.1", port: 0 },
    logger,
    new ErrorResponder(logger),
    [
      new SettingsController(
        new SettingsService(repository),
        new RequestContextFactory({ resolve: () => ({ id: actorId }) }),
      ),
    ],
    new LocalRequestGuard([]),
  );
  await server.start();
  base = `http://127.0.0.1:${server.port}/settings`;
});
afterEach(async () => {
  await server?.stop(new AbortController().signal);
});

async function patch(body: unknown, extraHeaders = {}) {
  return fetch(base, {
    method: "PATCH",
    headers: { ...headers, ...extraHeaders },
    body: JSON.stringify(body),
  });
}

describe("user settings HTTP API", () => {
  it("returns defaults without writing and preserves omitted fields on update", async () => {
    const initial = await fetch(base);
    expect(initial.headers.get("cache-control")).toBe("no-store");
    expect(await initial.json()).toEqual({ colorMode: "system", density: "comfortable", editorFontSize: 13, noteFontSize: 13, splitterSizes: {} });
    expect(repository.rows.size).toBe(0);
    const response = await patch({ colorMode: "dark" });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ colorMode: "dark", density: "comfortable", editorFontSize: 13, noteFontSize: 13, splitterSizes: {} });
    expect(await (await patch({ density: "compact" })).json()).toEqual({
      colorMode: "dark",
      density: "compact",
      editorFontSize: 13,
      noteFontSize: 13,
      splitterSizes: {},
    });
    expect(await (await fetch(base)).json()).toEqual({ colorMode: "dark", density: "compact", editorFontSize: 13, noteFontSize: 13, splitterSizes: {} });
  });
  it("uses the request actor and isolates users", async () => {
    await patch({ colorMode: "dark" });
    actorId = "second-user";
    expect(await (await fetch(base)).json()).toEqual({
      colorMode: "system",
      density: "comfortable",
      editorFontSize: 13,
      noteFontSize: 13,
      splitterSizes: {},
    });
    await patch({ density: "compact" });
    actorId = "first-user";
    expect(await (await fetch(base)).json()).toEqual({ colorMode: "dark", density: "comfortable", editorFontSize: 13, noteFontSize: 13, splitterSizes: {} });
  });
  it("merges splitter sizes by id", async () => {
    await patch({ splitterSizes: { "workbench:side-main-chat": [0.2, 0.5, 0.3] } });
    await patch({ splitterSizes: { files: [0.7, 0.3] } });
    const response = await patch({ splitterSizes: { files: [0.6, 0.4] } });
    expect(((await response.json()) as UserSettingsDto).splitterSizes).toEqual({
      "workbench:side-main-chat": [0.2, 0.5, 0.3],
      files: [0.6, 0.4],
    });
  });
  it.each([10, 28])("saves note font size %i, keeping omitted settings", async (noteFontSize) => {
    await patch({ editorFontSize: 18 });
    const response = await patch({ noteFontSize });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      colorMode: "system",
      density: "comfortable",
      editorFontSize: 18,
      noteFontSize,
      splitterSizes: {},
    });
  });
  it.each([10, 28])("saves editor font size %i, keeping omitted settings", async (editorFontSize) => {
    await patch({ colorMode: "dark" });
    const response = await patch({ editorFontSize });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      colorMode: "dark",
      density: "comfortable",
      editorFontSize,
      noteFontSize: 13,
      splitterSizes: {},
    });
  });
  it.each([
    {},
    { editorFontSize: 9 },
    { editorFontSize: 29 },
    { editorFontSize: 13.5 },
    { editorFontSize: "14" },
    { editorFontSize: null },
    { noteFontSize: 9 },
    { noteFontSize: 29 },
    { noteFontSize: 13.5 },
    { noteFontSize: "14" },
    { noteFontSize: null },
    { splitterSizes: { files: [0.5] } },
    { splitterSizes: { files: [1.5, -0.5] } },
    { splitterSizes: { "Bad Id": [0.5, 0.5] } },
    { splitterSizes: [0.5, 0.5] },
    { colorMode: "blue" },
    { density: "dense" },
    { colorMode: null },
    { actorId: "victim", colorMode: "dark" },
    { unknown: true },
  ])("rejects invalid settings: %j", async (body) => {
    expect((await patch(body)).status).toBe(400);
    expect(repository.rows.size).toBe(0);
  });
  it("applies the existing mutation origin and content-type guards", async () => {
    expect((await patch({ colorMode: "dark" }, { origin: "https://foreign.example" })).status).toBe(
      403,
    );
    expect((await patch({ colorMode: "dark" }, { "content-type": "text/plain" })).status).toBe(415);
    expect(repository.rows.size).toBe(0);
  });
});
