// =============================================
//   Git Tools: init, status, add, commit, log
// =============================================

import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import { getWorkspaceDir } from "../utils/security.js";
import { logger } from "../utils/logger.js";
import type {
  ToolResult,
  GitExecResult,
  GitBaseParams,
  GitAddParams,
  GitCommitParams,
  GitLogParams,
  GitDiffParams,
  GitBranchParams,
  GitCheckoutParams,
  GitRestoreFilesParams,
} from "../types/index.js";

const execAsync = promisify(exec);

async function gitExec(args: string, cwd?: string): Promise<GitExecResult> {
  const workspaceDir = getWorkspaceDir();
  const workDir = cwd ? path.resolve(workspaceDir, cwd) : workspaceDir;

  if (!workDir.startsWith(workspaceDir)) {
    throw new Error("Ruta fuera del workspace.");
  }

  logger.debug(`git ${args} en ${workDir}`);

  try {
    const { stdout, stderr } = await execAsync(`git ${args}`, {
      cwd: workDir,
      timeout: 15000,
    });
    return { stdout: stdout.trim(), stderr: stderr.trim(), success: true };
  } catch (err) {
    const error = err as { stdout?: string; stderr?: string; message: string };
    return {
      stdout: error.stdout?.trim() ?? "",
      stderr: error.stderr?.trim() ?? error.message,
      success: false,
    };
  }
}

/**
 * Inicializa un repositorio git.
 */
export async function gitInit({ path: dirPath = "." }: GitBaseParams): Promise<ToolResult> {
  logger.tool("git_init", dirPath);

  const result = await gitExec("init", dirPath);
  const msg = result.success
    ? `✅ Repositorio git inicializado en: ${dirPath}`
    : `❌ Error: ${result.stderr}`;

  return { content: [{ type: "text", text: msg }] };
}

/**
 * Muestra el estado del repositorio.
 */
export async function gitStatus({ path: dirPath = "." }: GitBaseParams): Promise<ToolResult> {
  logger.tool("git_status", dirPath);

  const result = await gitExec("status", dirPath);

  return {
    content: [
      {
        type: "text",
        text: result.success
          ? `📊 Estado del repositorio:\n${"─".repeat(40)}\n${result.stdout}`
          : `❌ Error en git status:\n${result.stderr}`,
      },
    ],
  };
}

/**
 * Agrega archivos al staging area.
 */
export async function gitAdd({ path: dirPath = ".", files = "." }: GitAddParams): Promise<ToolResult> {
  logger.tool("git_add", `${dirPath} | files: ${files}`);

  const fileList = Array.isArray(files) ? files.join(" ") : files;
  const result = await gitExec(`add ${fileList}`, dirPath);

  return {
    content: [
      {
        type: "text",
        text: result.success
          ? `✅ Archivos agregados al staging: ${fileList}`
          : `❌ Error en git add:\n${result.stderr}`,
      },
    ],
  };
}

/**
 * Realiza un commit.
 */
export async function gitCommit({ path: dirPath = ".", message }: GitCommitParams): Promise<ToolResult> {
  logger.tool("git_commit", message);

  if (!message) {
    throw new Error("El mensaje de commit es obligatorio.");
  }

  await gitExec('config user.email "agent@mcp-dev-agent.local"', dirPath);
  await gitExec('config user.name "MCP Dev Agent"', dirPath);

  const result = await gitExec(`commit -m "${message.replace(/"/g, '\\"')}"`, dirPath);

  return {
    content: [
      {
        type: "text",
        text: result.success
          ? `✅ Commit realizado:\n${result.stdout}`
          : `❌ Error en git commit:\n${result.stderr}`,
      },
    ],
  };
}

/**
 * Muestra el historial de commits.
 */
export async function gitLog({ path: dirPath = ".", limit = 10 }: GitLogParams): Promise<ToolResult> {
  logger.tool("git_log", `${dirPath} (últimos ${limit})`);

  const format = "--pretty=format:'%h | %ai | %an | %s'";
  const result = await gitExec(`log ${format} -n ${limit}`, dirPath);

  return {
    content: [
      {
        type: "text",
        text: result.success
          ? `📜 Historial de commits (últimos ${limit}):\n${"─".repeat(60)}\n${result.stdout || "(sin commits)"}`
          : `❌ Error en git log:\n${result.stderr}`,
      },
    ],
  };
}

/**
 * Muestra el diff de cambios (staged o unstaged).
 */
export async function gitDiff({ path: dirPath = ".", staged = false, file }: GitDiffParams): Promise<ToolResult> {
  logger.tool("git_diff", `${dirPath} staged=${staged}`);

  const stagedFlag = staged ? "--staged" : "";
  const fileArg = file ? `-- "${file}"` : "";
  const result = await gitExec(`diff ${stagedFlag} ${fileArg}`.trim(), dirPath);

  const label = staged ? "Cambios en staging" : "Cambios sin stagear";

  return {
    content: [
      {
        type: "text",
        text: result.success
          ? result.stdout
            ? `📋 ${label}:\n${"─".repeat(60)}\n${result.stdout}`
            : `✅ Sin cambios${staged ? " en staging" : ""}.`
          : `❌ Error en git diff:\n${result.stderr}`,
      },
    ],
  };
}

/**
 * Gestiona ramas: lista, crea o elimina.
 */
export async function gitBranch({ path: dirPath = ".", name, action = "list" }: GitBranchParams): Promise<ToolResult> {
  logger.tool("git_branch", `${dirPath} action=${action} name=${name ?? "-"}`);

  let result: GitExecResult;

  if (action === "list") {
    result = await gitExec("branch -a", dirPath);
  } else if (action === "create") {
    if (!name) throw new Error("Se requiere 'name' para crear una rama.");
    result = await gitExec(`branch "${name}"`, dirPath);
  } else if (action === "delete") {
    if (!name) throw new Error("Se requiere 'name' para eliminar una rama.");
    result = await gitExec(`branch -d "${name}"`, dirPath);
  } else {
    throw new Error(`Acción no válida: "${action}". Usa "list", "create" o "delete".`);
  }

  const labels: Record<string, string> = {
    list: "🌿 Ramas disponibles",
    create: `✅ Rama creada: ${name}`,
    delete: `🗑️ Rama eliminada: ${name}`,
  };

  return {
    content: [
      {
        type: "text",
        text: result.success
          ? `${labels[action]}${result.stdout ? `:\n${"─".repeat(40)}\n${result.stdout}` : ""}`
          : `❌ Error en git branch:\n${result.stderr}`,
      },
    ],
  };
}

/**
 * Cambia de rama o restaura un commit (checkout).
 */
export async function gitCheckout({ path: dirPath = ".", target, create = false }: GitCheckoutParams): Promise<ToolResult> {
  logger.tool("git_checkout", `${dirPath} → ${target} (create=${create})`);

  const createFlag = create ? "-b" : "";
  const result = await gitExec(`checkout ${createFlag} "${target}"`.replace("  ", " "), dirPath);

  return {
    content: [
      {
        type: "text",
        text: result.success
          ? `✅ Cambiado a: ${target}${result.stdout ? `\n${result.stdout}` : ""}${result.stderr ? `\n${result.stderr}` : ""}`
          : `❌ Error en git checkout:\n${result.stderr}`,
      },
    ],
  };
}

/**
 * Descarta cambios en archivos (git restore).
 */
export async function gitRestore({ path: dirPath = ".", files, staged = false }: GitRestoreFilesParams): Promise<ToolResult> {
  logger.tool("git_restore", `${dirPath} staged=${staged}`);

  const stagedFlag = staged ? "--staged" : "";
  const fileList = files
    ? (Array.isArray(files) ? files.join(" ") : files)
    : ".";

  const result = await gitExec(`restore ${stagedFlag} ${fileList}`.trim(), dirPath);

  return {
    content: [
      {
        type: "text",
        text: result.success
          ? `✅ Cambios descartados${staged ? " del staging" : ""}: ${fileList}`
          : `❌ Error en git restore:\n${result.stderr}`,
      },
    ],
  };
}
