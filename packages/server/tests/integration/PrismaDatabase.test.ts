import { pino } from "pino";
import { describe, expect, it } from "vitest";
import {
  DatabaseConnectionError,
  PrismaDatabase,
} from "../../src/infrastructure/database/PrismaDatabase.js";
import { TemporaryDatabase } from "../support/TemporaryDatabase.js";

const logger = pino({ level: "silent" });
const options = { maxConnections: 2, connectionTimeoutMs: 1000 };

describe("PrismaDatabase", () => {
  it("connects and queries inside the kushex schema", async () => {
    const temporary = await TemporaryDatabase.create();
    const database = new PrismaDatabase({ url: temporary.url, ...options }, logger);
    try {
      await database.start();
      const [row] = await database.client.$queryRaw<{ search_path: string }[]>`SHOW search_path`;
      expect(row).toEqual({ search_path: "kushex" });
    } finally {
      await database.stop();
      await temporary.drop();
    }
  });

  it("fails predictably without exposing credentials when the server is unreachable", async () => {
    const database = new PrismaDatabase(
      { url: "postgresql://kushex:hunter2@127.0.0.1:1/kushex", ...options },
      logger,
    );
    const failure = database.start();
    await expect(failure).rejects.toBeInstanceOf(DatabaseConnectionError);
    await expect(failure).rejects.toThrow(
      /^Could not connect to PostgreSQL at 127\.0\.0\.1:1\/kushex: /,
    );
    await expect(failure).rejects.not.toThrow(/hunter2/);
    await database.stop();
  });

  it("reports authentication failures as connection errors", async () => {
    const temporary = await TemporaryDatabase.create();
    try {
      const url = new URL(temporary.url);
      url.password = "wrong-password";
      const database = new PrismaDatabase({ url: url.toString(), ...options }, logger);
      await expect(database.start()).rejects.toThrow(
        /^Could not connect to PostgreSQL at [^:]+:\d+\/\w+: password authentication failed/,
      );
      await database.stop();
    } finally {
      await temporary.drop();
    }
  });
});
