import { vi } from "vitest";
import type { FileContentDto, ProjectDto } from "@kushex/contracts";

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

/** An HTTP boundary fixture; the real RTK Query middleware still runs. */
export function mockKushexApi(initialProjects: ProjectDto[] = [exampleProject]) {
  const projects = [...initialProjects];
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
  return { fetch, files, projects };
}
