import { z } from "zod";

export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";

export type ServerConfig = Readonly<{
  http: Readonly<{ host: string; port: number }>;
  database: Readonly<{ url: string; maxConnections: number; connectionTimeoutMs: number }>;
  shutdownTimeoutMs: number;
  logLevel: LogLevel;
}>;

export class ConfigurationError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(
      `Invalid server configuration:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`,
    );
    this.name = "ConfigurationError";
  }
}

const integer = (minimum: number, maximum: number) =>
  z.coerce
    .number({ error: "must be a number" })
    .int({ error: "must be an integer" })
    .min(minimum, { error: `must be at least ${minimum}` })
    .max(maximum, { error: `must be at most ${maximum}` });

const environmentSchema = z.object({
  HOST: z.string().default("127.0.0.1"),
  PORT: integer(0, 65_535).default(3000),
  DATABASE_URL: z
    .string({ error: "is required" })
    .refine((value) => URL.canParse(value) && /^postgres(ql)?:$/.test(new URL(value).protocol), {
      error: "must be a postgres:// or postgresql:// connection URL",
    }),
  DATABASE_POOL_MAX: integer(1, 100).default(10),
  DATABASE_CONNECT_TIMEOUT_MS: integer(100, 60_000).default(5000),
  SHUTDOWN_TIMEOUT_MS: integer(100, 120_000).default(10_000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"], {
      error: "must be one of fatal, error, warn, info, debug, trace, silent",
    })
    .default("info"),
});

/** Parses and validates the process environment once at startup. */
export class ServerConfigLoader {
  load(environment: Readonly<Record<string, string | undefined>>): ServerConfig {
    const result = environmentSchema.safeParse(this.withoutBlankValues(environment));
    if (!result.success) {
      throw new ConfigurationError(
        result.error.issues.map((issue) => `${issue.path.join(".")} ${issue.message}`),
      );
    }
    const values = result.data;
    return {
      http: { host: values.HOST, port: values.PORT },
      database: {
        url: values.DATABASE_URL,
        maxConnections: values.DATABASE_POOL_MAX,
        connectionTimeoutMs: values.DATABASE_CONNECT_TIMEOUT_MS,
      },
      shutdownTimeoutMs: values.SHUTDOWN_TIMEOUT_MS,
      logLevel: values.LOG_LEVEL,
    };
  }

  /** Treats `NAME=` like an unset variable so defaults apply instead of coercing "" to 0. */
  private withoutBlankValues(
    environment: Readonly<Record<string, string | undefined>>,
  ): Record<string, string> {
    return Object.fromEntries(
      Object.entries(environment).filter(
        (entry): entry is [string, string] => entry[1] !== undefined && entry[1].trim() !== "",
      ),
    );
  }
}
