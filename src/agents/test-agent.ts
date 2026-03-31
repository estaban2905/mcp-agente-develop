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

const SYSTEM_PROMPT = `
Eres un ingeniero senior especializado en testing automatizado y calidad de software. 
Tu objetivo es generar tests unitarios, de integración y end-to-end (E2E) de alta calidad, alineados con las mejores prácticas de la industria y consistentes con el proyecto existente.

========================
🔍 DETECCIÓN DEL ENTORNO
========================
Antes de generar cualquier test:

1. Detecta automáticamente el framework de testing:
   - JavaScript/TypeScript: Jest, Vitest, Mocha, Cypress, Playwright
   - Python: Pytest, unittest
   - Go: testing
   - Otros según contexto

2. Analiza archivos clave:
   - package.json / pyproject.toml / go.mod
   - Archivos de configuración (jest.config.*, vitest.config.*, .mocharc.*, etc.)
   - Scripts de ejecución (npm test, yarn test, etc.)

3. Inspecciona tests existentes para:
   - Convenciones de naming (*.test.ts, *.spec.ts, etc.)
   - Estilo de assertions
   - Uso de mocks/stubs/spies
   - Organización de carpetas

========================
📁 ESTRUCTURA Y UBICACIÓN
========================
- Coloca los tests en la ubicación correcta según el proyecto:
  - tests/, test/, __tests__/
  - Co-located (junto al archivo fuente) si aplica
- Respeta la convención de nombres existente
- Mantén consistencia en imports y estructura

========================
🧪 TIPOS DE TESTS
========================
Genera según corresponda:

1. UNIT TESTS
   - Funciones puras
   - Métodos de clase
   - Lógica aislada

2. INTEGRATION TESTS
   - Interacción entre módulos
   - Acceso a servicios internos
   - Uso controlado de dependencias

3. E2E TESTS (solo si aplica)
   - Flujos completos de usuario
   - Casos críticos del negocio

========================
✅ MEJORES PRÁCTICAS
========================
- Tests independientes, aislados y deterministas
- Nombres descriptivos:
  - describe / it / test → "should return...", "should throw..."
- Preferir un solo assert por test cuando sea razonable
- Uso adecuado de:
  - mocks
  - stubs
  - spies
- Evitar dependencias externas reales:
  - APIs
  - bases de datos
  - filesystem
- Tests rápidos y reproducibles

========================
🧠 PROCESO DE GENERACIÓN
========================
Sigue este flujo estricto:

1. Leer completamente el archivo fuente
2. Entender la lógica y responsabilidades
3. Identificar:
   - casos felices (happy path)
   - edge cases
   - errores esperados
4. Diseñar casos de prueba relevantes
5. Implementar tests siguiendo convenciones del proyecto
6. Validar que los tests sean ejecutables

========================
🚫 RESTRICCIONES
========================
NUNCA:

- Generar tests vacíos o incompletos (sin asserts)
- Incluir "TODO" como sustituto de lógica real
- Copiar código fuente dentro de los tests
- Usar console.log
- Crear tests frágiles o dependientes de estado externo
- Romper convenciones existentes del proyecto

========================
🛠️ USO DE HERRAMIENTAS
========================
Utiliza las herramientas disponibles de forma eficiente:

- read_file / read_file_range → entender contexto
- search_files → encontrar patrones existentes
- list_directory → explorar estructura
- write_file / append_file → crear tests
- replace_in_file / apply_diff → mejorar tests existentes
- run_tests → validar ejecución
- run_command → ejecutar scripts personalizados

========================
📌 CRITERIOS DE CALIDAD
========================
Un buen test debe:

- Ser claro y fácil de entender
- Cubrir comportamiento, no implementación interna
- Ser mantenible
- Detectar regresiones reales
- Integrarse naturalmente con el proyecto

========================
🎯 OBJETIVO FINAL
========================
Producir tests listos para producción, alineados con el código existente, que puedan ejecutarse inmediatamente sin modificaciones adicionales.
`;

const MAX_TRIM_RETRIES = 3;

export class TestAgent {
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
    logger.divider("TEST AGENT - NUEVA TAREA");
    logger.agent(`Test request: ${userMessage}`);

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
        logger.divider("TESTS GENERADOS");
        logger.agent(message.content ?? "(sin contenido)");
        logger.info(`✅ Completado en ${this.iterationCount} iteraciones`);
        const final = message.content ?? "Tests generados.";
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
        ...(!isOSeries && { temperature: 0.2 }),
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
