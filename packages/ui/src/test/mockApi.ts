import { vi } from "vitest";
import type {
  AgentDto,
  AgentFileDto,
  FileContentDto,
  ProjectDto,
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
) {
  const projects = [...initialProjects];
  const agents = new Map(initialAgents.map((agent) => [agent.name, agent]));
  let revisions = 0;
  let settings: UserSettingsDto = { colorMode: "system", density: "comfortable", splitterSizes: {} };
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
    if (route === "/agents" && request.method === "POST") {
      const { name } = (await request.json()) as { name: string };
      if (agents.has(name))
        return respond({ code: "CONFLICT", message: `An agent named "${name}" already exists.` }, 409);
      const agent: AgentDto = {
        ...exampleAgent,
        name,
        files: [textFile("agent.ts", `export default { name: "${name}" };\n`)],
      };
      agents.set(name, agent);
      return respond(agent, 201);
    }
    if (route === "/agents")
      return respond({
        entries: [...agents.values()].map(({ name, updatedAt }) => ({ name, updatedAt })),
        nextOffset: null,
      });
    const agentRoute = /^\/agents\/([^/]+)(\/files)?$/.exec(route);
    if (agentRoute) {
      const agent = agents.get(decodeURIComponent(agentRoute[1]!));
      if (!agent) return respond({ code: "NOT_FOUND", message: "Agent not found." }, 404);
      if (!agentRoute[2]) return respond(agent);
      const body = (await request.json()) as { path: string; content?: string; baseRevision?: string };
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
  return { fetch, files, projects, agents };
}
