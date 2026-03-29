// =============================================
//   MCP Client
//   Se conecta al MCP Server via stdio transport
//   Descubre tools y las expone al agente
// =============================================

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "../utils/logger.js";
import type { OpenAITool } from "../types/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface MCPTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface ToolListItem {
  name: string;
  description?: string;
}

export class MCPClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private tools: MCPTool[] = [];
  private connected = false;

  /**
   * Conecta al MCP Server lanzándolo como subproceso via stdio.
   */
  async connect(): Promise<void> {
    if (this.connected) {
      logger.warn("MCPClient ya está conectado.");
      return;
    }

    // Soporte para dev (tsx) y producción (node)
    const isDev = import.meta.url.endsWith(".ts");
    const serverFile = isDev ? "server.ts" : "server.js";
    const command = isDev ? "tsx" : "node";
    const serverPath = path.resolve(__dirname, serverFile);

    logger.info(`Conectando al MCP Server: ${serverPath}`);

    this.transport = new StdioClientTransport({
      command,
      args: [serverPath],
      env: { ...process.env } as Record<string, string>,
    });

    this.client = new Client({
      name: "mcp-dev-agent-client",
      version: "1.0.0",
    });

    await this.client.connect(this.transport);
    this.connected = true;

    await this.discoverTools();

    logger.success(`MCP Client conectado. ${this.tools.length} herramientas disponibles.`);
  }

  /**
   * Descubre las tools registradas en el server.
   */
  async discoverTools(): Promise<MCPTool[]> {
    const response = await this.client!.listTools();
    this.tools = (response.tools ?? []) as MCPTool[];

    logger.debug(`Tools descubiertas: ${this.tools.map((t) => t.name).join(", ")}`);
    return this.tools;
  }

  /**
   * Convierte las tools MCP al formato de function calling (compatible con
   * OpenAI, Groq, OpenRouter, Mistral, Ollama, etc.)
   */
  getTools(): OpenAITool[] {
    return this.tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description ?? "",
        parameters: (tool.inputSchema ?? { type: "object", properties: {} }) as Record<string, unknown>,
      },
    }));
  }

  /** @deprecated Usa getTools() */
  getToolsForOpenAI(): OpenAITool[] {
    return this.getTools();
  }

  /**
   * Invoca una tool en el MCP Server por nombre y argumentos.
   */
  async callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.connected || !this.client) {
      throw new Error("MCPClient no está conectado. Llama a connect() primero.");
    }

    logger.debug(`Llamando tool: ${name} con args: ${JSON.stringify(args)}`);

    return this.client.callTool({ name, arguments: args });
  }

  /**
   * Extrae el texto de la respuesta de una tool.
   */
  extractText(toolResult: unknown): string {
    const result = toolResult as { content?: Array<{ type: string; text: string }> };
    if (!result?.content) return "";

    return result.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");
  }

  /**
   * Desconecta del MCP Server.
   */
  async disconnect(): Promise<void> {
    if (this.transport) {
      await this.transport.close();
      this.connected = false;
      logger.info("MCP Client desconectado.");
    }
  }

  /**
   * Retorna la lista de tools con nombre y descripción.
   */
  listTools(): ToolListItem[] {
    return this.tools.map((t) => ({
      name: t.name,
      description: t.description,
    }));
  }
}
