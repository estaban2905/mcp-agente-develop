// =============================================
//   Terminal Tool: run_command
//   Ejecuta comandos del sistema de forma segura
// =============================================

import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import { validateCommand, getWorkspaceDir } from "../utils/security.js";
import { logger } from "../utils/logger.js";
import { config } from "../config/index.js";
import type { ToolResult, RunCommandParams, RunTestsParams } from "../types/index.js";

const execAsync = promisify(exec);

/**
 * Ejecuta un comando en el sistema operativo.
 * El cwd por defecto es el workspace del agente.
 */
export async function runCommand({ command, cwd, timeout }: RunCommandParams): Promise<ToolResult> {
  logger.tool("run_command", command);

  validateCommand(command);

  const workspaceDir = getWorkspaceDir();
  let workDir: string;

  if (cwd) {
    workDir = path.resolve(workspaceDir, cwd);
    if (!workDir.startsWith(workspaceDir)) {
      throw new Error(`cwd "${cwd}" está fuera del workspace permitido.`);
    }
  } else {
    workDir = workspaceDir;
  }

  const effectiveTimeout = timeout ?? config.commandTimeout;
  const startTime = Date.now();

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: workDir,
      timeout: effectiveTimeout,
      maxBuffer: 1024 * 1024 * 10, // 10 MB buffer
      env: {
        ...process.env,
        PATH: process.env.PATH,
      },
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    const outputParts = [
      `⚡ Comando: ${command}`,
      `📁 Directorio: ${cwd ?? "."}`,
      `⏱️  Tiempo: ${elapsed}s`,
    ];

    if (stdout?.trim()) {
      outputParts.push(`\n📤 stdout:\n${"─".repeat(40)}\n${stdout.trim()}`);
    }

    if (stderr?.trim()) {
      outputParts.push(`\n⚠️  stderr:\n${"─".repeat(40)}\n${stderr.trim()}`);
    }

    if (!stdout?.trim() && !stderr?.trim()) {
      outputParts.push("\n✅ Comando ejecutado sin salida.");
    }

    logger.success(`run_command: completado en ${elapsed}s`);

    return {
      content: [{ type: "text", text: outputParts.join("\n") }],
    };
  } catch (err) {
    const error = err as NodeJS.ErrnoException & {
      killed?: boolean;
      signal?: string;
      stdout?: string;
      stderr?: string;
    };
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    if (error.killed || error.signal === "SIGTERM") {
      throw new Error(
        `Timeout: el comando "${command}" excedió ${effectiveTimeout}ms y fue terminado.`
      );
    }

    const errorParts = [
      `❌ Error ejecutando: ${command}`,
      `⏱️  Tiempo: ${elapsed}s`,
      `📋 Código de salida: ${error.code ?? "desconocido"}`,
    ];

    if (error.stdout?.trim()) {
      errorParts.push(`\n📤 stdout:\n${error.stdout.trim()}`);
    }

    if (error.stderr?.trim()) {
      errorParts.push(`\n⚠️  stderr:\n${error.stderr.trim()}`);
    }

    errorParts.push(`\n🔴 Mensaje: ${error.message}`);

    logger.error(`run_command falló: ${error.message}`);

    return {
      content: [{ type: "text", text: errorParts.join("\n") }],
      isError: true,
    };
  }
}

/**
 * Detecta y ejecuta los tests del proyecto automáticamente.
 * Si se pasa `command`, lo usa directamente. Si no, lo infiere del proyecto.
 */
export async function runTests({ path: cwd = ".", command }: RunTestsParams): Promise<ToolResult> {
  logger.tool("run_tests", `${cwd} command=${command ?? "auto"}`);

  const workspaceDir = getWorkspaceDir();
  const workDir = path.resolve(workspaceDir, cwd);

  if (!workDir.startsWith(workspaceDir)) {
    throw new Error(`cwd "${cwd}" está fuera del workspace permitido.`);
  }

  let testCommand = command;

  if (!testCommand) {
    // Auto-detect based on project files
    const has = async (file: string) =>
      fs.access(path.join(workDir, file)).then(() => true).catch(() => false);

    if (await has("package.json")) {
      const raw = await fs.readFile(path.join(workDir, "package.json"), "utf-8");
      const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
      if (pkg.scripts?.test && !pkg.scripts.test.includes("no test specified")) {
        testCommand = "npm test";
      } else if (await has("vitest.config.ts") || await has("vitest.config.js")) {
        testCommand = "npx vitest run";
      } else if (await has("jest.config.js") || await has("jest.config.ts")) {
        testCommand = "npx jest";
      } else {
        testCommand = "npm test";
      }
    } else if (await has("pyproject.toml") || await has("setup.py") || await has("pytest.ini")) {
      testCommand = "python -m pytest -v";
    } else if (await has("go.mod")) {
      testCommand = "go test ./...";
    } else if (await has("Cargo.toml")) {
      testCommand = "cargo test";
    } else {
      throw new Error(
        "No se pudo detectar el framework de tests. Pasa el parámetro 'command' explícitamente."
      );
    }
  }

  logger.info(`run_tests: ejecutando "${testCommand}" en ${cwd}`);

  return runCommand({ command: testCommand, cwd, timeout: 120000 });
}
