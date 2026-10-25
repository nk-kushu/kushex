import { request as httpRequest } from "node:http";
import { rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProjectDto } from "@kushex/contracts";
import { InMemoryProjectRepository } from "../../../tests/support/InMemoryProjectRepository.js";
import { WorkspaceFixture } from "../../../tests/support/WorkspaceFixture.js";
import { ErrorResponder } from "../../transport/http/ErrorResponder.js";
import { HttpServer } from "../../transport/http/HttpServer.js";
import { LocalRequestGuard } from "../../transport/http/LocalRequestGuard.js";
import { LocalOperatorActorResolver } from "../../transport/http/LocalOperatorActorResolver.js";
import { RequestContextFactory } from "../../transport/http/RequestContextFactory.js";
import { ProjectService, ProjectsController } from "../projects/public.js";
import {
  LocalWorkspaceFileSystem,
  LocationsController,
  WorkspacePathResolver,
  WorkspaceService,
} from "../workspaces/public.js";
import { FileService, FilesController } from "./public.js";

let fixture: WorkspaceFixture;
let repository: InMemoryProjectRepository;
let server: HttpServer;
let base: string;
const origin = "http://localhost:5173";
const jsonHeaders = { "content-type": "application/json", origin };
beforeEach(async () => {
  fixture = await WorkspaceFixture.create();
  repository = new InMemoryProjectRepository();
  const filesystem = new LocalWorkspaceFileSystem(new WorkspacePathResolver(fixture.roots), 64, 500);
  const workspaces = new WorkspaceService(repository, filesystem);
  const contexts = new RequestContextFactory(new LocalOperatorActorResolver());
  const logger = pino({ level: "silent" });
  server = new HttpServer(
    { host: "127.0.0.1", port: 0 },
    logger,
    new ErrorResponder(logger),
    [
      new ProjectsController(new ProjectService(repository, workspaces), contexts),
      new LocationsController(workspaces, contexts),
      new FilesController(new FileService(workspaces, filesystem), contexts),
    ],
    new LocalRequestGuard([origin]),
  );
  await server.start();
  base = `http://127.0.0.1:${server.port}`;
});
afterEach(async () => {
  await server?.stop(new AbortController().signal);
  await fixture?.remove();
});
async function create(): Promise<ProjectDto> {
  const response = await fetch(`${base}/projects`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ name: " Alpha ", path: "root/alpha" }),
  });
  expect(response.status).toBe(201);
  return response.json() as Promise<ProjectDto>;
}

describe("projects and files over HTTP", () => {
  it("creates a project, lists it, lazily lists its tree and reads its content", async () => {
    const locations = await fetch(`${base}/locations`);
    expect(await locations.json()).toMatchObject({
      entries: expect.arrayContaining([
        { name: "alpha", path: "root/alpha", kind: "directory" },
        { name: "gamma", path: "other/gamma", kind: "directory" },
      ]),
    });
    const project = await create();
    expect(project).toMatchObject({
      name: "Alpha",
      workspace: { path: "root/alpha", branch: null, revision: null },
    });
    expect(await (await fetch(`${base}/projects`)).json()).toMatchObject({ entries: [project] });
    expect(await (await fetch(`${base}/projects/${project.id}`)).json()).toEqual(project);
    const tree = await fetch(`${base}/projects/${project.id}/tree?path=src`);
    expect(tree.headers.get("cache-control")).toBe("no-store");
    expect(tree.headers.get("x-request-id")).toBeTruthy();
    expect(await tree.json()).toEqual({
      entries: [{ name: "index.ts", path: "src/index.ts", kind: "file" }],
      nextOffset: null,
    });
    expect(
      await (await fetch(`${base}/projects/${project.id}/file?path=src%2Findex.ts`)).json(),
    ).toMatchObject({ kind: "text", content: "export const answer = 42;\n" });
  });
  it("keeps a durable project when its checkout disappears", async () => {
    const project = await create();
    await rm(path.join(fixture.root, "alpha"), { recursive: true });
    expect((await fetch(`${base}/projects/${project.id}/tree`)).status).toBe(404);
    expect(await (await fetch(`${base}/projects`)).json()).toMatchObject({ entries: [project] });
  });
  it("maps unsafe, missing, binary and oversized reads without leaking disk paths", async () => {
    const project = await create();
    for (const input of [
      "../beta/secret.txt",
      "sibling/secret.txt",
      "/etc/passwd",
      ".git/config",
    ]) {
      const response = await fetch(
        `${base}/projects/${project.id}/file?path=${encodeURIComponent(input)}`,
      );
      expect(response.status).toBe(403);
      const error = await response.json();
      expect(error).toMatchObject({ code: "FORBIDDEN" });
      expect(JSON.stringify(error)).not.toContain(fixture.root);
    }
    expect((await fetch(`${base}/projects/${project.id}/file?path=missing`)).status).toBe(404);
    expect(
      await (await fetch(`${base}/projects/${project.id}/file?path=image.bin`)).json(),
    ).toEqual({ path: "image.bin", size: 3, kind: "binary" });
    const large = await fetch(`${base}/projects/${project.id}/file?path=large.txt`);
    expect(large.status).toBe(413);
    expect(await large.json()).toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
      details: [{ size: 80, maxBytes: 64 }],
    });
  });
  it("validates input before persistence and scopes workspace reads to the actor", async () => {
    const invalid = await fetch(`${base}/projects`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ name: "", path: "root/alpha" }),
    });
    expect(invalid.status).toBe(400);
    const escape = await fetch(`${base}/projects`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ name: "Escape", path: "root/escape" }),
    });
    expect(escape.status).toBe(403);
    expect(await repository.list("local-operator", 0)).toEqual({ entries: [], nextOffset: null });
    const other = await repository.create("someone-else", { name: "Other", path: "root/alpha" });
    expect((await fetch(`${base}/projects/${other.id}/tree`)).status).toBe(404);
    expect((await fetch(`${base}/projects/${other.id}`)).status).toBe(404);
    expect((await fetch(`${base}/projects/${randomUUID()}/file?path=empty.txt`)).status).toBe(404);
    expect((await fetch(`${base}/projects/not-an-id/tree`)).status).toBe(400);
  });
  it("rejects foreign origins, DNS-rebinding hosts and browser-simple mutations", async () => {
    for (const headers of [
      { ...jsonHeaders, origin: "https://evil.example" },
      { ...jsonHeaders, origin: "null" },
      { ...jsonHeaders, host: "evil.example" },
      { ...jsonHeaders, "sec-fetch-site": "cross-site" },
    ]) {
      const status = await new Promise<number>((resolve, reject) => {
        const request = httpRequest(`${base}/projects`, { method: "POST", headers }, (response) => {
          response.resume();
          resolve(response.statusCode ?? 0);
        });
        request.on("error", reject);
        request.end(JSON.stringify({ name: "Attack", path: "root/alpha" }));
      });
      expect(status, JSON.stringify(headers)).toBe(403);
    }
    expect(
      (
        await fetch(`${base}/projects`, {
          method: "POST",
          headers: { origin, "content-type": "text/plain" },
          body: "{}",
        })
      ).status,
    ).toBe(415);
    expect(await repository.list("local-operator", 0)).toEqual({ entries: [], nextOffset: null });
    // Native clients can omit Origin but still must use JSON and a trusted Host.
    expect(
      (
        await fetch(`${base}/projects`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "CLI", path: "root/alpha" }),
        })
      ).status,
    ).toBe(201);
  });
});
