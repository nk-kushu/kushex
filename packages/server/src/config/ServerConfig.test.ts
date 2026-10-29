import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ConfigurationError } from "../errors/ConfigurationError.js";
import { ServerConfigLoader } from "./ServerConfigLoader.js";

const databaseUrl = "postgresql://kushex:secret@postgres:5432/kushex";

describe("ServerConfigLoader", () => {
  const loader = new ServerConfigLoader();

  it("accepts several comma-separated workspace roots", () => {
    expect(
      loader.load({
        DATABASE_URL: databaseUrl,
        KUSHEX_WORKSPACES_ROOT: "/Users/me/PersonalProjects, /Users/me/projects",
      }).workspacesRoots,
    ).toEqual(["/Users/me/PersonalProjects", "/Users/me/projects"]);
  });

  it("applies defaults when only the database URL is set", () => {
    expect(loader.load({ DATABASE_URL: databaseUrl })).toEqual({
      http: { host: "127.0.0.1", port: 3000 },
      database: { url: databaseUrl, maxConnections: 10, connectionTimeoutMs: 5000 },
      workspacesRoots: [path.resolve("workspaces")],
      pluginsDirectory: fileURLToPath(new URL("../../../../plugins", import.meta.url)),
      kushibotDirectory: null,
      allowedOrigins: [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3050",
        "http://127.0.0.1:3050",
      ],
      shutdownTimeoutMs: 10_000,
      logLevel: "info",
    });
  });

  it("parses explicit values and treats blank values as unset", () => {
    const config = loader.load({
      DATABASE_URL: databaseUrl,
      HOST: "0.0.0.0",
      PORT: "4000",
      DATABASE_POOL_MAX: "",
      LOG_LEVEL: "debug",
    });
    expect(config.http).toEqual({ host: "0.0.0.0", port: 4000 });
    expect(config.database.maxConnections).toBe(10);
    expect(config.logLevel).toBe("debug");
  });

  it("reports every invalid variable without echoing the database URL", () => {
    const load = () =>
      loader.load({ DATABASE_URL: "mysql://user:secret@db/app", PORT: "70000", LOG_LEVEL: "loud" });
    expect(load).toThrow(ConfigurationError);
    try {
      load();
    } catch (error) {
      const { problems, message } = error as ConfigurationError;
      expect(problems).toHaveLength(3);
      expect(problems.join("\n")).toMatch(/PORT must be at most 65535/);
      expect(problems.join("\n")).toMatch(/DATABASE_URL must be a postgres/);
      expect(message).not.toContain("secret");
    }
  });

  it("requires DATABASE_URL", () => {
    expect(() => loader.load({})).toThrow(/DATABASE_URL is required/);
  });

  it("rejects non-integer ports", () => {
    expect(() => loader.load({ DATABASE_URL: databaseUrl, PORT: "abc" })).toThrow(/PORT/);
  });
});

it("rejects relative workspace roots and malformed browser origins", () => {
  const loader = new ServerConfigLoader();
  expect(() =>
    loader.load({ DATABASE_URL: databaseUrl, KUSHEX_WORKSPACES_ROOT: "../checkouts" }),
  ).toThrow(/KUSHEX_WORKSPACES_ROOT/);
  expect(() =>
    loader.load({ DATABASE_URL: databaseUrl, KUSHEX_WORKSPACES_ROOT: "/a/code,/b/code" }),
  ).toThrow(/same name/);
  expect(() =>
    loader.load({
      DATABASE_URL: databaseUrl,
      KUSHEX_ALLOWED_ORIGINS: "http://localhost:5173/path",
    }),
  ).toThrow(/KUSHEX_ALLOWED_ORIGINS/);
});
