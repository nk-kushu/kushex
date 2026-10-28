import pg from "pg";
import type { ManagedResource } from "../../shared/application/ManagedResource.js";

export type SqlValue = string | number | null;
export type SqlResult = Readonly<{
  rows: readonly Readonly<Record<string, unknown>>[];
  affectedRows: number;
}>;
export type SqlExecutor = Readonly<{
  query(sql: string, parameters: readonly SqlValue[]): Promise<SqlResult>;
}>;

export type PostgresSqlDatabaseOptions = Readonly<{
  url: string;
  /** Unqualified table names resolve in this schema; it is created on first migration. */
  schema: string;
  maxConnections: number;
  connectionTimeoutMs: number;
}>;

/** BIGINT (OID 20) as a JavaScript number, as kushibot stores require. */
const INT8 = 20;
/** Serializes kushibot migrations across processes sharing the database. */
const MIGRATION_LOCK = 884112;

/**
 * kushibot's `ISqlDatabase` over node-postgres, for kushibot's own SQL stores (its
 * `kushibot_*` tables, outside the Prisma-managed `kushex` schema). The pool connects lazily.
 */
export class PostgresSqlDatabase implements ManagedResource {
  readonly name = "kushibot-database";
  private readonly pool: pg.Pool;

  constructor(private readonly options: PostgresSqlDatabaseOptions) {
    if (!/^[a-z_][a-z0-9_]{0,62}$/.test(options.schema))
      throw new Error("Use a lowercase identifier for the kushibot schema.");
    this.pool = new pg.Pool({
      connectionString: options.url,
      max: options.maxConnections,
      connectionTimeoutMillis: options.connectionTimeoutMs,
      application_name: "kushex-server-kushibot",
      options: `-c search_path=${options.schema}`,
      types: {
        getTypeParser: ((oid: number, format?: "text" | "binary") =>
          oid === INT8 ? parseSafeInteger : pg.types.getTypeParser(oid, format)) as never,
      },
    });
  }

  async query(sql: string, parameters: readonly SqlValue[]): Promise<SqlResult> {
    return this.result(await this.pool.query(sql, [...parameters]));
  }

  transaction<T>(work: (transaction: SqlExecutor) => Promise<T>): Promise<T> {
    return this.transact(work, false);
  }

  migrationTransaction<T>(work: (transaction: SqlExecutor) => Promise<T>): Promise<T> {
    return this.transact(work, true);
  }

  async start(): Promise<void> {}

  async stop(): Promise<void> {
    await this.pool.end();
  }

  private async transact<T>(
    work: (transaction: SqlExecutor) => Promise<T>,
    migration: boolean,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      if (migration) {
        await client.query("SET LOCAL lock_timeout = '10s'");
        await client.query(`SELECT pg_advisory_xact_lock(${MIGRATION_LOCK})`);
        await client.query(`CREATE SCHEMA IF NOT EXISTS ${this.options.schema}`);
      }
      const value = await work({
        query: async (sql, parameters) => this.result(await client.query(sql, [...parameters])),
      });
      await client.query("COMMIT");
      return value;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private result(value: pg.QueryResult): SqlResult {
    return { rows: value.rows as SqlResult["rows"], affectedRows: value.rowCount ?? 0 };
  }
}

function parseSafeInteger(text: string): number {
  const value = Number(text);
  if (!Number.isSafeInteger(value)) throw new Error("A PostgreSQL BIGINT is out of safe range.");
  return value;
}
