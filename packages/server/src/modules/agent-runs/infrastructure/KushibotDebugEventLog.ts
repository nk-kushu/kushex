import type { DebugEventDto, RecordedDebugEventDto } from "@kushex/contracts";
import type { PostgresSqlDatabase } from "../../../infrastructure/database/PostgresSqlDatabase.js";
import type {
  DebugEventLog,
  DebugEventPageResult,
  DebugStreamRef,
} from "../application/DebugEventLog.js";
import { kushibotEntry } from "./kushibotEntry.js";

/** kushibot's limit on one serialized debug event. */
const MAX_EVENT_BYTES = 16_384;
const MAX_PAGE_SIZE = 1000;

type Codec = Readonly<{
  encode(value: unknown): Promise<string>;
  decode(text: string): Promise<DebugEventDto>;
}>;
type Store = Readonly<{
  initialize(): Promise<void>;
  append(event: DebugEventDto): Promise<unknown>;
  read(
    streamId: string,
    afterSequence: number,
    limit: number,
  ): Promise<Readonly<{ items: readonly RecordedDebugEventDto[]; nextSequence: number | null }>>;
}>;
/** The part of kushibot this uses; loaded at runtime from `KUSHEX_KUSHIBOT_DIR`. */
type KushibotModule = Readonly<{
  JsonValueContract: new () => unknown;
  ExecutionIdentityContract: new () => unknown;
  DebugEventContract: new (json: unknown, identities: unknown) => unknown;
  JsonRecordCodec: new (contract: unknown, json: unknown, maxBytes: number) => Codec;
  SqlDebugEventStore: new (
    database: PostgresSqlDatabase,
    statements: unknown,
    scope: DebugEventDto["scope"],
    codec: Codec,
    clock: Readonly<{ nowEpochMs(): number }>,
    maxPageSize: number,
  ) => Store;
  postgresqlDebugEventStatements: unknown;
}>;
type Loaded = Readonly<{ kushibot: KushibotModule; codec: Codec }>;

/**
 * Stores debug events with kushibot's `SqlDebugEventStore` and PostgreSQL statements, so the
 * tables and sequencing are kushibot's own. The store is scope-bound; one is kept per scope.
 */
export class KushibotDebugEventLog implements DebugEventLog {
  readonly enabled: boolean;
  private loaded: Promise<Loaded> | null = null;
  private readonly stores = new Map<string, Store>();

  constructor(
    private readonly kushibotDirectory: string | null,
    private readonly database: PostgresSqlDatabase,
  ) {
    this.enabled = kushibotDirectory !== null;
  }

  async validate(event: unknown): Promise<DebugEventDto> {
    const { codec } = await this.load();
    return codec.decode(await codec.encode(event));
  }

  streamOf(event: DebugEventDto): DebugStreamRef {
    // kushibot's SqlDebugEventStore files events by run, or by trace when there is no run.
    const streamId =
      event.identity.runId === undefined
        ? `trace:${event.trace.traceId}`
        : `run:${event.identity.runId}`;
    return { scope: event.scope, streamId };
  }

  async append(event: DebugEventDto): Promise<void> {
    await (await this.store(event.scope)).append(event);
  }

  async read(
    stream: DebugStreamRef,
    afterSequence: number,
    limit: number,
  ): Promise<DebugEventPageResult> {
    const store = await this.store(stream.scope);
    const page = await store.read(stream.streamId, afterSequence, Math.min(limit, MAX_PAGE_SIZE));
    return {
      items: page.items.map((item) => ({ ...item, streamId: stream.streamId })),
      nextSequence: page.nextSequence,
    };
  }

  private async store(scope: DebugEventDto["scope"]): Promise<Store> {
    const { kushibot, codec } = await this.load();
    const key = JSON.stringify([scope.scopeId, scope.projectId, scope.workspaceId ?? null]);
    let store = this.stores.get(key);
    if (!store) {
      store = new kushibot.SqlDebugEventStore(
        this.database,
        kushibot.postgresqlDebugEventStatements,
        scope,
        codec,
        { nowEpochMs: () => Date.now() },
        MAX_PAGE_SIZE,
      );
      this.stores.set(key, store);
    }
    return store;
  }

  /** Imports kushibot and creates its debug tables once; a failed attempt is retried later. */
  private load(): Promise<Loaded> {
    if (!this.kushibotDirectory)
      return Promise.reject(new Error("Debug events need KUSHEX_KUSHIBOT_DIR."));
    this.loaded ??= (async () => {
      const kushibot = (await import(kushibotEntry(this.kushibotDirectory!))) as KushibotModule;
      const json = new kushibot.JsonValueContract();
      const codec = new kushibot.JsonRecordCodec(
        new kushibot.DebugEventContract(json, new kushibot.ExecutionIdentityContract()),
        json,
        MAX_EVENT_BYTES,
      );
      // Any scope will do: initialize only creates kushibot's (scope-independent) tables.
      await new kushibot.SqlDebugEventStore(
        this.database,
        kushibot.postgresqlDebugEventStatements,
        { scopeId: "kushex", projectId: "kushex" },
        codec,
        { nowEpochMs: () => Date.now() },
        MAX_PAGE_SIZE,
      ).initialize();
      return { kushibot, codec };
    })().catch((error: unknown) => {
      this.loaded = null;
      throw error;
    });
    return this.loaded;
  }
}
