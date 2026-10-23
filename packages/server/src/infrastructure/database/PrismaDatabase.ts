import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client.js";
import type { Logger } from "../../shared/application/Logger.js";
import type { ManagedResource } from "../../shared/application/ManagedResource.js";

export type PrismaDatabaseOptions = Readonly<{
  url: string;
  maxConnections: number;
  connectionTimeoutMs: number;
}>;

/** Kushex tables live in their own PostgreSQL schema; keep in sync with `prisma.config.ts`. */
export const KUSHEX_DATABASE_SCHEMA = "kushex";

export class DatabaseConnectionError extends Error {
  constructor(target: string, reason: string, cause: unknown) {
    super(`Could not connect to PostgreSQL at ${target}: ${reason}`, { cause });
    this.name = "DatabaseConnectionError";
  }
}

/**
 * Owns the Prisma Client and its node-postgres pool. Repositories receive `client` and use
 * `client.$transaction` for operations that must commit together; never hold a transaction
 * open across agent calls, filesystem writes, or other external effects.
 */
export class PrismaDatabase implements ManagedResource {
  readonly name = "database";
  readonly client: PrismaClient;
  private readonly target: string;

  constructor(
    options: PrismaDatabaseOptions,
    private readonly logger: Logger,
  ) {
    const adapter = new PrismaPg(
      {
        connectionString: options.url,
        max: options.maxConnections,
        connectionTimeoutMillis: options.connectionTimeoutMs,
        application_name: "kushex-server",
        options: `-c search_path=${KUSHEX_DATABASE_SCHEMA}`,
      },
      {
        schema: KUSHEX_DATABASE_SCHEMA,
        onPoolError: (error) => {
          this.logger.warn({ err: error }, "An idle PostgreSQL connection failed.");
        },
      },
    );
    this.client = new PrismaClient({ adapter });
    this.target = this.describeTarget(options.url);
  }

  /** Verifies connectivity so a misconfigured or unreachable database fails startup. */
  async start(): Promise<void> {
    try {
      await this.client.$connect();
      await this.client.$queryRaw`SELECT 1`;
    } catch (error) {
      throw new DatabaseConnectionError(this.target, this.describeFailure(error), error);
    }
    this.logger.info({ database: this.target }, "Connected to PostgreSQL.");
  }

  async stop(): Promise<void> {
    await this.client.$disconnect();
  }

  /** Reduces Prisma's multi-line invocation error to the driver's message. */
  private describeFailure(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return /Message: `([^]*)`\s*$/.exec(message)?.[1] ?? message.trim();
  }

  /** Describes the connection target for diagnostics without exposing credentials. */
  private describeTarget(url: string): string {
    const parsed = new URL(url);
    return `${parsed.hostname}:${parsed.port || "5432"}${parsed.pathname}`;
  }
}
