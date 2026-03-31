import { EventEmitter } from "events";
import fs from "fs/promises";
import path from "path";
import { ProviderRegistry } from "../providers/registry.js";
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
  ProviderSwitchEvent,
  LLMError,
} from "../types/index.js";
import type { MCPClient } from "../mcp/client.js";

const SYSTEM_PROMPT = `Eres un experto en code review. Tu misión es analizar código, identificar problemas y sugerir mejoras.

ÁREAS DE ANÁLISIS:

1. CORRECCIÓN (Bugs):
- Errores lógicos
- Casos edge no manejados
- Race conditions
- Memory leaks
- Null/undefined no manejados

2. SEGURIDAD:
- Vulnerabilidades comunes (SQL injection, XSS, CSRF)
- Credenciales hardcodeadas
- Exposición de datos sensibles
- Validación de inputs
- Permisos y autenticación

3. PERFORMANCE:
- Operaciones costosas en loops
- Queries N+1
- Falta de memoización/caching
- Operaciones síncronas bloqueantes
- Memoria innecesaria

4. MANTENIBILIDAD:
- Código duplicado
- Funciones demasiado largas
- Acoplamiento excesivo
- Nombres poco descriptivos
- Falta de comentarios en código complejo

5. BEST PRACTICES:
- Uso de TypeScript correcto
- Patrones de diseño apropiados
- Manejo de errores consistente
- Logging apropiado
- Manejo de recursos (file handles, conexiones)

6. TESTING:
- Ausencia de tests para código crítico
- Tests que no cubren casos importantes
- Tests frágiles (que fallan por detalles menores)

FORMATO DEL REPORTE:

Para cada archivo analizado, proporciona:

## 📁 [ruta/archivo]

### ✅ Lo que está bien
- Puntos positivos del código

### ⚠️ Problemas encontrados
| Severidad | Tipo | Línea | Descripción |
|-----------|------|-------|-------------|
| 🔴 Alta | Bug | #45 | Descripción del bug |
| 🟡 Media | Performance | #30 | Mejora sugerida |
| 🟢 Baja | Estilo | #12 | Sugerencia menor |

### 💡 Mejoras sugeridas
- Sugerencia 1
- Sugerencia 2

### 📊 Resumen
- Total de issues: X (Alta: X, Media: X, Baja: X)
- Puntuación de calidad: X/10

INSTRUCCIONES:
1. Lee el código completo antes de analizar
2. Identifica el lenguaje y framework usado
3. Proporciona ejemplos concretos de problemas
4. Sugiere soluciones específicas, no genéricas
5. Prioriza los problemas por severidad
6. Si no hay problemas significativos, menciona qué está bien

HERRAMIENTAS DISPONIBLES:
- read_file: Leer archivos fuente
- search_files: Buscar patrones problemáticos
- run_command: Ejecutar linters, typecheckers
- list_directory: Explorar estructura`;

const MAX_TRIM_RETRIES = 3;

const SEVERITY_COLORS = {
  alta: "🔴",
  media: "🟡",
  baja: "🟢",
};

export class CodeReviewAgent {
  private readonly mcpClient: MCPClient;
  private readonly registry: ProviderRegistry;
  private conversationHistory: ChatMessage[];
  private iterationCount: number;
  private totalToolCalls: number;
  readonly events: EventEmitter;

  constructor(mcpClient: MCPClient) {
    this.mcpClient = mcpClient;
    this.registry = new ProviderRegistry();
    this.conversationHistory = [];
    this.iterationCount = 0;
    this.totalToolCalls = 0;
    this.events = new EventEmitter();
  }

  async processMessage(userMessage: string): Promise<string> {
    logger.divider("CODE REVIEW AGENT - NUEVA TAREA");
    logger.agent(`Review request: ${userMessage}`);

    this.conversationHistory.push({ role: "user", content: userMessage });
    this.iterationCount = 0;
    let trimRetries = 0;
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
        if (llmErr.isContextTooLarge || (llmErr as { allFailed?: boolean }).allFailed) {
          trimRetries++;
          if (trimRetries > MAX_TRIM_RETRIES) {
            this.conversationHistory = [{ role: "user", content: userMessage }];
            trimRetries = 0;
          } else {
            this.trimHistory();
          }
          continue;
        }
        throw err;
      }

      const message = response.choices[0].message as ChatMessage;
      this.conversationHistory.push(message);

      if (!message.tool_calls || message.tool_calls.length === 0) {
        logger.divider("CODE REVIEW COMPLETO");
        logger.agent(message.content ?? "(sin contenido)");
        logger.info(`✅ Completado en ${this.iterationCount} iteraciones`);
        const final = message.content ?? "Review completado.";
        const doneEvent: DoneEvent = { content: final, iterations: this.iterationCount, toolCalls: this.totalToolCalls };
        this.events.emit("done", doneEvent);
        return final;
      }

      const toolResults = await this.executeToolCalls(message.tool_calls);
      this.conversationHistory.push(...toolResults);

      if (this.iterationCount >= config.maxIterations) {
        const msg = `⚠️ Límite de ${config.maxIterations} iteraciones alcanzado.`;
        logger.warn(msg);
        this.events.emit("done", { content: msg, iterations: this.iterationCount, toolCalls: this.totalToolCalls });
        return msg;
      }
    }

    return "Tarea finalizada.";
  }

  private async callLLM(tools: OpenAITool[]): Promise<OpenAI.ChatCompletion> {
    const onEvent = (event: ProviderSwitchEvent) => this.events.emit("providerSwitch", event);

    return this.registry.callWithFallback(async (provider) => {
      const messages = [
        { role: "system", content: SYSTEM_PROMPT },
        ...this.conversationHistory,
      ];

      const isOSeries = /^o\d/i.test(provider.model);
      const isClaude = provider.model.startsWith("claude-");

      const response = await provider.client.chat.completions.create({
        model: provider.model,
        messages: messages as Parameters<typeof provider.client.chat.completions.create>[0]["messages"],
        tools: tools as Parameters<typeof provider.client.chat.completions.create>[0]["tools"],
        tool_choice: "auto",
        ...(!isOSeries && !isClaude && { parallel_tool_calls: false }),
        ...(!isOSeries && { temperature: 0.1 }),
        ...(isOSeries ? { max_completion_tokens: 4096 } : { max_tokens: 4096 }),
      });

      return response as OpenAI.ChatCompletion;
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

      logger.tool(toolName, `args: ${JSON.stringify(toolArgs)}`);
      const toolEvent: ToolEvent = { name: toolName, args: toolArgs };
      this.events.emit("tool", toolEvent);

      let resultText: string;
      try {
        const result = await this.mcpClient.callTool(toolName, toolArgs);
        resultText = this.mcpClient.extractText(result);
        this.totalToolCalls++;
        logger.debug(`Tool ${toolName} OK: ${resultText.substring(0, 100)}...`);
      } catch (err) {
        resultText = `❌ Error en ${toolName}: ${(err as Error).message}`;
        logger.error(resultText);
      }

      if (resultText.length > config.maxResultChars) {
        resultText = resultText.substring(0, config.maxResultChars) + "\n...[truncado]";
      }

      results.push({ role: "tool", tool_call_id: toolCall.id, content: resultText });
    }

    return results;
  }

  private trimHistory(): void {
    if (this.conversationHistory.length <= config.maxHistoryMsgs) return;
    const keep = Math.floor(config.maxHistoryMsgs / 2);
    const head = this.conversationHistory.slice(0, 1);
    const tail = this.conversationHistory.slice(-keep);
    this.conversationHistory = [...head, ...tail];
  }

  hasProviders(): boolean {
    return this.registry.hasProviders();
  }

  reloadProviders(): void {
    this.registry.reload();
  }

  clearHistory(): void {
    this.conversationHistory = [];
    this.iterationCount = 0;
    this.totalToolCalls = 0;
  }

  getStats(): AgentStats {
    const current = this.registry.currentProvider;
    return {
      messages: this.conversationHistory.length,
      iterations: this.iterationCount,
      toolCalls: this.totalToolCalls,
      model: current.model,
      provider: current.name,
      providers: this.registry.list(),
    };
  }
}
