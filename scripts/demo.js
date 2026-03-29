// =============================================
//   Script de demostración
//   Ejecuta el caso de uso: "Crear API de usuarios"
//   sin necesidad del CLI interactivo
// =============================================

import "dotenv/config";
import chalk from "chalk";
import { MCPClient } from "../src/mcp/client.js";
import { DevAgent } from "../src/agent/agent.js";
import { logger } from "../src/utils/logger.js";

const DEMO_TASKS = [
  {
    name: "Crear API REST de Usuarios",
    prompt: `Crea una API REST de usuarios completa usando Node.js y Express.
    
    Requisitos:
    - CRUD completo: GET /users, GET /users/:id, POST /users, PUT /users/:id, DELETE /users/:id
    - Validación de campos (nombre, email obligatorios, email válido)
    - Manejo de errores con códigos HTTP apropiados (400, 404, 201, etc.)
    - IDs auto-generados con Date.now()
    - Datos almacenados en memoria (array)
    - Middleware: express.json(), CORS básico
    - package.json con scripts: start, dev
    - README.md completo con: descripción, instalación, endpoints documentados, ejemplos curl
    - Al final, inicializa git y haz commit inicial
    
    Estructura de carpetas sugerida:
    users-api/
      src/
        routes/users.js
        middleware/validation.js
      index.js
      package.json
      README.md`,
  },
  {
    name: "Crear Utilidad CLI de Fibonacci",
    prompt: `Crea una herramienta CLI en Node.js que:
    - Calcule la secuencia de Fibonacci hasta el término N
    - Acepte N como argumento: node fibonacci.js 10
    - Muestre la secuencia, el tiempo de cálculo y estadísticas
    - Soporte memoización para números grandes
    - Incluya tests básicos con Node.js assert
    - README con ejemplos de uso`,
  },
];

async function runDemo(taskIndex = 0) {
  const task = DEMO_TASKS[taskIndex] || DEMO_TASKS[0];

  console.log(chalk.cyan(`
╔══════════════════════════════════════════════╗
║   MCP Dev Agent - DEMO                       ║
║   Tarea: ${task.name.padEnd(36)}║
╚══════════════════════════════════════════════╝
`));

  if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.includes("xxx")) {
    console.error(chalk.red("❌ Configura OPENAI_API_KEY en .env antes de ejecutar el demo."));
    process.exit(1);
  }

  const mcpClient = new MCPClient();

  try {
    logger.info("Conectando al MCP Server...");
    await mcpClient.connect();

    const agent = new DevAgent(mcpClient);

    console.log(chalk.yellow(`\n📋 Tarea a ejecutar:\n${task.prompt}\n`));
    logger.divider("INICIANDO DEMO");

    const startTime = Date.now();
    const response = await agent.processMessage(task.prompt);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    logger.divider("DEMO COMPLETADO");
    console.log(chalk.green(`\n✅ Completado en ${elapsed}s`));
    console.log(chalk.white("\n📝 Respuesta final del agente:"));
    console.log(chalk.white(response));

    const stats = agent.getStats();
    console.log(chalk.gray(`\n📊 Stats: ${stats.iterations} iteraciones, ${stats.toolCalls} tool calls`));
    console.log(chalk.cyan(`\n💡 Revisa el workspace para ver los archivos generados.\n`));
  } catch (err) {
    logger.error(`Error en demo: ${err.message}`);
    console.error(err);
  } finally {
    await mcpClient.disconnect();
  }
}

// Permitir seleccionar demo por argumento: node scripts/demo.js 1
const taskIndex = parseInt(process.argv[2] || "0", 10);
runDemo(taskIndex);
