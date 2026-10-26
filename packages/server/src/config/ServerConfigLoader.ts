import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { ConfigurationError } from "../errors/ConfigurationError.js";
import type { ServerConfig } from "./ServerConfig.js";

/** Parses and validates the process environment once at startup. */
export class ServerConfigLoader {
  private readonly environmentSchema = z.object({
    KUSHEX_WORKSPACES_ROOT: z
      .string()
      .default(path.resolve("workspaces"))
      .transform((value) => value.split(",").map((part) => part.trim()))
      .refine((roots) => roots.every((root) => path.isAbsolute(root)), {
        error: "must contain comma-separated absolute directory paths",
      })
      .refine(
        (roots) => new Set(roots.map((root) => path.basename(root))).size === roots.length,
        { error: "must not contain two directories with the same name" },
      )
      .refine(
        (roots) =>
          roots.every((root) => !["", ".git", "node_modules", "dist"].includes(path.basename(root))),
        { error: "must not contain the filesystem root or an ignored directory name" },
      ),
    // The kushex repository root from both src/config and dist/config.
    KUSHEX_AGENTS_DIR: z
      .string()
      .default(fileURLToPath(new URL("../../../../agents", import.meta.url)))
      .refine((value) => path.isAbsolute(value), { error: "must be an absolute directory path" }),
    KUSHEX_KUSHIBOT_DIR: z
      .string()
      .optional()
      .refine((value) => value === undefined || path.isAbsolute(value), {
        error: "must be an absolute directory path",
      }),
    KUSHEX_ALLOWED_ORIGINS: z
      .string()
      .default(
        "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3050,http://127.0.0.1:3050",
      )
      .transform((value) => value.split(",").map((part) => part.trim()))
      .refine(
        (origins) =>
          origins.length > 0 &&
          origins.every((origin) => {
            try {
              const url = new URL(origin);
              return ["http:", "https:"].includes(url.protocol) && url.origin === origin;
            } catch {
              return false;
            }
          }),
        { error: "must contain comma-separated HTTP origins" },
      ),
    HOST: z.string().default("127.0.0.1"),
    PORT: ServerConfigLoader.integer(0, 65_535).default(3000),
    DATABASE_URL: z
      .string({ error: "is required" })
      .refine((value) => URL.canParse(value) && /^postgres(ql)?:$/.test(new URL(value).protocol), {
        error: "must be a postgres:// or postgresql:// connection URL",
      }),
    DATABASE_POOL_MAX: ServerConfigLoader.integer(1, 100).default(10),
    DATABASE_CONNECT_TIMEOUT_MS: ServerConfigLoader.integer(100, 60_000).default(5000),
    SHUTDOWN_TIMEOUT_MS: ServerConfigLoader.integer(100, 120_000).default(10_000),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"], {
        error: "must be one of fatal, error, warn, info, debug, trace, silent",
      })
      .default("info"),
  });

  private static integer(minimum: number, maximum: number) {
    return z.coerce
      .number({ error: "must be a number" })
      .int({ error: "must be an integer" })
      .min(minimum, { error: `must be at least ${minimum}` })
      .max(maximum, { error: `must be at most ${maximum}` });
  }

  load(environment: Readonly<Record<string, string | undefined>>): ServerConfig {
    const result = this.environmentSchema.safeParse(this.withoutBlankValues(environment));
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
      workspacesRoots: values.KUSHEX_WORKSPACES_ROOT,
      agentsDirectory: values.KUSHEX_AGENTS_DIR,
      kushibotDirectory: values.KUSHEX_KUSHIBOT_DIR ?? null,
      allowedOrigins: values.KUSHEX_ALLOWED_ORIGINS,
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
