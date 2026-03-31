// =============================================
//   AI Development Agent
//   Rotación automática entre proveedores:
//   Groq, OpenRouter, Mistral, Ollama, etc.
// =============================================

import { EventEmitter } from "events";
import fs from "fs/promises";
import path from "path";
import { ProviderRegistry, isReasoningModel } from "../providers/registry.js";
import { logger } from "../utils/logger.js";
import { config } from "../config/index.js";
import { getWorkspaceDir } from "../utils/security.js";
import type OpenAI from "openai";
import type {
  ChatMessage,
  ToolCall,
  OpenAITool,
  AgentStats,
  DoneEvent,
  ToolEvent,
  ConfirmEvent,
  ProviderSwitchEvent,
  LLMError,
} from "../types/index.js";
import type { MCPClient } from "../mcp/client.js";

const MAX_TRIM_RETRIES = 3;

const TOOLS_REQUIRING_CONFIRM = new Set([
  "delete_file",
  "delete_directory",
  "git_restore",
]);

const SYSTEM_PROMPT = `Eres un agente experto en desarrollo de software con acceso completo al workspace mediante herramientas.

REGLA PRINCIPAL — NUNCA HAGAS PREGUNTAS:
Cualquier dato que necesites (lenguaje, framework, estructura, dependencias) lo obtienes TÚ MISMO usando tus herramientas. Explorar el workspace es tu responsabilidad, no del usuario.

FLUJO OBLIGATORIO PARA CADA TAREA — NUNCA LO OMITAS:
1. EXPLORAR PRIMERO: Usa list_directory en la RAÍZ del workspace. Si no sabes dónde está el archivo, BUSCA con list_directory en subdirectorios hasta encontrarlo.
2. DETECTAR TIPO DE PROYECTO: Lee package.json para saber si es TypeScript (.ts), JavaScript (.js), NestJS, Express, etc.
3. VERIFICAR EXISTENCIA Y TIPO: Antes de modificar un archivo, CONFIRMA que existe Y tiene la extensión correcta (.ts para NestJS/TS, .js para JS puro).
4. LEER COMPLETO: Lee el archivo ENTERO antes de modificarlo o analizarlo. No asumas su contenido.
5. ACTUAR: Aplica el cambio mínimo necesario usando replace_in_file (preferido), apply_diff, o write_file (último recurso).
6. VERIFICAR: Ejecuta comandos simples para confirmar (npm run build, npm run test, etc).
7. REPORTAR: Resume qué hiciste.

FLUJO OBLIGATORIO PARA PREGUNTAS ANALÍTICAS ("analiza mi código", "cómo agrego X", "qué le falta a Y"):
- Estas preguntas se refieren SIEMPRE al código del workspace, no a conceptos genéricos.
- NUNCA respondas con teoría genérica sin leer primero el código.
- Flujo: list_directory → leer archivos relevantes → responder basándote en el código real.
- Si el usuario pregunta "cómo agrego control de excepciones", lee los archivos existentes, detecta el patrón usado y da una respuesta específica con los cambios concretos para ESE proyecto.

NUNCA hagas esto:
- ❌ Asumir que un archivo existe sin verificar con list_directory
- ❌ Usar solo el nombre de archivo (ej: "index.js") sin confirmar la ruta completa primero
- ❌ Crear archivos .js en proyectos TypeScript (usa .ts)
- ❌ Crear archivos nuevos si ya existen (primero BÚSCALOS)
- ❌ Escribir desde cero si puedes modificar lo existente
- ❌ Intentar ejecutar nest/node sin verificar que están instalados
- ❌ Crear archivos en la ubicación incorrecta

REGLA DE RUTAS — OBLIGATORIA:
Si el usuario menciona un archivo sin ruta (ej: "mi index", "el server", "app.js"), DEBES hacer list_directory antes de cualquier otra herramienta para encontrar la ruta exacta. NUNCA asumas que el archivo está en la raíz del workspace.

REGLAS CRÍTICAS DE MODIFICACIÓN DE CÓDIGO:
- Para AGREGAR o MODIFICAR código, sigue este orden de preferencia:
  1. PRIMERO intenta con replace_in_file: lee el archivo, copia el bloque exacto a reemplazar y pasa el texto tal como aparece.
  2. Si replace_in_file falla, usa apply_diff.
  3. Si apply_diff también falla, usa write_file con el contenido completo del archivo actualizado.
  ❌ NUNCA le pidas al usuario que copie y pegue código manualmente. Si una herramienta falla, usa la siguiente del orden.
- ANTES de modificar cualquier archivo, DEBES leerlo completo para entender su estructura.
- RESPETA el estilo del código existente: imports, convenciones de nomenclatura, patrones usados.
- Si el proyecto usa un framework (NestJS, Express, React, etc.), usa los patrones y APIs de ESE framework, NO los genéricos.
- Para replace_in_file: el old_string debe ser copiado EXACTAMENTE del archivo (misma indentación, espacios, saltos de línea).
- Antes de agregar cualquier código, busca en el mismo archivo si ya existe código similar — si existe, complétalo en vez de duplicarlo.

REGLAS DE LOGGING — OBLIGATORIAS:
- ANTES de agregar cualquier log, lee el archivo destino y detecta qué sistema de logging usa: NestJS Logger, winston, pino, morgan, console, etc.
- Usa EXACTAMENTE el mismo sistema de logging que ya existe en ese archivo. Si el archivo usa "new Logger('X')", usa esa instancia. Si usa "winston.info()", usa esa. NUNCA uses console.log en un archivo que ya usa otro sistema.
- Si el archivo ya tiene una instancia del logger definida, úsala. No crees una nueva.
- Si necesitas importar el logger, usa el mismo import que ya existe en otros archivos del proyecto.
- ❌ NUNCA uses console.log/console.error en proyectos que usan un framework con su propio sistema de logging (NestJS, Express con winston, etc.)

REGLAS DE PATRONES DEL PROYECTO — OBLIGATORIAS:
- Antes de escribir cualquier código nuevo, identifica el patrón que ya usa el proyecto para esa misma cosa y replícalo exactamente.
- NUNCA instales dependencias nuevas si el proyecto ya tiene un paquete que cumple la misma función. Revisa package.json primero.
- NUNCA crees archivos de configuración, tipos, helpers o utilidades si ya existen equivalentes en el proyecto — búscalos primero con search_files.
- Respeta las convenciones de nombres del proyecto: si usa camelCase, usa camelCase; si usa snake_case, usa snake_case; si los archivos son PascalCase, sigue ese patrón.
- Respeta los imports existentes: si el módulo ya importa algo que necesitas, úsalo — no dupliques imports.

REGLAS DE HERRAMIENTAS — MUY IMPORTANTE:
- Llama UNA sola herramienta por turno. Espera el resultado antes de decidir la siguiente acción.
- NUNCA llames read_file o run_command sobre rutas que no has visto en list_directory.
- Primero list_directory, lee el resultado, luego decide qué leer o modificar.
- NUNCA uses list_directory con recursive=true en la raíz de un proyecto — navega nivel a nivel.
- NUNCA ejecutes servidores de desarrollo que corren indefinidamente: start:dev, dev, watch, serve. Usa "build" para verificar que el código compila.
- Para ejecutar comandos usa run_command con el parámetro "command" (no "cmd").
- Para leer archivos usa read_file con el parámetro "path".
- Para escribir archivos usa write_file SOLO para archivos nuevos o cuando necesitas reescribir todo (indica esto claramente).
- Para modificar archivos existentes usa apply_diff con el parámetro "path" y "diff".
- Para listar directorios usa list_directory con el parámetro "path".
- Usa EXACTAMENTE los nombres de parámetros indicados en los schemas de las herramientas.

REGLAS CRÍTICAS — ARCHIVOS PROHIBIDOS:
- NUNCA toques, leas ni modifiques archivos en: dist/, build/, node_modules/, .next/, .nuxt/, coverage/, .cache/, *.log
- Estos directorio contienen archivos generados o de dependencias. Son irrelevantes para cualquier tarea.
- Si un comando lista estos directorios, IGNÓRALOS. No los explores, no los leas, no los modifiques.
- El usuario trabaja en el código FUENTE, NO en archivos compilados/generados.

PRECISIÓN OBLIGATORIA:
- Si el usuario dice "agrega un log en X", solo modifica X. No busques otros archivos.
- Si el usuario dice "cambia la función Y en Z", solo modifica Z. No toques archivos relacionados.
- CERO iniciativas: solo haz EXACTAMENTE lo que se pide. No mejores, no refactorices, no銀行
- Antes de modificar, pregunta: "¿Este archivo es NECESARIO para la tarea?"

REGLAS GENERALES:
- NUNCA pidas información que puedes obtener leyendo el workspace.
- Si algo no está claro, haz suposiciones razonables y documéntalas.
- Resuelve errores automáticamente sin pedir ayuda.
- No ejecutes comandos destructivos (rm -rf /, sudo, etc.).
- Todos los archivos deben crearse dentro del workspace.`;

// Aliases de parámetros que algunos modelos generan incorrectamente
const PARAM_ALIASES: Record<string, Record<string, string>> = {
  run_command:    { cmd: "command", shell: "command" },
  read_file:      { file: "path", filename: "path", filepath: "path" },
  write_file:     { file: "path", filename: "path", text: "content", data: "content" },
  list_directory: { dir: "path", directory: "path", folder: "path" },
};

function normalizeArgs(
  toolName: string,
  args: Record<string, unknown>
): Record<string, unknown> {
  const aliases = PARAM_ALIASES[toolName];
  if (!aliases) return args;

  const normalized = { ...args };
  for (const [wrong, correct] of Object.entries(aliases)) {
    if (normalized[wrong] !== undefined && normalized[correct] === undefined) {
      logger.warn(`Normalizado parámetro "${wrong}" → "${correct}" en ${toolName}`);
      normalized[correct] = normalized[wrong];
      delete normalized[wrong];
    }
  }
  return normalized;
}

export class DevAgent {
  private readonly mcpClient: MCPClient;
  private readonly registry: ProviderRegistry;
  private conversationHistory: ChatMessage[];
  private iterationCount: number;
  private totalToolCalls: number;
  private projectNotes: string;
  readonly events: EventEmitter;

  constructor(mcpClient: MCPClient) {
    this.mcpClient           = mcpClient;
    this.registry            = new ProviderRegistry();
    this.conversationHistory = [];
    this.iterationCount      = 0;
    this.totalToolCalls      = 0;
    this.projectNotes        = "";
    this.events              = new EventEmitter();
  }

  private async loadProjectNotes(): Promise<string> {
    try {
      const notesPath = path.join(getWorkspaceDir(), ".agent-notes.md");
      const content   = await fs.readFile(notesPath, "utf-8");
      return content.trim();
    } catch {
      return "";
    }
  }

  async processMessage(userMessage: string): Promise<string> {
    logger.divider("NUEVA TAREA");
    logger.agent(`Tarea recibida: ${userMessage}`);

    this.projectNotes = await this.loadProjectNotes();
    if (this.projectNotes) {
      logger.info(`Notas del proyecto cargadas (${this.projectNotes.length} chars)`);
    }

    this.conversationHistory.push({ role: "user", content: userMessage });
    this.iterationCount = 0;
    let trimRetries = 0;
    let emptyRetries = 0;
    const MAX_EMPTY_RETRIES = 2;
    const tools = this.mcpClient.getTools();

    while (this.iterationCount < config.maxIterations) {
      this.iterationCount++;
      logger.info(`Iteración ${this.iterationCount}/${config.maxIterations}`);

      let response;
      try {
        response = await this.callLLM(tools);
        trimRetries = 0;
      } catch (err) {
        const llmErr = err as LLMError;

        if (llmErr.isToolValidationError) {
          logger.warn(`Error de validación en tool call, reintentando con corrección...`);
          this.conversationHistory.push({
            role: "user",
            content: `Error de herramienta: ${llmErr.message}\nUsa EXACTAMENTE los nombres de parámetros del schema.`,
          });
          continue;
        }
        if ((llmErr as { allFailed?: boolean }).allFailed && !llmErr.isContextTooLarge) {
          // Todos los proveedores fallaron (rate limit, sin créditos, etc.) — no tiene sentido reintentar
          const failed = (llmErr as { failedProviders?: { name: string; reason: string; code?: number }[] }).failedProviders ?? [];
          let msg = "**No se pudo conectar con ningún modelo de IA.**\n\n";
          if (failed.length > 0) {
            msg += "**Modelos intentados:**\n";
            const causeEmoji: Record<string, string> = {
              "rate limit":              "🚦",
              "sin créditos":            "💳",
              "modelo no encontrado":    "❓",
              "error de red":            "🔌",
              "servicio no disponible":  "🔴",
              "circuit breaker abierto": "⛔",
              "bad gateway":             "🌐",
              "error interno":           "💥",
              "contexto grande":         "📄",
            };
            for (const p of failed) {
              const emoji = causeEmoji[p.reason] ?? "⚠️";
              const code  = p.code ? ` (${p.code})` : "";
              msg += `${emoji} **${p.name}** — ${p.reason}${code}\n`;
            }
            msg += "\n";
            const reasons = new Set(failed.map(p => p.reason));
            if (reasons.has("rate limit"))             msg += "💡 **Rate limit:** espera 1-2 minutos o activa otro modelo en el panel lateral.\n";
            if (reasons.has("sin créditos"))           msg += "💡 **Sin créditos:** recarga tu cuenta o usa un proveedor diferente.\n";
            if (reasons.has("error de red"))           msg += "💡 **Error de red:** verifica tu conexión o que el servidor local esté activo.\n";
            if (reasons.has("circuit breaker abierto")) msg += "💡 **Circuit breaker:** el modelo falló demasiadas veces. Se reintentará automáticamente en unos minutos.\n";
            if (reasons.has("modelo no encontrado"))   msg += "💡 **Modelo no encontrado:** verifica el nombre del modelo en el panel de proveedores.\n";
          } else {
            msg += "Revisa tu configuración en el panel lateral (☰ → Proveedores LLM).";
          }
          logger.warn(msg);
          this.events.emit("done", { content: msg, iterations: this.iterationCount, toolCalls: this.totalToolCalls });
          return msg;
        }
        if (llmErr.isContextTooLarge) {
          trimRetries++;
          if (trimRetries > MAX_TRIM_RETRIES) {
            logger.warn(`Hard-reset del historial tras ${trimRetries} intentos fallidos.`);
            this.conversationHistory = [{ role: "user", content: userMessage }];
            trimRetries = 0;
          } else {
            logger.warn(`Contexto demasiado grande, recortando historial (${trimRetries}/${MAX_TRIM_RETRIES})...`);
            this.trimHistory();
          }
          continue;
        }
        throw err;
      }

      const message = response.choices[0].message as ChatMessage;
      this.conversationHistory.push(message);

      if (!message.tool_calls || message.tool_calls.length === 0) {
        if (!message.content || message.content.trim() === "") {
          emptyRetries++;
          if (emptyRetries > MAX_EMPTY_RETRIES) {
            const fallback = "No pude generar una respuesta. Intenta reformular tu mensaje.";
            logger.warn(`El modelo devolvió contenido vacío ${emptyRetries} veces — abortando.`);
            this.events.emit("done", { content: fallback, iterations: this.iterationCount, toolCalls: this.totalToolCalls });
            return fallback;
          }
          logger.warn(`El modelo terminó sin contenido (${emptyRetries}/${MAX_EMPTY_RETRIES}) — solicitando resumen explícito.`);
          this.conversationHistory.push({
            role: "user",
            content: "Por favor, proporciona una respuesta completa con los resultados de tu análisis o los cambios realizados.",
          });
          continue;
        }
        emptyRetries = 0;
        logger.divider("RESPUESTA FINAL");
        logger.agent(message.content);
        logger.info(`✅ Completado en ${this.iterationCount} iteraciones, ${this.totalToolCalls} tool calls.`);
        const doneEvent: DoneEvent = { content: message.content, iterations: this.iterationCount, toolCalls: this.totalToolCalls };
        this.events.emit("done", doneEvent);
        return message.content;
      }

      const toolResults = await this.executeToolCalls(message.tool_calls);
      this.conversationHistory.push(...toolResults);

      if (this.iterationCount >= config.maxIterations) {
        const msg = `⚠️ Límite de ${config.maxIterations} iteraciones alcanzado. La tarea puede estar incompleta.`;
        logger.warn(msg);
        this.events.emit("done", { content: msg, iterations: this.iterationCount, toolCalls: this.totalToolCalls });
        return msg;
      }
    }

    const final = "Tarea finalizada.";
    this.events.emit("done", { content: final, iterations: this.iterationCount, toolCalls: this.totalToolCalls });
    return final;
  }

  /**
   * Limpia campos no estándar que algunos proveedores rechazan.
   * Por ej. OpenAI añade "annotations" en mensajes de asistente,
   * pero Cerebras y otros no lo aceptan.
   */
  private sanitizeMessages(messages: ChatMessage[]): ChatMessage[] {
    return messages.map((msg) => {
      if (msg.role === "assistant") {
        const clean: ChatMessage = { role: msg.role, content: msg.content ?? null };
        if (msg.tool_calls != null) clean.tool_calls = msg.tool_calls;
        if (msg.name       != null) clean.name       = msg.name;
        return clean;
      }
      return msg;
    });
  }

  private async callLLM(tools: OpenAITool[]): Promise<OpenAI.ChatCompletion> {
    const onEvent = (event: ProviderSwitchEvent) => this.events.emit("providerSwitch", event);

    return this.registry.callWithFallback(async (provider) => {
      logger.debug(`Llamando ${provider.name} con ${this.conversationHistory.length} mensajes`);

      const systemContent = this.projectNotes
        ? `${SYSTEM_PROMPT}\n\n${"─".repeat(60)}\n## 📝 NOTAS DEL PROYECTO (contexto persistente)\n\nEstas notas fueron guardadas en sesiones anteriores. Tenlas en cuenta:\n\n${this.projectNotes}`
        : SYSTEM_PROMPT;

      const messages = this.sanitizeMessages([
        { role: "system", content: systemContent },
        ...this.conversationHistory,
      ]);

      // Los modelos o-series (o1, o3, o4-mini, etc.) no aceptan temperature ni parallel_tool_calls
      const isOSeries   = /^o\d/i.test(provider.model);
      // Los modelos Claude (via endpoint OpenAI-compatible de Anthropic) no aceptan parallel_tool_calls
      const isClaude    = provider.model.startsWith("claude-");
      // Modelos de razonamiento (Groq qwen3, gpt-oss, etc.) requieren max_completion_tokens
      const isReasoning = isReasoningModel(provider.model);

      try {
        const response = await provider.client.chat.completions.create({
          model: provider.model,
          messages: messages as Parameters<typeof provider.client.chat.completions.create>[0]["messages"],
          tools: tools as Parameters<typeof provider.client.chat.completions.create>[0]["tools"],
          tool_choice: "auto",
          ...(!isOSeries && !isClaude && { parallel_tool_calls: false }),
          ...(!isOSeries && { temperature: 0.1 }),
          ...(isReasoning
            ? { max_completion_tokens: 4096 }
            : { max_tokens: 4096 }),
        });

        const { prompt_tokens, completion_tokens, total_tokens } = response.usage ?? {};
        if (total_tokens) {
          logger.debug(`Tokens — prompt: ${prompt_tokens}, completion: ${completion_tokens}, total: ${total_tokens}`);
        }
        return response as OpenAI.ChatCompletion;

      } catch (err) {
        const llmErr = err as LLMError;

        if (llmErr.status === 400) {
          const msg = llmErr.message ?? "";

          if (
            msg.toLowerCase().includes("failed to call a function") ||
            msg.toLowerCase().includes("unsupported parameter") ||
            msg.toLowerCase().includes("does not support tools") ||
            msg.toLowerCase().includes("function calling")
          ) {
            llmErr.status = 400;
            llmErr._rotatable = true;
            throw llmErr;
          }
          if (
            msg.toLowerCase().includes("tool call validation") ||
            msg.toLowerCase().includes("did not match schema") ||
            msg.toLowerCase().includes("failed to parse") ||
            msg.toLowerCase().includes("parse tool call")
          ) {
            const e = new Error(msg) as LLMError;
            e.isToolValidationError = true;
            throw e;
          }
          if (msg.toLowerCase().includes("too large")) {
            const e = new Error(msg) as LLMError;
            e.isContextTooLarge = true;
            throw e;
          }
          // Cualquier otro 400: marcar como rotatable para que callWithFallback
          // intente el siguiente proveedor en vez de lanzar inmediatamente
          llmErr._rotatable = true;
          throw llmErr;
        }
        if (llmErr.status === 413) {
          const e = new Error(llmErr.message) as LLMError;
          e.isContextTooLarge = true;
          throw e;
        }
        throw err;
      }
    }, onEvent);
  }

  private async executeToolCalls(toolCalls: ToolCall[]): Promise<ChatMessage[]> {
    const results: ChatMessage[] = [];

    for (const toolCall of toolCalls) {
      const toolName = toolCall.function.name;
      let toolArgs: Record<string, unknown> = {};

      try {
        toolArgs = JSON.parse(toolCall.function.arguments ?? "{}") as Record<string, unknown>;
      } catch {
        logger.warn(`Argumentos inválidos para ${toolName}`);
      }

      toolArgs = normalizeArgs(toolName, toolArgs);
      logger.tool(toolName, `args: ${JSON.stringify(toolArgs)}`);

      const toolEvent: ToolEvent = { name: toolName, args: toolArgs };
      this.events.emit("tool", toolEvent);

      if (TOOLS_REQUIRING_CONFIRM.has(toolName)) {
        const approved = await this.requestConfirmation(toolName, toolArgs);
        if (!approved) {
          logger.warn(`Tool ${toolName} cancelada por el usuario.`);
          results.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: "⚠️ Acción cancelada por el usuario. No se realizaron cambios.",
          });
          continue;
        }
      }

      let resultText: string;
      try {
        const result = await this.mcpClient.callTool(toolName, toolArgs);
        resultText = this.mcpClient.extractText(result);
        this.totalToolCalls++;

        const resultWithError = result as { isError?: boolean };
        if (resultWithError.isError) logger.warn(`Tool ${toolName} error: ${resultText}`);
        else logger.debug(`Tool ${toolName} OK: ${resultText.substring(0, 100)}...`);
      } catch (err) {
        resultText = `❌ Error en ${toolName}: ${(err as Error).message}`;
        logger.error(resultText);
      }

      if (resultText.length > config.maxResultChars) {
        const truncated = resultText.substring(0, config.maxResultChars);
        logger.warn(`Resultado de ${toolName} truncado (${resultText.length} → ${config.maxResultChars} chars)`);
        resultText = truncated + `\n...[truncado, ${resultText.length - config.maxResultChars} chars omitidos]`;
      }

      results.push({ role: "tool", tool_call_id: toolCall.id, content: resultText });
    }

    return results;
  }

  private requestConfirmation(toolName: string, args: Record<string, unknown>): Promise<boolean> {
    return new Promise((resolve) => {
      const id = Math.random().toString(36).slice(2);
      const event: ConfirmEvent = { id, toolName, args, resolve };
      this.events.emit("confirm", event);
    });
  }

  private trimHistory(): void {
    const before = this.conversationHistory.length;

    if (this.conversationHistory.length > config.maxHistoryMsgs) {
      // Trim por cantidad: mantener la primera pregunta + la mitad más reciente
      const keep     = Math.floor(config.maxHistoryMsgs / 2);
      const head     = this.conversationHistory.slice(0, 1);
      let tailStart  = this.conversationHistory.length - keep;

      // Avanzar hasta un mensaje "limpio" para no cortar en medio de un tool call
      while (tailStart < this.conversationHistory.length) {
        const msg = this.conversationHistory[tailStart];
        const isClean =
          msg.role === "user" ||
          (msg.role === "assistant" && (!msg.tool_calls || msg.tool_calls.length === 0));
        if (isClean) break;
        tailStart++;
      }

      this.conversationHistory = [...head, ...this.conversationHistory.slice(tailStart)];
    } else if (this.conversationHistory.length > 2) {
      // Pocos mensajes pero el contexto es demasiado grande (mensajes muy pesados).
      // Eliminar el turno más antiguo (índice 1 + sus tool results asociados).
      let i = 1;
      // Si el índice 1 es un assistant con tool_calls, también eliminar sus tool results
      const pivot = this.conversationHistory[1];
      let deleteCount = 1;
      if (pivot?.role === "assistant" && pivot.tool_calls?.length) {
        const ids = new Set(pivot.tool_calls.map(tc => tc.id));
        let j = 2;
        while (j < this.conversationHistory.length && this.conversationHistory[j].role === "tool" && ids.has(this.conversationHistory[j].tool_call_id ?? "")) {
          j++;
        }
        deleteCount = j - i;
      }
      this.conversationHistory.splice(i, deleteCount);
    } else {
      // Último recurso: truncar el contenido de los mensajes grandes
      for (const msg of this.conversationHistory) {
        if (msg.content && msg.content.length > 3000) {
          msg.content = msg.content.substring(0, 3000) + "\n...[truncado por contexto]";
        }
      }
    }

    logger.warn(`Historial recortado: ${before} → ${this.conversationHistory.length} mensajes.`);
  }

  clearHistory(): void {
    this.conversationHistory = [];
    this.iterationCount      = 0;
    this.totalToolCalls      = 0;
    logger.info("Historial limpiado.");
  }

  getStats(): AgentStats {
    const current = this.registry.currentProvider;
    return {
      messages:   this.conversationHistory.length,
      iterations: this.iterationCount,
      toolCalls:  this.totalToolCalls,
      model:      current.model,
      provider:   current.name,
      providers:  this.registry.list(),
    };
  }

  async testProvider(index: number): Promise<{ ok: boolean; latencyMs?: number; error?: string; errorCode?: number }> {
    return this.registry.testProvider(index);
  }

  hasProviders(): boolean {
    return this.registry.hasProviders();
  }

  /** Recarga los proveedores desde process.env sin reiniciar el servidor. */
  reloadProviders(): void {
    this.registry.reload();
  }
}
