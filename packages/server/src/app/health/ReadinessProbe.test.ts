import { FunctionCheck } from "../../../tests/support/FunctionCheck.js";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { ReadinessProbe } from "./ReadinessProbe.js";

const logger = pino({ level: "silent" });

describe("ReadinessProbe", () => {
  it("is ready when every check is ready", async () => {
    const probe = new ReadinessProbe(
      [
        new FunctionCheck("a", async () => ({ ready: true })),
        new FunctionCheck("b", async () => ({ ready: true })),
      ],
      100,
      logger,
    );
    expect(await probe.report()).toEqual({
      ready: true,
      checks: { a: { ready: true }, b: { ready: true } },
    });
  });

  it("treats thrown errors as not ready without exposing the error", async () => {
    const probe = new ReadinessProbe(
      [new FunctionCheck("database", () => Promise.reject(new Error("ECONNREFUSED 10.0.0.5")))],
      100,
      logger,
    );
    expect(await probe.report()).toEqual({
      ready: false,
      checks: { database: { ready: false, reason: "Check failed unexpectedly." } },
    });
  });

  it("treats slow checks as not ready", async () => {
    const probe = new ReadinessProbe(
      [new FunctionCheck("slow", () => new Promise(() => {}))],
      20,
      logger,
    );
    expect(await probe.report()).toEqual({
      ready: false,
      checks: { slow: { ready: false, reason: "Check timed out after 20 ms." } },
    });
  });
});
