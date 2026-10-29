import { vi } from "vitest";
import type {
  AgentDto,
  PluginDto,
  CodingProposalReviewDto,
  AgentFileDto,
  AgentRunDto,
  AgentRunEventDto,
  DebugVariableDto,
  FileContentDto,
  ProjectDto,
  RecordedDebugEventDto,
  UserSettingsDto,
} from "@kushex/contracts";

export const exampleProject: ProjectDto = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Project one",
  description: null,
  createdAt: "2026-10-23T00:00:00.000Z",
  workspace: {
    id: "22222222-2222-4222-8222-222222222222",
    path: "alpha",
    branch: null,
    revision: null,
  },
};

export const textFile = (path: string, content: string, revision = "a"): AgentFileDto => ({
  path,
  kind: "text",
  content,
  revision: revision.repeat(64 / revision.length),
  size: content.length,
  updatedAt: "2026-10-25T00:00:00.000Z",
});

export const exampleAgent: AgentDto = {
  name: "reviewer",
  primaryFile: "agent.ts",
  updatedAt: "2026-10-25T00:00:00.000Z",
  files: [
    textFile("agent.ts", 'import prompt from "./prompts/review.js";\nexport default { prompt };\n'),
    { path: "logo.png", kind: "binary", size: 4, updatedAt: "2026-10-25T00:00:00.000Z" },
    textFile("prompts/review.ts", 'export default "Review carefully.";\n', "b"),
  ],
};

/** An HTTP boundary fixture; the real RTK Query middleware still runs. */
export function mockKushexApi(
  initialProjects: ProjectDto[] = [exampleProject],
  initialAgents: AgentDto[] = [],
  initialNotes: Record<string, string> = {},
  initialPlugins: PluginDto[] = [],
) {
  const projects = [...initialProjects];
  const agents = new Map(initialAgents.map((agent) => [agent.name, agent]));
  let revisions = 0;
  /** Code notes documents by agent name, as the database keeps them. */
  const notes = new Map(
    Object.entries(initialNotes).map(([name, content]) => [name, { content, revision: 1 }]),
  );
  /** Bodies of started agent runs, in order. */
  const runs: Record<string, unknown>[] = [];
  const proposals: Record<string, CodingProposalReviewDto> = {};
  const proposalApplies: { runId: string; digest: string }[] = [];
  const proposalChecks: { runId: string; digest: string }[] = [];
  const threads: {
    id: string;
    projectId: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    turns: unknown[];
  }[] = [];
  const debugRequests: {
    runId: string;
    action: string;
    body: Record<string, unknown> | null;
    ref: string | null;
  }[] = [];
  /** Stored kushibot debug events by run id; a cursor is how many the client has. */
  const debugEvents: Record<string, RecordedDebugEventDto[]> = {};
  /** Properties the debugger lists, by object ref. */
  const variables: Record<string, DebugVariableDto[]> = {};
  let settings: UserSettingsDto = {
    colorMode: "system",
    density: "comfortable",
    splitterSizes: {},
  };
  const files: Record<string, FileContentDto> = {
    "src/index.ts": {
      path: "src/index.ts",
      kind: "text",
      content: "export const answer = 42;",
      size: 25,
    },
    "image.bin": { path: "image.bin", kind: "binary", size: 3 },
  };
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const request = input instanceof Request ? input : new Request(input);
    const url = new URL(request.url);
    const route = url.pathname.replace(/^\/api/, "");
    const respond = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { "content-type": "application/json" },
      });
    if (route === "/settings") {
      if (request.method === "PATCH") {
        const patch = (await request.json()) as Partial<UserSettingsDto>;
        settings = {
          ...settings,
          ...patch,
          splitterSizes: { ...settings.splitterSizes, ...patch.splitterSizes },
        };
      }
      return respond(settings);
    }
    if (route === "/kushibot/types")
      return respond({
        packageName: "kushibot",
        version: "0.0.0",
        files: [{ path: "index.d.ts", content: "export declare const ok: true;" }],
      });
    if (route === "/plugins") return respond({ entries: initialPlugins, nextOffset: null });
    if (route === "/agents")
      return respond({
        entries: [...agents.values()].map(
          ({ name, updatedAt, displayName, description, plugin }) => ({
            name,
            updatedAt,
            displayName,
            description,
            plugin,
          }),
        ),
        nextOffset: null,
      });
    const notesRoute = /^\/agents\/([^/]+)\/notes$/.exec(route);
    if (notesRoute) {
      const name = decodeURIComponent(notesRoute[1]!);
      if (!agents.has(name))
        return respond({ code: "NOT_FOUND", message: "Agent not found." }, 404);
      const stored = notes.get(name) ?? { content: "", revision: 0 };
      if (request.method !== "PUT") return respond(stored);
      const body = (await request.json()) as { content: string; baseRevision: number };
      if (body.baseRevision !== stored.revision)
        return respond({ code: "CONFLICT", message: "Notes changed since they were loaded." }, 409);
      const next = { content: body.content, revision: stored.revision + 1 };
      notes.set(name, next);
      return respond(next);
    }
    const agentRoute = /^\/agents\/([^/]+)(\/files)?$/.exec(route);
    if (agentRoute) {
      const agent = agents.get(decodeURIComponent(agentRoute[1]!));
      if (!agent) return respond({ code: "NOT_FOUND", message: "Agent not found." }, 404);
      if (!agentRoute[2]) return respond(agent);
      const body = (await request.json()) as {
        path: string;
        content?: string;
        baseRevision?: string;
      };
      const existing = agent.files.find((file) => file.path === body.path);
      let file: AgentFileDto;
      if (request.method === "POST") {
        if (existing) return respond({ code: "CONFLICT", message: "File already exists." }, 409);
        file = textFile(body.path, "", "c");
      } else {
        if (existing?.kind !== "text" || existing.revision !== body.baseRevision)
          return respond({ code: "CONFLICT", message: "File changed since it was opened." }, 409);
        revisions += 1;
        file = textFile(body.path, body.content!, String(revisions % 10));
      }
      agents.set(agent.name, {
        ...agent,
        files: [...agent.files.filter((entry) => entry.path !== body.path), file],
      });
      return respond(file, request.method === "POST" ? 201 : 200);
    }
    const threadRoute = /^\/projects\/([^/]+)\/chat-threads(?:\/([^/]+))?$/.exec(route);
    if (threadRoute) {
      const projectId = threadRoute[1]!;
      const id = threadRoute[2];
      if (request.method === "POST") {
        const date = new Date().toISOString();
        const thread = {
          id: `thread-${threads.length + 1}`,
          projectId,
          title: "New chat",
          createdAt: date,
          updatedAt: date,
          turns: [],
        };
        threads.push(thread);
        return respond(thread, 201);
      }
      if (request.method === "GET")
        return respond(
          id
            ? threads.find((thread) => thread.id === id)
            : threads.filter((thread) => thread.projectId === projectId),
        );
      if (request.method === "DELETE") {
        for (let index = threads.length - 1; index >= 0; index--)
          if (threads[index]!.projectId === projectId && (!id || threads[index]!.id === id))
            threads.splice(index, 1);
        return new Response(null, { status: 204 });
      }
    }
    const proposalRoute =
      /^\/projects\/([^/]+)\/agent-runs\/([^/]+)\/proposal(?:\/(apply|reconcile))?$/.exec(route);
    if (proposalRoute) {
      const runId = proposalRoute[2]!;
      const proposal = proposals[runId];
      if (!proposal)
        return respond({ code: "NOT_FOUND", message: "Coding proposal not found." }, 404);
      if (proposalRoute[3]) {
        const body = (await request.json()) as { digest: string };
        (proposalRoute[3] === "apply" ? proposalApplies : proposalChecks).push({
          runId,
          digest: body.digest,
        });
        if (body.digest !== proposal.digest)
          return respond({ code: "CONFLICT", message: "Proposal changed." }, 409);
        if (proposal.status === "ready" && proposalRoute[3] === "apply") {
          for (const change of proposal.changes) {
            if (change.after === null) delete files[change.path];
            else
              files[change.path] = {
                path: change.path,
                kind: "text",
                content: change.after,
                size: change.after.length,
              };
          }
          proposals[runId] = { ...proposal, status: "applied" };
        }
        return respond({
          status: proposal.status === "pending" ? "pending" : "recorded",
          effect:
            proposals[runId]!.status === "applied"
              ? { status: "published", receipt: {} }
              : proposal.status === "not-applied"
                ? { status: "not-applied", code: proposal.code }
                : null,
        });
      }
      return respond(request.method === "POST" ? { proposal: { id: proposal.id } } : proposal);
    }
    const startRun = /^\/projects\/([^/]+)\/agent-runs$/.exec(route);
    if (startRun && request.method === "POST") {
      const body = (await request.json()) as { agentName: string; debug: boolean };
      runs.push(body);
      const run: AgentRunDto = {
        id: `run-${runs.length}`,
        projectId: startRun[1]!,
        agentName: body.agentName,
        debug: body.debug,
        status: "starting",
        startedAt: "2026-10-26T00:00:00.000Z",
      };
      return respond(run, 201);
    }
    const debugEventsRoute = /^\/agent-runs\/([^/]+)\/debug-events$/.exec(route);
    if (debugEventsRoute) {
      const runId = debugEventsRoute[1]!;
      const stored = debugEvents[runId] ?? [];
      const after = Number(url.searchParams.get("after") ?? 0);
      return respond({
        run: {
          id: runId,
          projectId: exampleProject.id,
          agentName: "reviewer",
          status: "completed",
          startedAt: "2026-10-26T00:00:00.000Z",
        },
        recording: true,
        events: stored.slice(after),
        cursor: String(stored.length),
        more: false,
      });
    }
    const runRoute = /^\/agent-runs\/([^/]+)\/(debug|cancel|evaluate|variables|breakpoints)$/.exec(
      route,
    );
    if (runRoute) {
      const action = runRoute[2]!;
      const body =
        request.method === "GET" || action === "cancel"
          ? null
          : ((await request.json()) as Record<string, unknown>);
      debugRequests.push({ runId: runRoute[1]!, action, body, ref: url.searchParams.get("ref") });
      if (action === "variables")
        return respond({
          entries: variables[url.searchParams.get("ref") ?? ""] ?? [],
          nextOffset: null,
        });
      if (action === "evaluate")
        return respond({ type: "number", value: `${String(body?.expression)} = 2`, ref: null });
      if (action === "breakpoints") return respond({ breakpoints: [] });
      return new Response(null, { status: 204 });
    }
    if (route === "/projects" && request.method === "POST") {
      const body = (await request.json()) as { name: string; path: string };
      const project = {
        ...exampleProject,
        name: body.name,
        workspace: { ...exampleProject.workspace, path: body.path },
      };
      projects.push(project);
      return respond(project, 201);
    }
    if (route === "/projects") return respond({ entries: projects, nextOffset: null });
    if (route === "/locations")
      return respond({
        entries: [{ name: "alpha", path: "alpha", kind: "directory" }],
        nextOffset: null,
      });
    if (route.endsWith("/tree")) {
      const path = url.searchParams.get("path") ?? "";
      return respond({
        entries:
          path === "src"
            ? [{ name: "index.ts", path: "src/index.ts", kind: "file" }]
            : [
                { name: "src", path: "src", kind: "directory" },
                { name: "image.bin", path: "image.bin", kind: "file" },
                { name: "large.txt", path: "large.txt", kind: "file" },
              ],
        nextOffset: null,
      });
    }
    if (route.endsWith("/file")) {
      const path = url.searchParams.get("path") ?? "";
      if (path === "large.txt")
        return respond(
          { code: "PAYLOAD_TOO_LARGE", message: "File exceeds the 1048576 byte preview limit." },
          413,
        );
      return files[path]
        ? respond(files[path])
        : respond({ code: "NOT_FOUND", message: "File no longer exists." }, 404);
    }
    const project = projects.find((entry) => route === `/projects/${entry.id}`);
    return project
      ? respond(project)
      : respond({ code: "NOT_FOUND", message: "Project not found." }, 404);
  });
  vi.stubGlobal("fetch", fetch);
  return {
    fetch,
    files,
    projects,
    agents,
    notes,
    runs,
    proposals,
    proposalApplies,
    proposalChecks,
    threads,
    debugRequests,
    variables,
    debugEvents,
  };
}

/** Stands in for the browser's EventSource; tests push run events through `emit`. */
export class FakeEventSource {
  static readonly CLOSED = 2;
  static readonly instances: FakeEventSource[] = [];
  readyState = 1;
  onmessage: ((message: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string | URL) {
    FakeEventSource.instances.push(this);
  }
  emit(event: AgentRunEventDto) {
    this.onmessage?.(new MessageEvent("message", { data: JSON.stringify(event) }));
  }
  close() {
    this.readyState = FakeEventSource.CLOSED;
  }
  /** The stream of a run, e.g. `run-1`. */
  static of(runId: string): FakeEventSource {
    const source = FakeEventSource.instances.find((instance) =>
      String(instance.url).endsWith(`/agent-runs/${runId}/events`),
    );
    if (!source) throw new Error(`No event stream for ${runId}`);
    return source;
  }
}
