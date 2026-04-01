// =============================================
//   Tests: Config defaults
// =============================================

import { describe, it, expect } from "vitest";
import { config } from "../config/index.js";

describe("config defaults", () => {
  it("maxHistoryMsgs es 30", () => {
    expect(config.maxHistoryMsgs).toBe(30);
  });

  it("maxIterations es 30", () => {
    expect(config.maxIterations).toBe(30);
  });

  it("webPort es 4000", () => {
    expect(config.webPort).toBe(4000);
  });

  it("circuitThreshold es 3", () => {
    expect(config.circuitThreshold).toBe(3);
  });

  it("commandTimeout es 30000ms", () => {
    expect(config.commandTimeout).toBe(30000);
  });
});
