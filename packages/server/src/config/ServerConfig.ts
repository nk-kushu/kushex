export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";

export type ServerConfig = Readonly<{
  http: Readonly<{ host: string; port: number }>;
  database: Readonly<{ url: string; maxConnections: number; connectionTimeoutMs: number }>;
  /** Absolute directories whose immediate subdirectories can become project workspaces. */
  workspacesRoots: readonly string[];
  allowedOrigins: readonly string[];
  shutdownTimeoutMs: number;
  logLevel: LogLevel;
}>;
