// =============================================
//   Provider Registry — Rotación + Circuit Breaker
//   round-robin con fallback automático y
//   desactivación temporal de proveedores que
//   fallan repetidamente (circuit breaker).
// =============================================

import OpenAI from "openai";
import { logger } from "../utils/logger.js";
import { config } from "../config/index.js";
import type { Provider, ProviderInfo, ProviderSwitchEvent, LLMError } from "../types/index.js";

function loadProviders(): Provider[] {
  const providers: Provider[] = [];

  for (let i = 1; i <= 10; i++) {
    const suffix = i === 1 ? "" : `_${i}`;
    const apiKey = process.env[`AI_API_KEY${suffix}`] ?? process.env[`OPENAI_API_KEY${suffix}`];
    if (!apiKey) break;

    // Si está explícitamente desactivado, lo omitimos pero seguimos escaneando
    if (process.env[`AI_ENABLED${suffix}`] === "false") {
      logger.debug(`Proveedor ${i} desactivado (AI_ENABLED${suffix}=false), omitido.`);
      continue;
    }

    const model   = process.env[`AI_MODEL${suffix}`] ?? process.env[`OPENAI_MODEL${suffix}`] ?? "gpt-4o";
    const baseURL = process.env[`AI_BASE_URL${suffix}`];
    const name    = `provider-${i} (${model})`;

    // Soporte para headers custom (p. ej. anthropic-version para la API de Anthropic)
    const headersRaw = process.env[`AI_HEADERS${suffix}`];
    let defaultHeaders: Record<string, string> | undefined;
    if (headersRaw) {
      try {
        defaultHeaders = JSON.parse(headersRaw) as Record<string, string>;
      } catch {
        logger.warn(`AI_HEADERS${suffix} no es JSON válido, se ignorará.`);
      }
    }

    providers.push({
      name,
      model,
      client: new OpenAI({
        apiKey,
        ...(baseURL        ? { baseURL }        : {}),
        ...(defaultHeaders ? { defaultHeaders }  : {}),
      }),
      failures:  0,
      openUntil: 0,
    });

    logger.debug(`Proveedor cargado: ${name}${baseURL ? ` @ ${baseURL}` : ""}`);
  }

  if (providers.length === 0) {
    throw new Error("No hay proveedores configurados. Revisa AI_API_KEY en .env");
  }

  logger.info(`${providers.length} proveedor(es) de IA cargados.`);
  return providers;
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

  /**
   * Ejecuta fn(provider) con round-robin + circuit breaker + fallback.
   * Salta proveedores con circuito abierto.
   * Si todos fallan, lanza error.
   */
  async callWithFallback<T>(
    fn: (provider: Provider) => Promise<T>,
    onEvent: ((event: ProviderSwitchEvent) => void) | null = null
  ): Promise<T> {
    const startIndex = this.currentIndex;
    let lastError: LLMError | null = null;
    let skipped = 0;

    for (let i = 0; i < this.providers.length; i++) {
      const idx      = (startIndex + i) % this.providers.length;
      const provider = this.providers[idx];

      if (!this.isAvailable(provider)) {
        skipped++;
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

        if (lastError.status === 401) {
          this.recordFailure(provider, 401);
          throw new Error(`API Key inválida en ${provider.name}. Verifica .env`);
        }

        // 400 es rotatable: puede ser contexto grande, tool call inválido, o límite del modelo
        const rotatableStatus = new Set([400, 429, 404, 503, 502, 500, 413]);
        const isTooBig = lastError.status === 400 && (lastError.message ?? "").toLowerCase().includes("too large");
        // Errores de red (APIConnectionError, timeout, DNS) no tienen status — rotar igual
        const isNetworkError = lastError.status === undefined;

        if (rotatableStatus.has(lastError.status ?? 0) || isTooBig || lastError._rotatable || isNetworkError) {
          this.recordFailure(provider, isNetworkError ? undefined : lastError.status);
          const reasons: Record<number, string> = {
            429: "rate limit", 404: "modelo no encontrado",
            503: "servicio no disponible", 502: "bad gateway",
            500: "error interno", 413: "contexto grande",
          };
          const reason = isNetworkError ? "error de red" : (reasons[lastError.status ?? 0] ?? "error de proveedor");
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
        { allFailed: true }
      );
    }
    throw Object.assign(
      new Error(`Todos los proveedores fallaron. Último error: ${lastError?.message}`),
      { allFailed: true }
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

    // Los modelos de razonamiento (o1, o3, o4-*) no aceptan max_tokens
    // y requieren tokens suficientes para el reasoning interno.
    const isReasoningModel = /^o\d/i.test(provider.model);
    const extra = isReasoningModel ? {} : { max_tokens: 1 };

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

  /** Recarga los proveedores desde process.env (útil después de editar el .env en caliente). */
  reload(): void {
    this.providers    = loadProviders();
    this.currentIndex = 0;
    logger.info("Proveedores recargados.");
  }
}
