import type { BeforeMount } from "@monaco-editor/react";
import type { LibraryTypesDto, NodeTypesDto } from "@kushex/contracts";
import { languageForPath } from "../../shared/components/CodeEditor";

export type Monaco = Parameters<BeforeMount>[0];

/**
 * Monaco model path of a file in an agent folder. File URIs make relative imports between
 * the agent's files resolve, and `node_modules` resolution start at the root.
 */
export const agentFileUri = (name: string, path: string) => `file:///agents/${name}/${path}`;

/** Gives every text file of the agent a model, so imports between its files type-check. */
export function syncAgentModels(
  monaco: Monaco,
  name: string,
  files: Readonly<Record<string, string>>,
) {
  for (const [path, content] of Object.entries(files)) {
    const uri = monaco.Uri.parse(agentFileUri(name, path));
    const model = monaco.editor.getModel(uri);
    if (!model) monaco.editor.createModel(content, languageForPath(path), uri);
    else if (model.getValue() !== content) model.setValue(content);
  }
}

export function disposeAgentModels(monaco: Monaco, name: string) {
  const prefix = agentFileUri(name, "");
  for (const model of monaco.editor.getModels())
    if (model.uri.toString(true).startsWith(prefix)) model.dispose();
}

/**
 * Lets the editor type-check `import ... from "kushibot"` and Node's modules: declarations
 * are registered as `node_modules/<package>/...`, where Node resolution looks for them.
 * Monaco is one instance per page, so this replaces any previously registered set.
 */
export function configureAgentLanguage(
  monaco: Monaco,
  types: LibraryTypesDto | undefined,
  nodeTypes: NodeTypesDto | undefined,
) {
  const typescript = monaco.typescript;
  typescript.typescriptDefaults.setCompilerOptions({
    target: typescript.ScriptTarget.ESNext,
    module: typescript.ModuleKind.ESNext,
    moduleResolution: typescript.ModuleResolutionKind.NodeJs,
    strict: true,
    noEmit: true,
    allowNonTsExtensions: true,
    // Agents run on Node, where `import path from "node:path"` works.
    esModuleInterop: true,
    skipLibCheck: true,
  });
  // Without it the worker only sees the file being checked, so relative imports between
  // the agent's files fail with "Cannot find module" until something else syncs them.
  typescript.typescriptDefaults.setEagerModelSync(true);
  typescript.typescriptDefaults.setExtraLibs(
    [...(types ? [types] : []), ...(nodeTypes?.packages ?? [])].flatMap((library) =>
      library.files.map((file) => ({
        content: file.content,
        filePath: `file:///node_modules/${library.packageName}/${file.path}`,
      })),
    ),
  );
}

/** The agent-relative path of a model URI, or undefined when it is outside the agent folder. */
export function agentPathOf(name: string, uri: { path: string }): string | undefined {
  const prefix = `/agents/${name}/`;
  return uri.path.startsWith(prefix) ? uri.path.slice(prefix.length) : undefined;
}

/** Whether a model URI is one of the library declarations registered above. */
export const isLibraryUri = (uri: { path: string }) => uri.path.startsWith("/node_modules/");
