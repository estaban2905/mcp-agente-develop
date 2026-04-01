// =============================================
//   Provider Registry — Rotación + Circuit Breaker
//   round-robin con fallback automático y
//   desactivación temporal de proveedores que
//   fallan repetidamente (circuit breaker).
// =============================================

import OpenAI from "openai";
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { logger } from "../utils/logger.js";
import { config } from "../config/index.js";
import type { Provider, ProviderInfo, ProviderSwitchEvent, LLMError, ProviderFailure } from "../types/index.js";

export const PROVIDERS_FILE = path.resolve(process.cwd(), "providers.json");

interface ProviderConfig {
  apiKey:         string;
  model:          string;
  baseUrl?:       string;
  headers?:       string;
  enabled?:       boolean;
  contextWindow?: number;  // límite de tokens del modelo
}

/**
 * Ventanas de contexto conocidas por defecto (tokens).
 * Se usa cuando providers.json no especifica contextWindow.
 */
const KNOWN_CONTEXT_WINDOWS: Record<string, number> = {
  // Ollama local
  "llama3":                       8192,
  "llama3:latest":                8192,
  "qwen2.5-coder:7b":            32768,
  "qwen2.5-coder":               32768,
  // Groq
  "llama-3.1-8b-instant":       131072,
  "llama-3.3-70b-versatile":     32768,
  "qwen/qwen3-32b":              32768,
  // OpenAI
  "gpt-4.1":                   1047576,
  "gpt-4.1-mini":              1047576,
  "o4-mini":                    200000,
  // Anthropic
  "claude-sonnet-4-6":          200000,
  // OpenRouter (heredan del modelo base)
  "google/gemini-2.0-flash-001": 1000000,
  "openai/gpt-4o":               128000,
  "qwen/qwen3.5-7b-instruct":    32768,
};

/** Devuelve la ventana de contexto conocida para un modelo, o undefined si no se conoce. */
export function getKnownContextWindow(model: string): number | undefined {
  // Búsqueda exacta primero
  if (KNOWN_CONTEXT_WINDOWS[model]) return KNOWN_CONTEXT_WINDOWS[model];
  // Búsqueda parcial (ej. "openai/gpt-4o" contiene "gpt-4o")
  for (const [key, val] of Object.entries(KNOWN_CONTEXT_WINDOWS)) {
    if (model.includes(key) || key.includes(model)) return val;
  }
  return undefined;
}

/** Migra proveedores desde .env a providers.json si el archivo no existe aún. */
function migrateFromEnvIfNeeded(): void {
  try {
    readFileSync(PROVIDERS_FILE, "utf-8");
    return; // ya existe, no migrar
  } catch { /* no existe, continuar */ }

  const configs: ProviderConfig[] = [];
  for (let i = 1; i <= 20; i++) {
    const suffix = i === 1 ? "" : `_${i}`;
    const apiKey = process.env[`AI_API_KEY${suffix}`] ?? process.env[`OPENAI_API_KEY${suffix}`];
    if (!apiKey) break;
    configs.push({
      apiKey,
      model:    process.env[`AI_MODEL${suffix}`] ?? "gpt-4o",
      baseUrl:  process.env[`AI_BASE_URL${suffix}`] || undefined,
      headers:  process.env[`AI_HEADERS${suffix}`]  || undefined,
      enabled:  process.env[`AI_ENABLED${suffix}`] !== "false",
    });
  }

  if (configs.length > 0) {
    writeFileSync(PROVIDERS_FILE, JSON.stringify(configs, null, 2), "utf-8");
    logger.info(`Migrados ${configs.length} proveedor(es) de .env → providers.json`);
  }
}

function loadProviders(): Provider[] {
  migrateFromEnvIfNeeded();

  let configs: ProviderConfig[] = [];
  try {
    configs = JSON.parse(readFileSync(PROVIDERS_FILE, "utf-8")) as ProviderConfig[];
  } catch {
    throw new Error("No se pudo cargar providers.json. Configura los proveedores desde la UI web.");
  }

  const providers: Provider[] = [];

  for (let i = 0; i < configs.length; i++) {
    const cfg = configs[i];
    if (!cfg.apiKey?.trim()) continue;

    if (cfg.enabled === false) {
      logger.debug(`Proveedor #${i + 1} (${cfg.model}) desactivado, omitido.`);
      continue;
    }

    const model = cfg.model || "gpt-4o";
    const name  = `provider-${i + 1} (${model})`;

    let defaultHeaders: Record<string, string> | undefined;
    if (cfg.headers?.trim()) {
      try {
        defaultHeaders = JSON.parse(cfg.headers) as Record<string, string>;
      } catch {
        logger.warn(`Headers JSON inválido para proveedor #${i + 1}, se ignorará.`);
      }
    }

    const contextWindow = cfg.contextWindow ?? getKnownContextWindow(model);

    providers.push({
      name,
      model,
      client: new OpenAI({
        apiKey: cfg.apiKey,
        ...(cfg.baseUrl       ? { baseURL: cfg.baseUrl } : {}),
        ...(defaultHeaders    ? { defaultHeaders }        : {}),
      }),
      failures:  0,
      openUntil: 0,
      ...(contextWindow ? { contextWindow } : {}),
    });

    logger.debug(`Proveedor cargado: ${name}${cfg.baseUrl ? ` @ ${cfg.baseUrl}` : ""}${contextWindow ? ` [ctx: ${contextWindow}]` : ""}`);
  }

  if (providers.length === 0) {
    logger.warn("No hay proveedores activos en providers.json. Activa al menos uno desde la UI.");
  } else {
    logger.info(`${providers.length} proveedor(es) de IA cargados.`);
  }
  return providers;
}

/**
 * Detecta modelos de razonamiento que no aceptan max_tokens bajo.
 * Incluye: OpenAI o-series, Qwen3, GPT OSS (Groq), QwQ, DeepSeek-R1.
 */
export function isReasoningModel(model: string): boolean {
  return /^o\d/i.test(model)                    // o1, o3, o4-mini (OpenAI)
    || /qwen[^/]*3/i.test(model)                // qwen3-32b, qwen/qwen3-*
    || /gpt-oss/i.test(model)                   // openai/gpt-oss-120b, gpt-oss-20b
    || /qwq/i.test(model)                       // qwen-qwq-32b
    || /deepseek-r/i.test(model)                // deepseek-r1, deepseek-r2
    || /llama-4/i.test(model);                  // llama-4-scout, llama-4-maverick
}

export class ProviderRegistry {
  private providers: Provider[];
  private currentIndex: number;

  constructor() {
    this.providers    = loadProviders();
    this.currentIndex = 0;
  }

  /** Marca un fallo en el proveedor. Si supera el umbral, abre el circuito. */
  private recordFailure(provider: Provider, errorCode?: number): void {
    provider.failures++;
    if (errorCode !== undefined) provider.lastErrorCode = errorCode;
    if (provider.failures >= config.circuitThreshold) {
      provider.openUntil = Date.now() + config.circuitResetMs;
      logger.warn(`Circuit breaker ABIERTO para ${provider.name} — se reintentará en ${config.circuitResetMs / 1000}s`);
    }
  }

  /** Marca éxito: resetea el contador de fallos. */
  private recordSuccess(provider: Provider): void {
    provider.failures      = 0;
    provider.openUntil     = 0;
    provider.lastErrorCode = undefined;
  }

  /** Devuelve true si el proveedor está disponible. */
  private isAvailable(provider: Provider): boolean {
    if (provider.openUntil === 0) return true;
    if (Date.now() >= provider.openUntil) {
      provider.openUntil = 0;
      provider.failures  = 0;
      logger.info(`Circuit breaker CERRADO para ${provider.name} — reintentando...`);
      return true;
    }
    return false;
  }

  hasProviders(): boolean {
    return this.providers.length > 0;
  }

  /**
   * Ejecuta fn(provider) con round-robin + circuit breaker + fallback.
   * Salta proveedores con circuito abierto.
   * Si todos fallan, lanza error.
   */
  async callWithFallback<T>(
    fn: (provider: Provider) => Promise<T>,
    onEvent: ((event: ProviderSwitchEvent) => void) | null = null
  ): Promise<T> {
    if (this.providers.length === 0) {
      throw Object.assign(
        new Error("No hay proveedores activos. Activa al menos uno desde el panel lateral."),
        { allFailed: true }
      );
    }

    const startIndex = this.currentIndex;
    let lastError: LLMError | null = null;
    let skipped = 0;
    const failedProviders: ProviderFailure[] = [];

    for (let i = 0; i < this.providers.length; i++) {
      const idx      = (startIndex + i) % this.providers.length;
      const provider = this.providers[idx];

      if (!this.isAvailable(provider)) {
        skipped++;
        failedProviders.push({ name: provider.name, reason: "circuit breaker abierto", code: provider.lastErrorCode });
        logger.debug(`Saltando ${provider.name} (circuit breaker abierto).`);
        continue;
      }

      try {
        const result = await fn(provider);
        this.recordSuccess(provider);
        this.currentIndex = (idx + 1) % this.providers.length;
        return result;

      } catch (err) {
        lastError = err as LLMError;
        logger.warn(`[registry] Error en ${provider.name}: type=${lastError.constructor?.name} status=${lastError.status} msg=${lastError.message?.slice(0, 120)}`);

        if (lastError.status === 401) {
          this.recordFailure(provider, 401);
          throw new Error(`API Key inválida en ${provider.name}. Verifica .env`);
        }

        // El modelo no soporta tools/function calling — error permanente, no rotatable
        if (lastError.status === 400 && (lastError.message ?? "").toLowerCase().includes("does not support tools")) {
          this.recordFailure(provider, 400);
          throw new Error(`El modelo ${provider.model} no soporta tool calling. Usa llama3.1, qwen2.5 o mistral.`);
        }

        // 400 es rotatable: puede ser contexto grande, tool call inválido, o límite del modelo
        const rotatableStatus = new Set([400, 402, 429, 404, 503, 502, 500, 413]);
        const isTooBig = (lastError.status === 400 || lastError.status === 413 || lastError.status === undefined) 
          && (lastError.message ?? "").toLowerCase().includes("too large");
        // Errores de red (APIConnectionError, timeout, DNS) no tienen status — rotar igual
        const isNetworkError = lastError.status === undefined && !(lastError.message ?? "").toLowerCase().includes("too large");

        if (rotatableStatus.has(lastError.status ?? 0) || isTooBig || lastError._rotatable || isNetworkError) {
          this.recordFailure(provider, isNetworkError ? undefined : lastError.status);
          const reasons: Record<number, string> = {
            402: "sin créditos", 429: "rate limit", 404: "modelo no encontrado",
            503: "servicio no disponible", 502: "bad gateway",
            500: "error interno", 413: "contexto grande",
          };
          const reason = isNetworkError 
            ? "error de red" 
            : ((lastError.message ?? "").toLowerCase().includes("too large") ? "contexto grande" : (reasons[lastError.status ?? 0] ?? "error de proveedor"));
          failedProviders.push({ name: provider.name, reason, code: isNetworkError ? undefined : lastError.status });
          const circuitOpen = provider.failures >= config.circuitThreshold;
          logger.warn(`${provider.name} falló (${reason}: ${lastError.status}).${circuitOpen ? " Circuito abierto." : " Rotando..."}`);
          onEvent?.({ type: "providerSwitch", from: provider.name, reason });
          continue;
        }

        throw err;
      }
    }

    if (skipped === this.providers.length) {
      throw Object.assign(
        new Error("Todos los proveedores tienen el circuit breaker abierto. Espera un momento."),
        { allFailed: true, failedProviders }
      );
    }

    // Avanzar el índice al siguiente proveedor para que el panel refleje
    // el último intentado y el próximo ciclo no empiece siempre desde el mismo.
    this.currentIndex = (startIndex + this.providers.length - 1) % this.providers.length;

    // Si TODOS fallaron por contexto grande, propagar isContextTooLarge
    // para que processMessage pueda recortar el historial y reintentar.
    const allContextTooLarge =
      failedProviders.length > 0 &&
      failedProviders.every(p => p.reason === "contexto grande");
    throw Object.assign(
      new Error(`Todos los proveedores fallaron. Último error: ${lastError?.message}`),
      { allFailed: true, failedProviders, isContextTooLarge: allContextTooLarge }
    );
  }

  get currentProvider(): Provider {
    return this.providers[this.currentIndex];
  }

  list(): ProviderInfo[] {
    return this.providers.map((p, i) => ({
      index:         i + 1,
      name:          p.name,
      model:         p.model,
      active:        i === this.currentIndex,
      healthy:       this.isAvailable(p),
      failures:      p.failures,
      openUntilMs:   p.openUntil,
      lastErrorCode: p.lastErrorCode,
    }));
  }

  async testProvider(index: number): Promise<{ ok: boolean; latencyMs?: number; error?: string; errorCode?: number }> {
    const provider = this.providers[index];
    if (!provider) return { ok: false, error: "Proveedor no encontrado" };

    const extra = isReasoningModel(provider.model) ? {} : { max_tokens: 1 };

    const t0 = Date.now();
    try {
      await provider.client.chat.completions.create({
        model:    provider.model,
        messages: [{ role: "user", content: "ping" }],
        ...extra,
      });
      return { ok: true, latencyMs: Date.now() - t0 };
    } catch (err) {
      const e = err as LLMError;
      return { ok: false, latencyMs: Date.now() - t0, error: e.message, errorCode: e.status };
    }
  }

  /**
   * Prueba una configuración ad-hoc sin necesidad de que esté en el registry.
   * Útil para validar un proveedor antes de guardarlo.
   */
  static async testAdhoc(cfg: {
    apiKey: string;
    model: string;
    baseURL?: string;
    headers?: string;
  }): Promise<{ ok: boolean; latencyMs?: number; error?: string; errorCode?: number }> {
    let defaultHeaders: Record<string, string> | undefined;
    if (cfg.headers?.trim()) {
      try {
        defaultHeaders = JSON.parse(cfg.headers) as Record<string, string>;
      } catch {
        return { ok: false, error: "Headers JSON inválido" };
      }
    }

    const client = new OpenAI({
      apiKey: cfg.apiKey,
      ...(cfg.baseURL ? { baseURL: cfg.baseURL } : {}),
      ...(defaultHeaders ? { defaultHeaders } : {}),
    });

    const extra = isReasoningModel(cfg.model) ? {} : { max_tokens: 1 };

    const t0 = Date.now();
    try {
      await client.chat.completions.create({
        model:    cfg.model,
        messages: [{ role: "user", content: "ping" }],
        ...extra,
      });
      return { ok: true, latencyMs: Date.now() - t0 };
    } catch (err) {
      const e = err as LLMError;
      return { ok: false, latencyMs: Date.now() - t0, error: e.message, errorCode: e.status };
    }
  }

  /** Recarga los proveedores desde providers.json (útil después de guardar cambios en la UI). */
  reload(): void {
    this.providers    = loadProviders();
    this.currentIndex = 0;
    logger.info("Proveedores recargados.");
  }
}
