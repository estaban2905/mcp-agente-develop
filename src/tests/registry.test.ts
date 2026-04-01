// =============================================
//   Tests: ProviderRegistry helpers
// =============================================

import { describe, it, expect } from "vitest";
import { getKnownContextWindow, isReasoningModel } from "../providers/registry.js";

describe("getKnownContextWindow", () => {
  it("devuelve window exacta para modelo conocido", () => {
    expect(getKnownContextWindow("gpt-4.1")).toBe(1047576);
    expect(getKnownContextWindow("llama-3.1-8b-instant")).toBe(131072);
    expect(getKnownContextWindow("claude-sonnet-4-6")).toBe(200000);
  });

  it("devuelve window por match parcial", () => {
    expect(getKnownContextWindow("openai/gpt-4o")).toBe(128000);
    expect(getKnownContextWindow("qwen2.5-coder")).toBe(32768);
  });

  it("devuelve undefined para modelos desconocidos", () => {
    expect(getKnownContextWindow("modelo-inventado-xyz")).toBeUndefined();
  });
});

describe("isReasoningModel", () => {
  it("detecta modelos OpenAI o-series", () => {
    expect(isReasoningModel("o1")).toBe(true);
    expect(isReasoningModel("o3-mini")).toBe(true);
    expect(isReasoningModel("o4-mini")).toBe(true);
  });

  it("detecta modelos Qwen3", () => {
    expect(isReasoningModel("qwen3-32b")).toBe(true);
    expect(isReasoningModel("qwen/qwen3-235b")).toBe(true);
  });

  it("detecta modelos DeepSeek-R", () => {
    expect(isReasoningModel("deepseek-r1")).toBe(true);
    expect(isReasoningModel("deepseek-r2-lite")).toBe(true);
  });

  it("detecta QwQ", () => {
    expect(isReasoningModel("qwen-qwq-32b")).toBe(true);
  });

  it("detecta llama-4", () => {
    expect(isReasoningModel("llama-4-scout")).toBe(true);
    expect(isReasoningModel("llama-4-maverick")).toBe(true);
  });

  it("NO detecta modelos normales como reasoning", () => {
    expect(isReasoningModel("gpt-4o")).toBe(false);
    expect(isReasoningModel("llama-3.3-70b-versatile")).toBe(false);
    expect(isReasoningModel("claude-sonnet-4-6")).toBe(false);
    expect(isReasoningModel("gpt-4.1-mini")).toBe(false);
  });
});
