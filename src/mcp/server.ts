// =============================================
//   MCP Server Oficial
//   Implementación usando @modelcontextprotocol/sdk
//   Expone todas las tools via stdio transport
// =============================================

import "dotenv/config";

// --workspace /ruta  sobreescribe WORKSPACE_DIR del .env
const wsArgIndex = process.argv.findIndex((a) => a === "--workspace" || a === "-w");
if (wsArgIndex !== -1 && process.argv[wsArgIndex + 1]) {
  process.env.WORKSPACE_DIR = process.argv[wsArgIndex + 1];
}

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "fs/promises";

import {
  readFile, writeFile, listDirectory, deleteFile, createDirectory,
  applyDiff, searchFiles, readFileRange, appendFile, renameFile, moveFile, copyFile,
  replaceInFile,
} from "../tools/filesystem.js";
import { runCommand, runTests } from "../tools/terminal.js";
import {
  gitInit, gitStatus, gitAdd, gitCommit, gitLog,
  gitDiff, gitBranch, gitCheckout, gitRestore,
} from "../tools/git.js";
import { logger } from "../utils/logger.js";
import { getWorkspaceDir } from "../utils/security.js";

// ─── Inicialización del Workspace ────────────────────────────────────────────

async function ensureWorkspace(): Promise<void> {
  const workspaceDir = getWorkspaceDir();
  await fs.mkdir(workspaceDir, { recursive: true });
  logger.info(`Workspace: ${workspaceDir}`);
}

// ─── Creación del MCP Server ─────────────────────────────────────────────────

const server = new McpServer({
  name: "mcp-dev-agent-server",
  version: "1.0.0",
});

// ─── Registro de Tools: Filesystem ───────────────────────────────────────────

server.tool(
  "read_file",
  "Lee el contenido completo de un archivo en el workspace. Devuelve el texto, tamaño y número de líneas.",
  {
    path: z.string().describe("Ruta relativa del archivo dentro del workspace (ej: 'src/index.js')"),
  },
  async (args) => {
    try {
      return await readFile(args);
    } catch (err) {
      return { content: [{ type: "text", text: `❌ Error en read_file: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.tool(
  "write_file",
  "Escribe o sobreescribe un archivo en el workspace. Crea los directorios intermedios automáticamente.",
  {
    path: z.string().describe("Ruta relativa del archivo a crear/modificar"),
    content: z.string().describe("Contenido completo a escribir en el archivo"),
    create_dirs: z.boolean().optional().default(true).describe("Crear directorios intermedios si no existen"),
  },
  async (args) => {
    try {
      return await writeFile(args);
    } catch (err) {
      return { content: [{ type: "text", text: `❌ Error en write_file: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.tool(
  "list_directory",
  "Lista el contenido de un directorio en el workspace mostrando archivos y subdirectorios.",
  {
    path: z.string().optional().default(".").describe("Ruta relativa del directorio (por defecto raíz del workspace)"),
    recursive: z.boolean().optional().default(false).describe("Si true, lista recursivamente todos los subdirectorios"),
  },
  async (args) => {
    try {
      return await listDirectory(args);
    } catch (err) {
      return { content: [{ type: "text", text: `❌ Error en list_directory: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.tool(
  "delete_file",
  "Elimina un archivo del workspace. No puede eliminar directorios.",
  {
    path: z.string().describe("Ruta relativa del archivo a eliminar"),
  },
  async (args) => {
    try {
      return await deleteFile(args);
    } catch (err) {
      return { content: [{ type: "text", text: `❌ Error en delete_file: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.tool(
  "create_directory",
  "Crea un directorio (y todos los padres necesarios) en el workspace.",
  {
    path: z.string().describe("Ruta relativa del directorio a crear"),
  },
  async (args) => {
    try {
      return await createDirectory(args);
    } catch (err) {
      return { content: [{ type: "text", text: `❌ Error en create_directory: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ─── Registro de Tools: Terminal ─────────────────────────────────────────────

server.tool(
  "run_command",
  "Ejecuta un comando de shell en el workspace. Devuelve stdout, stderr y código de salida. Los comandos peligrosos están bloqueados.",
  {
    command: z.string().describe("Comando a ejecutar (ej: 'npm install', 'node index.js', 'ls -la')"),
    cwd: z.string().optional().describe("Subdirectorio del workspace donde ejecutar el comando"),
    timeout: z.number().optional().describe("Timeout en milisegundos (por defecto 30000)"),
  },
  async (args) => {
    try {
      return await runCommand(args);
    } catch (err) {
      return { content: [{ type: "text", text: `❌ Error en run_command: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ─── Registro de Tools: Git ───────────────────────────────────────────────────

server.tool(
  "git_init",
  "Inicializa un repositorio git en un directorio del workspace.",
  {
    path: z.string().optional().default(".").describe("Directorio donde inicializar el repo"),
  },
  async (args) => {
    try {
      return await gitInit(args);
    } catch (err) {
      return { content: [{ type: "text", text: `❌ Error en git_init: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.tool(
  "git_status",
  "Muestra el estado actual del repositorio git (archivos modificados, staged, untracked).",
  {
    path: z.string().optional().default(".").describe("Directorio del repositorio"),
  },
  async (args) => {
    try {
      return await gitStatus(args);
    } catch (err) {
      return { content: [{ type: "text", text: `❌ Error en git_status: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.tool(
  "git_add",
  "Agrega archivos al staging area de git.",
  {
    path: z.string().optional().default(".").describe("Directorio del repositorio"),
    files: z.union([z.string(), z.array(z.string())]).optional().default(".").describe("Archivos a agregar (por defecto todos)"),
  },
  async (args) => {
    try {
      return await gitAdd(args);
    } catch (err) {
      return { content: [{ type: "text", text: `❌ Error en git_add: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.tool(
  "git_commit",
  "Realiza un commit con los archivos en staging.",
  {
    path: z.string().optional().default(".").describe("Directorio del repositorio"),
    message: z.string().describe("Mensaje descriptivo del commit"),
  },
  async (args) => {
    try {
      return await gitCommit(args);
    } catch (err) {
      return { content: [{ type: "text", text: `❌ Error en git_commit: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.tool(
  "git_log",
  "Muestra el historial de commits del repositorio.",
  {
    path: z.string().optional().default(".").describe("Directorio del repositorio"),
    limit: z.number().optional().default(10).describe("Número máximo de commits a mostrar"),
  },
  async (args) => {
    try {
      return await gitLog(args);
    } catch (err) {
      return { content: [{ type: "text", text: `❌ Error en git_log: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ─── Registro de Tools: Filesystem (nuevas) ──────────────────────────────────

server.tool(
  "apply_diff",
  "Aplica un patch en formato unified diff a un archivo del workspace. Permite modificar archivos sin reescribirlos por completo.",
  {
    path: z.string().describe("Ruta relativa del archivo objetivo dentro del workspace"),
    diff: z.string().describe("Contenido del patch en formato unified diff (--- / +++ / @@)"),
  },
  async (args) => {
    try {
      return await applyDiff(args);
    } catch (err) {
      return { content: [{ type: "text", text: `❌ Error en apply_diff: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.tool(
  "replace_in_file",
  "Reemplaza una cadena exacta dentro de un archivo. Más confiable que apply_diff: no requiere números de línea ni contexto, solo el texto exacto a reemplazar. Úsalo como fallback cuando apply_diff falla.",
  {
    path: z.string().describe("Ruta relativa del archivo a modificar"),
    old_string: z.string().describe("Texto exacto a buscar y reemplazar (debe coincidir carácter por carácter, incluyendo espacios e indentación)"),
    new_string: z.string().describe("Texto de reemplazo"),
    replace_all: z.boolean().optional().default(false).describe("Si true, reemplaza todas las ocurrencias. Por defecto solo la primera."),
  },
  async (args) => {
    try {
      return await replaceInFile(args);
    } catch (err) {
      return { content: [{ type: "text", text: `❌ Error en replace_in_file: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.tool(
  "search_files",
  "Busca texto o expresiones regulares en todos los archivos del workspace. Devuelve las líneas coincidentes con su ruta y número de línea.",
  {
    pattern: z.string().describe("Texto o expresión regular a buscar"),
    path: z.string().optional().default(".").describe("Directorio donde buscar (por defecto raíz del workspace)"),
    include: z.string().optional().describe("Filtro de extensión, ej: '*.ts', '*.py'"),
    case_sensitive: z.boolean().optional().default(true).describe("Búsqueda sensible a mayúsculas (por defecto true)"),
  },
  async (args) => {
    try {
      return await searchFiles(args);
    } catch (err) {
      return { content: [{ type: "text", text: `❌ Error en search_files: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.tool(
  "read_file_range",
  "Lee solo un rango de líneas de un archivo. Útil para archivos grandes o para inspeccionar secciones específicas.",
  {
    path: z.string().describe("Ruta relativa del archivo"),
    start_line: z.number().int().min(1).describe("Número de línea inicial (inclusivo, desde 1)"),
    end_line: z.number().int().min(1).describe("Número de línea final (inclusivo)"),
  },
  async (args) => {
    try {
      return await readFileRange(args);
    } catch (err) {
      return { content: [{ type: "text", text: `❌ Error en read_file_range: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.tool(
  "append_file",
  "Agrega contenido al final de un archivo sin borrar lo existente. Crea el archivo si no existe.",
  {
    path: z.string().describe("Ruta relativa del archivo"),
    content: z.string().describe("Contenido a agregar al final del archivo"),
  },
  async (args) => {
    try {
      return await appendFile(args);
    } catch (err) {
      return { content: [{ type: "text", text: `❌ Error en append_file: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.tool(
  "rename_file",
  "Renombra un archivo dentro de su mismo directorio.",
  {
    path: z.string().describe("Ruta relativa del archivo a renombrar"),
    new_name: z.string().describe("Nuevo nombre del archivo (solo el nombre, sin ruta)"),
  },
  async (args) => {
    try {
      return await renameFile(args);
    } catch (err) {
      return { content: [{ type: "text", text: `❌ Error en rename_file: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.tool(
  "move_file",
  "Mueve un archivo a otra ubicación dentro del workspace. Crea los directorios intermedios si es necesario.",
  {
    path: z.string().describe("Ruta relativa del archivo a mover"),
    destination: z.string().describe("Ruta de destino (incluyendo el nombre del archivo)"),
  },
  async (args) => {
    try {
      return await moveFile(args);
    } catch (err) {
      return { content: [{ type: "text", text: `❌ Error en move_file: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.tool(
  "copy_file",
  "Copia un archivo a otra ubicación dentro del workspace. Crea los directorios intermedios si es necesario.",
  {
    path: z.string().describe("Ruta relativa del archivo origen"),
    destination: z.string().describe("Ruta de destino de la copia (incluyendo el nombre del archivo)"),
  },
  async (args) => {
    try {
      return await copyFile(args);
    } catch (err) {
      return { content: [{ type: "text", text: `❌ Error en copy_file: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ─── Registro de Tools: Terminal (nuevas) ────────────────────────────────────

server.tool(
  "run_tests",
  "Ejecuta los tests del proyecto automáticamente. Detecta el framework (npm, pytest, go test, cargo) o acepta un comando personalizado.",
  {
    path: z.string().optional().default(".").describe("Directorio del proyecto donde correr los tests"),
    command: z.string().optional().describe("Comando de tests personalizado (si no se especifica, se auto-detecta)"),
  },
  async (args) => {
    try {
      return await runTests(args);
    } catch (err) {
      return { content: [{ type: "text", text: `❌ Error en run_tests: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ─── Registro de Tools: Git (nuevas) ─────────────────────────────────────────

server.tool(
  "git_diff",
  "Muestra los cambios línea por línea en el repositorio. Puede mostrar cambios staged o unstaged, opcionalmente filtrados por archivo.",
  {
    path: z.string().optional().default(".").describe("Directorio del repositorio"),
    staged: z.boolean().optional().default(false).describe("Si true, muestra cambios en el staging area"),
    file: z.string().optional().describe("Archivo específico a comparar (opcional)"),
  },
  async (args) => {
    try {
      return await gitDiff(args);
    } catch (err) {
      return { content: [{ type: "text", text: `❌ Error en git_diff: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.tool(
  "git_branch",
  "Gestiona ramas de git: lista todas las ramas, crea una nueva o elimina una existente.",
  {
    path: z.string().optional().default(".").describe("Directorio del repositorio"),
    action: z.enum(["list", "create", "delete"]).optional().default("list").describe("Acción a realizar"),
    name: z.string().optional().describe("Nombre de la rama (requerido para create/delete)"),
  },
  async (args) => {
    try {
      return await gitBranch(args);
    } catch (err) {
      return { content: [{ type: "text", text: `❌ Error en git_branch: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.tool(
  "git_checkout",
  "Cambia de rama o restaura un commit específico. Puede crear la rama si no existe.",
  {
    path: z.string().optional().default(".").describe("Directorio del repositorio"),
    target: z.string().describe("Nombre de la rama o hash del commit al que cambiar"),
    create: z.boolean().optional().default(false).describe("Si true, crea la rama si no existe (-b)"),
  },
  async (args) => {
    try {
      return await gitCheckout(args);
    } catch (err) {
      return { content: [{ type: "text", text: `❌ Error en git_checkout: ${(err as Error).message}` }], isError: true };
    }
  }
);

server.tool(
  "git_restore",
  "Descarta cambios en archivos (equivalente a git restore). Puede deshacer cambios del working tree o del staging area.",
  {
    path: z.string().optional().default(".").describe("Directorio del repositorio"),
    files: z.union([z.string(), z.array(z.string())]).optional().describe("Archivos a restaurar (por defecto todos)"),
    staged: z.boolean().optional().default(false).describe("Si true, retira los archivos del staging area"),
  },
  async (args) => {
    try {
      return await gitRestore(args);
    } catch (err) {
      return { content: [{ type: "text", text: `❌ Error en git_restore: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ─── Arranque del Server ──────────────────────────────────────────────────────

async function main(): Promise<void> {
  await ensureWorkspace();

  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info("MCP Dev Agent Server iniciado correctamente.");
  logger.info(`Herramientas disponibles: ${[
    "read_file", "write_file", "list_directory", "delete_file", "create_directory",
    "apply_diff", "replace_in_file", "search_files", "read_file_range", "append_file",
    "rename_file", "move_file", "copy_file",
    "run_command", "run_tests",
    "git_init", "git_status", "git_add", "git_commit", "git_log",
    "git_diff", "git_branch", "git_checkout", "git_restore",
  ].join(", ")}`);
}

main().catch((err: Error) => {
  logger.error("Error fatal en MCP Server:", err);
  process.exit(1);
});
