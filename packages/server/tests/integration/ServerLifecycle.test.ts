import { createServer } from "node:net";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApplicationFactory } from "../../src/app/ApplicationFactory.js";
import { ServerConfigLoader } from "../../src/config/ServerConfig.js";
import { DatabaseConnectionError } from "../../src/infrastructure/database/PrismaDatabase.js";
import { PrismaMigrator } from "../support/PrismaMigrator.js";
import { TemporaryDatabase } from "../support/TemporaryDatabase.js";

describe("server lifecycle against PostgreSQL", () => {
  let temporary: TemporaryDatabase;
  let migrator: PrismaMigrator;

  beforeEach(async () => {
    temporary = await TemporaryDatabase.create();
    migrator = await PrismaMigrator.create();
    await migrator.add(
      "20260101000000_create_widgets",
      "CREATE TABLE widgets (id int PRIMARY KEY);",
    );
  });

  afterEach(async () => {
    await temporary.drop();
    await migrator.remove();
  });

  function factory(port: number, databaseUrl = temporary.url): ApplicationFactory {
    const config = new ServerConfigLoader().load({
      DATABASE_URL: databaseUrl,
      PORT: String(port),
      LOG_LEVEL: "silent",
      DATABASE_CONNECT_TIMEOUT_MS: "1000",
    });
    return new ApplicationFactory(config, migrator.directory);
  }

  it("is live before migrations, ready after prisma migrate deploy, and closes its resources", async () => {
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    const stop = new AbortController();
    const running = factory(port).createServer().run(stop.signal);
    await waitFor(() => fetch(`${base}/health`).then((response) => response.ok));

    const before = await fetch(`${base}/health/ready`);
    expect(before.status).toBe(503);
    expect(await before.json()).toMatchObject({
      status: "not_ready",
      checks: { database: { ready: true }, migrations: { ready: false } },
    });

    await migrator.deploy(temporary.url);

    const after = await fetch(`${base}/health/ready`);
    expect(after.status).toBe(200);
    expect(await after.json()).toEqual({
      status: "ready",
      checks: { database: { ready: true }, migrations: { ready: true } },
    });

    stop.abort();
    await running;
    await expect(fetch(`${base}/health`)).rejects.toThrow();
    expect(await serverConnectionCount(temporary.url)).toBe(0);
  });

  it("fails startup with a connection error and does not leave the HTTP port bound", async () => {
    const port = await freePort();
    const unreachable = "postgresql://kushex:secret@127.0.0.1:1/kushex";
    await expect(
      factory(port, unreachable).createServer().run(new AbortController().signal),
    ).rejects.toBeInstanceOf(DatabaseConnectionError);
    await expect(fetch(`http://127.0.0.1:${port}/health`)).rejects.toThrow();
  });
});

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  if (!address || typeof address === "string") throw new Error("No port assigned.");
  return address.port;
}

async function serverConnectionCount(databaseUrl: string): Promise<number> {
  const admin = new URL(databaseUrl);
  const name = admin.pathname.slice(1);
  admin.pathname = "/postgres";
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const result = await client.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = $1 AND application_name = 'kushex-server'",
      [name],
    );
    return result.rows[0]?.count ?? -1;
  } finally {
    await client.end();
  }
}

async function waitFor(condition: () => Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      if (await condition()) return;
    } catch {
      // Not available yet.
    }
    if (Date.now() > deadline) throw new Error("Timed out waiting for condition.");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
