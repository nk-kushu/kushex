import { PluginCatalog } from "../plugins/PluginCatalog.js";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pino } from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  AgentRunDto,
  AgentRunEventDto,
  DebugValueDto,
  DebugVariableDto,
  ProjectDto,
} from "@kushex/contracts";
import { InMemoryProjectRepository } from "../../../tests/support/InMemoryProjectRepository.js";
import { WorkspaceFixture } from "../../../tests/support/WorkspaceFixture.js";
import { ErrorResponder } from "../../transport/http/ErrorResponder.js";
import { HttpServer } from "../../transport/http/HttpServer.js";
import { LocalOperatorActorResolver } from "../../transport/http/LocalOperatorActorResolver.js";
import { LocalRequestGuard } from "../../transport/http/LocalRequestGuard.js";
import { RequestContextFactory } from "../../transport/http/RequestContextFactory.js";
import { AgentService, AgentTemplate, KushibotTypesReader } from "../agents/public.js";
import { ProjectService } from "../projects/public.js";
import {
  LocalWorkspaceFileSystem,
  WorkspacePathResolver,
  WorkspaceService,
} from "../workspaces/public.js";
import { AgentRunService, AgentRunsController, ChildProcessAgentLauncher } from "./public.js";

/** Types and blank lines on purpose: the source lines differ from the generated ones. */
const ECHO_AGENT = `import { shout } from "./shout";

interface ChatRequest {
  readonly message: string;
  readonly files: readonly string[];
  progress(message: string): void;
}

export async function chat(request: ChatRequest): Promise<{ answer: string }> {
  request.progress("splitting");
  const words: string[] = request.message.split(" ");

  const answer = shout(words);
  console.log("answered", answer);
  return { answer };
}
`;
const SHOUT = `type Words = readonly string[];

export function shout(words: Words): string {
  const loud = words.map((word) => word.toUpperCase());
  return loud.join(" ");
}
`;

let fixture: WorkspaceFixture;
let agentsDirectory: string;
let echo: string;
let service: AgentRunService;
let server: HttpServer;
let base: string;
let project: ProjectDto;
const headers = { "content-type": "application/json" };

beforeEach(async () => {
  fixture = await WorkspaceFixture.create();
  agentsDirectory = await mkdtemp(path.join(tmpdir(), "kushex-run-agents-"));
  // As in the repository's agents/: agent sources are ES modules.
  await writeFile(path.join(agentsDirectory, "package.json"), '{ "type": "module" }\n');
  const external = path.join(agentsDirectory, "plugins/development");
  echo = path.join(external, "sources/echo-source");
  await mkdir(echo, { recursive: true });
  await writeFile(path.join(echo, "agent.ts"), ECHO_AGENT);
  await writeFile(path.join(echo, "shout.ts"), SHOUT);
  await mkdir(path.join(agentsDirectory, "silent"));
  await writeFile(path.join(agentsDirectory, "silent/agent.ts"), "export default {};\n");
  await writeFile(
    path.join(external, "kushex-plugin.json"),
    JSON.stringify({
      id: "development",
      name: "Development Agents",
      version: "1.0.0",
      apiVersion: 1,
      agents: [{ id: "echo", name: "Echo", directory: "sources/echo-source", entry: "agent.ts" }],
    }),
  );
  const catalog = new PluginCatalog(agentsDirectory, path.join(agentsDirectory, "plugins"));
  await catalog.start();
  const repository = new InMemoryProjectRepository();
  const paths = new WorkspacePathResolver(fixture.roots);
  const workspaces = new WorkspaceService(repository, new LocalWorkspaceFileSystem(paths));
  const contexts = new RequestContextFactory(new LocalOperatorActorResolver());
  const logger = pino({ level: "silent" });
  service = new AgentRunService(
    workspaces,
    paths,
    new AgentService(catalog, new AgentTemplate(), new KushibotTypesReader(null)),
    new ChildProcessAgentLauncher(null, logger),
  );
  project = await new ProjectService(repository, workspaces).create(
    { requestId: "test", actor: { id: "local-operator" } },
    { name: "Alpha", path: "root/alpha" },
  );
  server = new HttpServer(
    { host: "127.0.0.1", port: 0 },
    logger,
    new ErrorResponder(logger),
    [new AgentRunsController(service, contexts)],
    new LocalRequestGuard([]),
  );
  await server.start();
  base = `http://127.0.0.1:${server.port}`;
});
afterEach(async () => {
  await service?.stop();
  await server?.stop(new AbortController().signal);
  await fixture?.remove();
  await rm(agentsDirectory, { recursive: true, force: true });
});

async function launch(body: object): Promise<AgentRunDto> {
  const response = await fetch(`${base}/projects/${project.id}/agent-runs`, {
    method: "POST",
    headers,
    body: JSON.stringify({ files: [], debug: false, ...body }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as AgentRunDto;
}

/** Reads the run's server-sent events; `next` waits for the first event matching a test. */
function events(runId: string) {
  const received: AgentRunEventDto[] = [];
  const waiters: {
    test: (event: AgentRunEventDto) => boolean;
    resolve: (event: AgentRunEventDto) => void;
  }[] = [];
  let read = 0;
  const controller = new AbortController();
  const drain = () => {
    for (const waiter of [...waiters]) {
      const index = received.findIndex((event, at) => at >= read && waiter.test(event));
      if (index < 0) continue;
      read = index + 1;
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve(received[index]!);
    }
  };

  void (async () => {
    const response = await fetch(`${base}/agent-runs/${runId}/events`, {
      signal: controller.signal,
    });
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of response.body!) {
      buffer += decoder.decode(chunk as Uint8Array, { stream: true });
      let end;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = block.split("\n").find((line) => line.startsWith("data: "));
        if (!data) continue;
        received.push(JSON.parse(data.slice(6)) as AgentRunEventDto);
        drain();
      }
    }
  })().catch(() => undefined);
  return {
    received,
    close: () => controller.abort(),
    next<T extends AgentRunEventDto["type"]>(
      type: T,
      test: (event: Extract<AgentRunEventDto, { type: T }>) => boolean = () => true,
    ) {
      return new Promise<Extract<AgentRunEventDto, { type: T }>>((resolve) => {
        waiters.push({
          test: (event) =>
            event.type === type && test(event as Extract<AgentRunEventDto, { type: T }>),
          resolve: resolve as (event: AgentRunEventDto) => void,
        });
        drain();
      });
    },
  };
}

const post = (url: string, body: object) =>
  fetch(`${base}${url}`, { method: "POST", headers, body: JSON.stringify(body) });

describe("agent runs", () => {
  it("runs an agent's chat export and streams its progress, output and result", async () => {
    const run = await launch({ agentName: "echo", message: "hello world" });
    expect(run).toMatchObject({ agentName: "echo", debug: false, projectId: project.id });
    const stream = events(run.id);
    expect(await stream.next("progress")).toEqual({ type: "progress", message: "splitting" });
    expect(await stream.next("result")).toEqual({
      type: "result",
      value: { answer: "HELLO WORLD" },
      truncated: false,
    });
    await stream.next("status", (event) => event.status === "completed");
    expect(stream.received).toContainEqual({
      type: "output",
      stream: "stdout",
      text: "answered HELLO WORLD\n",
    });
    stream.close();
  });

  it("fails a run whose agent does not export chat", async () => {
    const run = await launch({ agentName: "silent", message: "hi" });
    const stream = events(run.id);
    expect((await stream.next("error")).message).toMatch(/does not export a `chat` function/);
    await stream.next("status", (event) => event.status === "failed");
    stream.close();
  });

  it("stops at a TypeScript breakpoint and inspects, steps and resumes like an IDE", async () => {
    const run = await launch({
      agentName: "echo",
      message: "hello world",
      debug: true,
      breakpoints: { "agent.ts": [12, 13] },
    });
    const stream = events(run.id);
    // Line 12 is blank, so that breakpoint moves to the next line with code.
    const bound = await stream.next("breakpoints", (event) =>
      event.breakpoints.every((b) => b.verified),
    );
    expect(bound.breakpoints).toEqual([
      { file: "agent.ts", requestedLine: 12, line: 13, verified: true },
      { file: "agent.ts", requestedLine: 13, line: 13, verified: true },
    ]);

    const paused = await stream.next("paused");
    expect(paused.reason).toBe("breakpoint");
    const [top] = paused.frames;
    expect(top).toMatchObject({ name: "chat", location: { file: "agent.ts", line: 13 } });
    // Node's own frames (promise queues, module loading) are left out below the top.
    expect(paused.frames.slice(1).some((frame) => frame.location.url.startsWith("node:"))).toBe(
      false,
    );
    const local = top!.scopes.find((scope) => scope.type === "local")!;
    const variables = (await (
      await fetch(`${base}/agent-runs/${run.id}/variables?ref=${encodeURIComponent(local.ref!)}`)
    ).json()) as { entries: DebugVariableDto[] };
    expect(variables.entries).toContainEqual(
      expect.objectContaining({ name: "words", value: 'Array(2) ["hello", "world"]' }),
    );
    const evaluated = (await (
      await post(`/agent-runs/${run.id}/evaluate`, {
        expression: "words.length * 10",
        frameId: top!.id,
      })
    ).json()) as DebugValueDto;
    expect(evaluated).toEqual({ type: "number", value: "20", ref: null });

    expect((await post(`/agent-runs/${run.id}/debug`, { command: "stepInto" })).status).toBe(204);
    const stepped = await stream.next("paused");
    expect(stepped.reason).toBe("step");
    expect(stepped.frames[0]).toMatchObject({
      name: "shout",
      location: { file: "shout.ts", line: 4 },
    });
    expect(stepped.frames[1]).toMatchObject({
      name: "chat",
      location: { file: "agent.ts", line: 13 },
    });

    // Breakpoints can change while the run is paused.
    const replaced = await fetch(`${base}/agent-runs/${run.id}/breakpoints`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ file: "shout.ts", lines: [5] }),
    });
    expect(await replaced.json()).toEqual({
      breakpoints: [{ file: "shout.ts", requestedLine: 5, line: 5, verified: true }],
    });
    await post(`/agent-runs/${run.id}/debug`, { command: "continue" });
    const atReturn = await stream.next("paused");
    expect(atReturn.frames[0]).toMatchObject({ location: { file: "shout.ts", line: 5 } });

    await post(`/agent-runs/${run.id}/debug`, { command: "continue" });
    expect((await stream.next("result")).value).toEqual({ answer: "HELLO WORLD" });
    await stream.next("status", (event) => event.status === "completed");
    stream.close();
  });

  it("pauses on the first guard in chat before it throws for missing files", async () => {
    const source = `import { shout } from "./shout";

interface ChatRequest { readonly files: readonly string[]; }

export async function chat(request: ChatRequest) {
  if (request.files.length === 0)
    throw new Error("Attach the files the coding agent may read and change (up to 16).");
  return shout(request.files);
}
`;
    await writeFile(path.join(echo, "agent.ts"), source);
    const line = source.split("\n").findIndex((text) => text.includes("if (request.files")) + 1;
    const run = await launch({
      agentName: "echo",
      message: "inspect",
      debug: true,
      breakpoints: { "agent.ts": [line] },
    });
    const stream = events(run.id);
    const paused = await stream.next("paused");
    expect(paused.reason).toBe("breakpoint");
    expect(paused.frames[0]).toMatchObject({ name: "chat", location: { file: "agent.ts", line } });
    await post(`/agent-runs/${run.id}/debug`, { command: "continue" });
    expect((await stream.next("error")).message).toContain("Attach the files");
    await stream.next("status", (event) => event.status === "failed");
    stream.close();
  });

  it("cancels a run paused at a breakpoint", async () => {
    const run = await launch({
      agentName: "echo",
      message: "hello",
      debug: true,
      breakpoints: { "shout.ts": [4] },
    });
    const stream = events(run.id);
    await stream.next("paused");
    expect((await post(`/agent-runs/${run.id}/cancel`, {})).status).toBe(204);
    await stream.next("status", (event) => event.status === "cancelled");
    stream.close();
  });

  it("allows one debug session at a time", async () => {
    await launch({
      agentName: "echo",
      message: "a",
      debug: true,
      breakpoints: { "shout.ts": [4] },
    });
    const second = await fetch(`${base}/projects/${project.id}/agent-runs`, {
      method: "POST",
      headers,
      body: JSON.stringify({ agentName: "echo", message: "b", files: [], debug: true }),
    });
    expect(second.status).toBe(409);
  });
});
