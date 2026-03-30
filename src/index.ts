// =============================================
//   MCP Dev Agent - Punto de entrada principal
//   CLI interactiva para el agente de desarrollo
// =============================================

import "dotenv/config";

// --workspace /ruta  sobreescribe WORKSPACE_DIR del .env
const wsArgIndex = process.argv.findIndex((a) => a === "--workspace" || a === "-w");
if (wsArgIndex !== -1 && process.argv[wsArgIndex + 1]) {
  process.env.WORKSPACE_DIR = process.argv[wsArgIndex + 1];
}

import readline from "readline";
import chalk from "chalk";
import { MCPClient } from "./mcp/client.js";
import { DevAgent } from "./agent/agent.js";
import { logger } from "./utils/logger.js";
import type { ConfirmEvent } from "./types/index.js";

// ─── Validaciones previas ─────────────────────────────────────────────────────

function validateEnvironment(): void {
  const apiKey = process.env.AI_API_KEY ?? process.env.OPENAI_API_KEY;

  if (!apiKey) {
    console.error(chalk.red("\n❌ Falta la API key."));
    console.error(chalk.yellow("   Configura AI_API_KEY en tu archivo .env"));
    console.error(chalk.yellow("   Ejemplos de proveedores compatibles:"));
    console.error(chalk.gray("     OpenAI    : AI_BASE_URL no requerido, clave sk-..."));
    console.error(chalk.gray("     Groq      : AI_BASE_URL=https://api.groq.com/openai/v1"));
    console.error(chalk.gray("     OpenRouter: AI_BASE_URL=https://openrouter.ai/api/v1"));
    console.error(chalk.gray("     Mistral   : AI_BASE_URL=https://api.mistral.ai/v1"));
    console.error(chalk.gray("     Ollama    : AI_BASE_URL=http://localhost:11434/v1, AI_API_KEY=ollama\n"));
    process.exit(1);
  }
}

// ─── Banner de bienvenida ─────────────────────────────────────────────────────

function printBanner(): void {
  const model     = process.env.AI_MODEL ?? process.env.OPENAI_MODEL ?? "gpt-4o";
  const provider  = process.env.AI_BASE_URL ?? "OpenAI (default)";
  const workspace = process.env.WORKSPACE_DIR ?? "./workspace";

  console.log(chalk.cyan(`
╔══════════════════════════════════════════════════════════╗
║                                                          ║
║        🤖  MCP Dev Agent  v1.0.0                         ║
║        Agente de Desarrollo con Model Context Protocol   ║
║                                                          ║
║  Modelo   : ${model.padEnd(45)}║
║  Proveedor: ${provider.padEnd(45)}║
║  Workspace: ${workspace.padEnd(45)}║
║                                                          ║
╚══════════════════════════════════════════════════════════╝
`));

  console.log(chalk.gray("Comandos especiales:"));
  console.log(chalk.gray("  /tools    - Lista las herramientas disponibles"));
  console.log(chalk.gray("  /stats    - Muestra estadísticas de la sesión"));
  console.log(chalk.gray("  /clear    - Limpia el historial de conversación"));
  console.log(chalk.gray("  /exit     - Sale del programa"));
  console.log(chalk.gray("  /demo     - Ejecuta demo: crear API de usuarios"));
  console.log("");
}

// ─── Comandos especiales del CLI ──────────────────────────────────────────────

function handleSpecialCommand(
  cmd: string,
  agent: DevAgent,
  mcpClient: MCPClient
): boolean | "exit" {
  const command = cmd.trim().toLowerCase();

  switch (command) {
    case "/tools":
      console.log(chalk.blue("\n🔧 Herramientas disponibles:"));
      mcpClient.listTools().forEach((tool) => {
        console.log(chalk.blue(`  • ${tool.name.padEnd(25)}`) + chalk.gray(tool.description ?? ""));
      });
      console.log("");
      return true;

    case "/stats": {
      const stats = agent.getStats();
      console.log(chalk.blue("\n📊 Estadísticas de la sesión:"));
      console.log(chalk.blue(`  Mensajes en contexto : ${stats.messages}`));
      console.log(chalk.blue(`  Iteraciones usadas   : ${stats.iterations}`));
      console.log(chalk.blue(`  Tool calls totales   : ${stats.toolCalls}`));
      console.log("");
      return true;
    }

    case "/clear":
      agent.clearHistory();
      console.log(chalk.green("\n✅ Historial limpiado. Nueva sesión iniciada.\n"));
      return true;

    case "/demo":
      return false; // Procesado externamente

    case "/exit":
    case "/quit":
      return "exit";

    default:
      if (command.startsWith("/")) {
        console.log(chalk.yellow(`\n⚠️  Comando desconocido: ${cmd}\n`));
        return true;
      }
      return false;
  }
}

// ─── Loop de conversación interactiva ────────────────────────────────────────

async function startInteractiveCLI(agent: DevAgent, mcpClient: MCPClient): Promise<void> {
  const rl = readline.createInterface({
    input:  process.stdin,
    output: process.stdout,
  });

  const question = (prompt: string): Promise<string> =>
    new Promise((resolve) => rl.question(prompt, resolve));

  agent.events.on("confirm", async (event: ConfirmEvent) => {
    console.log(chalk.yellow(`\n⚠️  Acción peligrosa — requiere autorización:`));
    console.log(chalk.yellow(`   Herramienta : ${event.toolName}`));
    console.log(chalk.yellow(`   Argumentos  : ${JSON.stringify(event.args)}`));
    const answer = await question(chalk.bold.yellow("   ¿Autorizar? (s/n) › "));
    const approved = ["s", "si", "sí", "y", "yes"].includes(answer.trim().toLowerCase());
    event.resolve(approved);
    console.log(approved ? chalk.green("   ✅ Autorizado.\n") : chalk.red("   ❌ Cancelado.\n"));
  });

  console.log(chalk.green("✅ Agente listo. Escribe tu tarea o /demo para ver un ejemplo.\n"));

  while (true) {
    let input: string;

    try {
      input = await question(chalk.bold.cyan("🧑 Tú › ") + chalk.white(""));
    } catch {
      break; // EOF
    }

    const trimmed = input.trim();
    if (!trimmed) continue;

    const specialResult = handleSpecialCommand(trimmed, agent, mcpClient);

    if (specialResult === "exit") {
      console.log(chalk.gray("\nHasta luego! 👋\n"));
      break;
    }

    if (specialResult === true) continue;

    const taskToRun =
      trimmed === "/demo"
        ? "Crea una API REST de usuarios completa usando Node.js y Express. " +
          "Debe incluir: CRUD completo (GET /users, GET /users/:id, POST /users, PUT /users/:id, DELETE /users/:id), " +
          "validación de datos, manejo de errores, datos en memoria (array), " +
          "package.json con scripts, README.md con instrucciones de uso y ejemplos curl. " +
          "Al final inicializa un repositorio git y haz el primer commit."
        : trimmed;

    console.log("");

    try {
      const response = await agent.processMessage(taskToRun);
      console.log("\n" + chalk.bold.green("🤖 Agente › ") + chalk.white(response) + "\n");
    } catch (err) {
      const error = err as Error;
      console.error(chalk.red(`\n❌ Error del agente: ${error.message}\n`));

      if (error.message.includes("API Key")) {
        console.error(chalk.yellow("Verifica tu OPENAI_API_KEY en el archivo .env"));
        break;
      }
    }
  }

  rl.close();
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  validateEnvironment();
  printBanner();

  const mcpClient = new MCPClient();

  try {
    logger.info("Iniciando MCP Client...");
    await mcpClient.connect();
  } catch (err) {
    logger.error(`No se pudo conectar al MCP Server: ${(err as Error).message}`);
    process.exit(1);
  }

  const agent = new DevAgent(mcpClient);

  process.on("SIGINT", async () => {
    console.log(chalk.gray("\n\nDesconectando..."));
    await mcpClient.disconnect();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await mcpClient.disconnect();
    process.exit(0);
  });

  process.on("unhandledRejection", (reason) => {
    logger.error("Promesa rechazada sin manejar:", reason);
  });

  await startInteractiveCLI(agent, mcpClient);

  await mcpClient.disconnect();
  process.exit(0);
}

main().catch((err: Error) => {
  logger.error("Error fatal:", err);
  process.exit(1);
});
