import { randomUUID } from "node:crypto";
import pg from "pg";

/**
 * A uniquely named database created on the PostgreSQL server named by
 * `KUSHEX_TEST_DATABASE_URL`, so test files can run in parallel and leave nothing behind.
 */
export class TemporaryDatabase {
  private constructor(
    private readonly adminUrl: string,
    private readonly name: string,
  ) {}

  static async create(): Promise<TemporaryDatabase> {
    const adminUrl = process.env["KUSHEX_TEST_DATABASE_URL"];
    if (!adminUrl) {
      throw new Error(
        "Integration tests need KUSHEX_TEST_DATABASE_URL pointing at a disposable PostgreSQL " +
          "server whose user may create databases. See packages/server/README.md.",
      );
    }
    const database = new TemporaryDatabase(
      adminUrl,
      `kushex_test_${randomUUID().replaceAll("-", "")}`,
    );
    await database.admin(`CREATE DATABASE ${database.name}`);
    return database;
  }

  get url(): string {
    const url = new URL(this.adminUrl);
    url.pathname = `/${this.name}`;
    return url.toString();
  }

  async drop(): Promise<void> {
    await this.admin(`DROP DATABASE IF EXISTS ${this.name} WITH (FORCE)`);
  }

  private async admin(sql: string): Promise<void> {
    const client = new pg.Client({ connectionString: this.adminUrl });
    await client.connect();
    try {
      await client.query(sql);
    } finally {
      await client.end();
    }
  }
}
