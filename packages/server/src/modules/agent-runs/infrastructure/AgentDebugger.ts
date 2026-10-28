import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AgentRunEventDto,
  DebugBreakpointDto,
  DebugBreakpointsDto,
  DebugCallFrameDto,
  DebugCommand,
  DebugValueDto,
  DebugVariableDto,
  ScriptSourceDto,
} from "@kushex/contracts";
import { ConflictError } from "../../../errors/ConflictError.js";
import { NotFoundError } from "../../../errors/NotFoundError.js";
import { InspectorCommandError, type InspectorClient } from "./InspectorClient.js";
import { SourceMap } from "./SourceMap.js";

/** Inspector protocol shapes, reduced to the fields used here. */
type RemoteObject = Readonly<{
  type: string;
  subtype?: string;
  className?: string;
  value?: unknown;
  unserializableValue?: string;
  description?: string;
  objectId?: string;
  preview?: Readonly<{
    overflow: boolean;
    properties: readonly Readonly<{
      name: string;
      type: string;
      subtype?: string;
      value?: string;
    }>[];
  }>;
}>;
type Location = Readonly<{ scriptId: string; lineNumber: number; columnNumber?: number }>;
type CallFrame = Readonly<{
  callFrameId: string;
  functionName: string;
  location: Location;
  url: string;
  scopeChain: readonly Readonly<{ type: string; name?: string; object: RemoteObject }>[];
}>;
type RuntimeCallFrame = Readonly<{
  functionName: string;
  scriptId: string;
  url: string;
  lineNumber: number;
  columnNumber: number;
}>;
type StackTrace = Readonly<{
  description?: string;
  callFrames: readonly RuntimeCallFrame[];
  parent?: StackTrace;
}>;
/**
 * `map` is set for an agent file (tsx's inline map) and for code outside the agent with a
 * source map whose source could be read, such as kushibot's TypeScript; `source` for the latter.
 */
type Script = Readonly<{
  id: string;
  url: string;
  file: string | null;
  map: SourceMap | null;
  source: Readonly<{ url: string; content: string }> | null;
}>;

/** The object group of values handed to the UI while paused; released on resume. */
const OBJECT_GROUP = "kushex";
const MAX_FRAMES = 64;
const MAX_PROPERTIES = 500;
const SCOPE_NAMES: Readonly<Record<string, string>> = {
  local: "Local",
  closure: "Closure",
  block: "Block",
  catch: "Catch",
  with: "With",
  module: "Module",
  script: "Script",
  global: "Global",
  eval: "Eval",
};

/**
 * Debugs one agent process through its inspector, in terms of the agent's TypeScript files.
 * tsx gives every agent module an inline source map. A file's breakpoints bind as soon as
 * its script is parsed; for modules with top-level statements, a
 * `beforeScriptWithSourceMapExecution` instrumentation pause holds the module until then.
 * The runner calls the agent only after `settled()`, so function breakpoints are bound too.
 */
export class AgentDebugger {
  private readonly scripts = new Map<string, Script>();
  /** Agent-relative file → its loaded script. */
  private readonly agentScripts = new Map<string, Script>();
  private readonly requested = new Map<string, readonly number[]>();
  private readonly bound = new Map<string, readonly DebugBreakpointDto[]>();
  private readonly breakpointIds = new Map<string, readonly string[]>();
  private frames: readonly CallFrame[] | null = null;
  /** Breakpoint changes, one at a time so a file's breakpoints are never bound twice. */
  private binding: Promise<void> = Promise.resolve();
  /** Why the next pause happens when it follows a step. */
  private requestedPause: "step" | null = null;
  private lastStep = "Debugger.stepInto";
  /** Steps taken on their own through generated code since the user's step. */
  private smartSteps = 0;
  /** Source maps of code outside the agent still being read. */
  private readonly loadingMaps = new Set<Promise<void>>();

  constructor(
    private readonly client: InspectorClient,
    /** Real path of the agent folder, as it appears in script URLs. */
    private readonly agentDirectory: string,
    breakpoints: DebugBreakpointsDto,
    private readonly emit: (event: AgentRunEventDto) => void,
  ) {
    for (const [file, lines] of Object.entries(breakpoints))
      this.requested.set(file, this.normalize(lines));
  }

  get paused(): boolean {
    return this.frames !== null;
  }

  /** Connects to the waiting process and lets it run. */
  async start(): Promise<void> {
    this.client.on("Debugger.scriptParsed", (params) => this.parsed(params));
    this.client.on("Debugger.paused", (params) => void this.onPaused(params));
    this.client.on("Debugger.resumed", () => this.onResumed());
    await this.client.send("Runtime.enable");
    await this.client.send("Debugger.enable");
    await this.client.send("Debugger.setAsyncCallStackDepth", { maxDepth: 16 });
    await this.client.send("Debugger.setBlackboxPatterns", {
      // Stepping skips Node internals, dependencies (tsx) and the runner that calls `chat`.
      patterns: ["^node:", "/node_modules/", "/agent-runs/runner/agentRunner\\.[jt]s$"],
    });
    await this.client.send("Debugger.setInstrumentationBreakpoint", {
      instrumentation: "beforeScriptWithSourceMapExecution",
    });
    this.emitBreakpoints();
    await this.client.send("Runtime.runIfWaitingForDebugger");
  }

  async command(command: DebugCommand): Promise<void> {
    if (command === "pause") {
      if (!this.paused) await this.client.send("Debugger.pause");
      return;
    }
    if (!this.paused) throw new ConflictError("The run is not paused.");
    this.requestedPause = command === "continue" ? null : "step";
    const method = {
      continue: "Debugger.resume",
      stepOver: "Debugger.stepOver",
      stepInto: "Debugger.stepInto",
      stepOut: "Debugger.stepOut",
    }[command];
    if (command !== "continue") this.lastStep = method;
    this.smartSteps = 0;
    await this.client.send(method);
  }

  /** Replaces the file's breakpoints; they bind now when the file is loaded, otherwise on load. */
  async setBreakpoints(
    file: string,
    lines: readonly number[],
  ): Promise<readonly DebugBreakpointDto[]> {
    this.requested.set(file, this.normalize(lines));
    const script = this.agentScripts.get(file);
    if (script) await this.queueBind(file, script);
    else {
      this.bound.delete(file);
      this.emitBreakpoints();
    }
    return this.stateOf(file);
  }

  /** Resolves once every breakpoint of the scripts parsed so far is bound. */
  async settled(): Promise<void> {
    let pending;
    do {
      pending = this.binding;
      await pending;
    } while (pending !== this.binding);
  }

  async evaluate(expression: string, frameId: string | null): Promise<DebugValueDto> {
    if (frameId !== null && !this.frames?.some((frame) => frame.callFrameId === frameId))
      throw new ConflictError("That frame is gone; the run has resumed.");
    try {
      const reply = await this.client.send<{
        result: RemoteObject;
        exceptionDetails?: { text?: string; exception?: RemoteObject };
      }>(frameId ? "Debugger.evaluateOnCallFrame" : "Runtime.evaluate", {
        ...(frameId ? { callFrameId: frameId } : { replMode: true }),
        expression,
        objectGroup: OBJECT_GROUP,
        generatePreview: true,
        silent: true,
      });
      if (reply.exceptionDetails)
        return {
          type: "error",
          value:
            reply.exceptionDetails.exception?.description ??
            reply.exceptionDetails.text ??
            "Evaluation failed.",
          ref: null,
        };
      return this.value(reply.result);
    } catch (error) {
      if (error instanceof InspectorCommandError)
        return { type: "error", value: error.message, ref: null };
      throw error;
    }
  }

  async variables(ref: string): Promise<readonly DebugVariableDto[]> {
    let reply;
    try {
      reply = await this.client.send<{
        result: readonly { name: string; value?: RemoteObject; get?: RemoteObject }[];
        internalProperties?: readonly { name: string; value?: RemoteObject }[];
      }>("Runtime.getProperties", { objectId: ref, ownProperties: true, generatePreview: true });
    } catch (error) {
      if (error instanceof InspectorCommandError)
        throw new ConflictError("That value is gone; the run has resumed.");
      throw error;
    }
    const internal = (reply.internalProperties ?? []).filter(
      (property) => property.value && property.name !== "[[Scopes]]",
    );
    return [
      ...reply.result
        .filter((property) => property.name !== "__proto__")
        .map((property) =>
          property.value
            ? { name: property.name, ...this.value(property.value) }
            : { name: property.name, type: "accessor", value: "(…)", ref: null },
        ),
      ...internal.map((property) => ({ name: property.name, ...this.value(property.value!) })),
    ].slice(0, MAX_PROPERTIES);
  }

  /** Source of a script the agent runs: kushibot's TypeScript, or JavaScript without a map. */
  async source(scriptId: string): Promise<ScriptSourceDto> {
    const script = this.scripts.get(scriptId);
    if (!script) throw new NotFoundError("Script not found.");
    if (script.source) return { scriptId, url: script.source.url, source: script.source.content };
    const { scriptSource } = await this.client.send<{ scriptSource: string }>(
      "Debugger.getScriptSource",
      { scriptId },
    );
    return { scriptId, url: script.url, source: scriptSource };
  }

  dispose(): void {
    this.client.close();
  }

  private parsed(params: Record<string, unknown>): void {
    const id = String(params.scriptId);
    const url = String(params.url ?? "");
    const file = this.agentFileOf(url);
    const sourceMapUrl = typeof params.sourceMapURL === "string" ? params.sourceMapURL : "";
    const script: Script = {
      id,
      url,
      file,
      map: file && sourceMapUrl ? SourceMap.fromDataUrl(sourceMapUrl) : null,
      source: null,
    };
    this.scripts.set(id, script);
    if (!file) {
      // Dependencies are blackboxed, so only code like a linked kushibot is worth mapping.
      if (sourceMapUrl && url.startsWith("file:") && !url.includes("/node_modules/")) {
        const loading = this.loadMap(script, sourceMapUrl)
          .catch(() => undefined)
          .finally(() => this.loadingMaps.delete(loading));
        this.loadingMaps.add(loading);
      }
      return;
    }
    this.agentScripts.set(file, script);
    if (this.requested.get(file)?.length) void this.queueBind(file, script);
  }

  /** Maps a script outside the agent to its original source, when both can be read. */
  private async loadMap(script: Script, sourceMapUrl: string): Promise<void> {
    const mapUrl = new URL(sourceMapUrl, script.url);
    const map =
      mapUrl.protocol === "data:"
        ? SourceMap.fromDataUrl(mapUrl.href, script.url)
        : mapUrl.protocol === "file:"
          ? SourceMap.fromJson(await readFile(fileURLToPath(mapUrl), "utf8"), mapUrl.href)
          : null;
    if (!map?.sourceUrl?.startsWith("file:")) return;
    const content =
      map.sourceContent ?? (await readFile(fileURLToPath(map.sourceUrl), "utf8").catch(() => null));
    if (content === null) return;
    this.scripts.set(script.id, { ...script, map, source: { url: map.sourceUrl, content } });
  }

  private async onPaused(params: Record<string, unknown>): Promise<void> {
    const reason = String(params.reason);
    if (reason === "instrumentation") {
      // About to run a module's top-level code: wait until its breakpoints are bound.
      await this.settled();
      await this.client.send("Debugger.resume").catch(() => undefined);
      return;
    }
    await Promise.all(this.loadingMaps);
    const frames = params.callFrames as readonly CallFrame[];
    // Like an IDE's smart step: code the compiler added (e.g. CommonJS export getters) has
    // no place in the TypeScript source, so a step that lands there keeps going.
    if (
      this.requestedPause === "step" &&
      frames[0] &&
      this.isGenerated(frames[0]) &&
      this.smartSteps < 20
    ) {
      this.smartSteps++;
      await this.client.send(this.lastStep).catch(() => undefined);
      return;
    }
    const requested = this.requestedPause;
    this.requestedPause = null;
    this.frames = frames;
    this.emit({
      type: "paused",
      // V8 reports breakpoints, steps and `debugger` statements alike as "other".
      reason: (params.hitBreakpoints as unknown[] | undefined)?.length
        ? "breakpoint"
        : reason === "other"
          ? (requested ?? "debugger")
          : reason === "debugCommand"
            ? "pause"
            : reason,
      frames: this.withoutInternals([
        ...frames.map((frame) => this.frame(frame)),
        ...this.asyncFrames(params.asyncStackTrace as StackTrace | undefined),
      ]).slice(0, MAX_FRAMES),
    });
  }

  private onResumed(): void {
    // Instrumentation pauses are never reported, so neither are their resumes.
    if (!this.frames) return;
    this.frames = null;
    void this.client
      .send("Runtime.releaseObjectGroup", { objectGroup: OBJECT_GROUP })
      .catch(() => undefined);
    this.emit({ type: "resumed" });
  }

  private queueBind(file: string, script: Script): Promise<void> {
    this.binding = this.binding
      .then(() => this.bind(file, script))
      .catch(() => undefined)
      .then(() => this.emitBreakpoints());
    return this.binding;
  }

  private async bind(file: string, script: Script): Promise<void> {
    const previous = this.breakpointIds.get(file) ?? [];
    this.breakpointIds.delete(file);
    await Promise.all(
      previous.map((breakpointId) =>
        this.client.send("Debugger.removeBreakpoint", { breakpointId }).catch(() => undefined),
      ),
    );
    const ids: string[] = [];
    const states: DebugBreakpointDto[] = [];
    // Lines that move to the same line with code share one breakpoint; V8 refuses a second.
    const lines = new Set<number>();
    for (const requestedLine of this.requested.get(file) ?? []) {
      const target = script.map?.generatedFor(requestedLine - 1);
      if (!target) {
        states.push({ file, requestedLine, line: requestedLine, verified: false });
        continue;
      }
      if (lines.has(target.line)) {
        states.push({ file, requestedLine, line: target.line + 1, verified: true });
        continue;
      }
      lines.add(target.line);
      try {
        const { breakpointId } = await this.client.send<{ breakpointId: string }>(
          "Debugger.setBreakpoint",
          {
            location: {
              scriptId: script.id,
              lineNumber: target.at.line,
              columnNumber: target.at.column,
            },
          },
        );
        ids.push(breakpointId);
        states.push({ file, requestedLine, line: target.line + 1, verified: true });
      } catch {
        states.push({ file, requestedLine, line: requestedLine, verified: false });
      }
    }
    this.breakpointIds.set(file, ids);
    this.bound.set(file, states);
  }

  private stateOf(file: string): readonly DebugBreakpointDto[] {
    return (
      this.bound.get(file) ??
      (this.requested.get(file) ?? []).map((line) => ({
        file,
        requestedLine: line,
        line,
        verified: false,
      }))
    );
  }

  private emitBreakpoints(): void {
    this.emit({
      type: "breakpoints",
      breakpoints: [...this.requested.keys()].flatMap((file) => this.stateOf(file)),
    });
  }

  private frame(frame: CallFrame): DebugCallFrameDto {
    return {
      id: frame.callFrameId,
      name: frame.functionName || "(anonymous)",
      location: this.location(
        frame.location.scriptId,
        frame.url,
        frame.location.lineNumber,
        frame.location.columnNumber ?? 0,
      ),
      scopes: frame.scopeChain.map((scope) => ({
        type: scope.type,
        name: SCOPE_NAMES[scope.type] ?? scope.type,
        ref: scope.object.objectId ?? null,
      })),
    };
  }

  /**
   * Drops Node's own frames (promise queues, module loading) below the top frame, the way
   * IDEs hide them by default. An `await` marker moves to the next frame that is kept.
   */
  private withoutInternals(frames: readonly DebugCallFrameDto[]): DebugCallFrameDto[] {
    const kept: DebugCallFrameDto[] = [];
    let boundary: string | null = null;
    for (const [index, frame] of frames.entries()) {
      boundary = frame.asyncBoundary ?? boundary;
      if (index > 0 && frame.location.url.startsWith("node:")) continue;
      kept.push(boundary && !frame.asyncBoundary ? { ...frame, asyncBoundary: boundary } : frame);
      boundary = null;
    }
    return kept;
  }

  /** Callers across `await`s; they show where the code came from but cannot be inspected. */
  private asyncFrames(trace: StackTrace | undefined): DebugCallFrameDto[] {
    const frames: DebugCallFrameDto[] = [];
    for (let current = trace; current && frames.length < MAX_FRAMES; current = current.parent)
      for (const frame of current.callFrames)
        frames.push({
          id: null,
          name: frame.functionName || "(anonymous)",
          asyncBoundary: frame === current.callFrames[0] ? (current.description ?? "async") : null,
          location: this.location(frame.scriptId, frame.url, frame.lineNumber, frame.columnNumber),
          scopes: [],
        });
    return frames;
  }

  /** Whether the frame is in a mapped script, at code its source map does not cover. */
  private isGenerated(frame: CallFrame): boolean {
    const script = this.scripts.get(frame.location.scriptId);
    return (
      !!script?.map &&
      !script.map.originalFor({
        line: frame.location.lineNumber,
        column: frame.location.columnNumber ?? 0,
      })
    );
  }

  private location(scriptId: string, url: string, line: number, column: number) {
    const script = this.scripts.get(scriptId);
    const original = script?.map ? script.map.originalFor({ line, column }) : null;
    return original
      ? {
          file: script!.file,
          url: script!.source?.url ?? script!.url,
          scriptId,
          line: original.line + 1,
          column: original.column + 1,
        }
      : { file: null, url: url || script?.url || "", scriptId, line: line + 1, column: column + 1 };
  }

  private value(remote: RemoteObject): DebugValueDto {
    const ref =
      (remote.type === "object" && remote.subtype !== "null") || remote.type === "function"
        ? (remote.objectId ?? null)
        : null;
    return { type: remote.subtype ?? remote.type, value: this.describe(remote), ref };
  }

  private describe(remote: RemoteObject): string {
    switch (remote.type) {
      case "undefined":
        return "undefined";
      case "string":
        return this.quote(String(remote.value));
      case "number":
      case "boolean":
      case "bigint":
        return remote.unserializableValue ?? remote.description ?? String(remote.value);
      case "function":
        return `ƒ ${(remote.description ?? "").split("\n")[0]!.slice(0, 120)}`;
      case "object": {
        if (remote.subtype === "null") return "null";
        const preview = remote.preview;
        if (!preview) return remote.description ?? "Object";
        const items = preview.properties.map((property) => {
          const value =
            property.type === "string" ? this.quote(property.value ?? "") : (property.value ?? "…");
          return remote.subtype === "array" ? value : `${property.name}: ${value}`;
        });
        if (preview.overflow) items.push("…");
        const [open, close] = remote.subtype === "array" ? ["[", "]"] : ["{", "}"];
        const label =
          remote.description && remote.description !== "Object" ? `${remote.description} ` : "";
        return `${label}${open}${items.join(", ")}${close}`;
      }
      default:
        return remote.description ?? String(remote.value);
    }
  }

  private quote(text: string): string {
    return JSON.stringify(text.length > 500 ? `${text.slice(0, 500)}…` : text);
  }

  private agentFileOf(url: string): string | null {
    if (!url.startsWith("file:")) return null;
    const relative = path.relative(this.agentDirectory, fileURLToPath(url));
    return relative && !relative.startsWith("..") && !path.isAbsolute(relative)
      ? relative.split(path.sep).join("/")
      : null;
  }

  private normalize(lines: readonly number[]): readonly number[] {
    return [...new Set(lines)]
      .filter((line) => Number.isInteger(line) && line > 0)
      .sort((a, b) => a - b);
  }
}
