// =============================================
//   Módulo de seguridad y validaciones
// =============================================

import path from "path";
import { logger } from "./logger.js";

const DEFAULT_BLOCKED: string[] = [
  "rm -rf /",
  "sudo",
  "shutdown",
  "reboot",
  "mkfs",
  "passwd",
  "chmod 777 /",
  "> /dev/sda",
];

const BLOCKED_COMMANDS: string[] = [
  ...DEFAULT_BLOCKED,
  ...(process.env.BLOCKED_COMMANDS ?? "").split(",").map((c) => c.trim()).filter(Boolean),
];

/**
 * Verifica que una ruta esté dentro del workspace permitido.
 * Previene path traversal attacks.
 */
export function validatePath(inputPath: string): string {
  const workspaceDir = getWorkspaceDir();
  const resolvedPath = path.resolve(workspaceDir, inputPath);

  if (!resolvedPath.startsWith(workspaceDir)) {
    throw new Error(
      `Acceso denegado: la ruta "${inputPath}" está fuera del workspace permitido.\n` +
        `Workspace: ${workspaceDir}\n` +
        `Ruta resuelta: ${resolvedPath}`
    );
  }

  return resolvedPath;
}

/**
 * Verifica que un comando no esté en la lista negra.
 */
export function validateCommand(command: string): true {
  const normalizedCmd = command.toLowerCase().trim();

  for (const blocked of BLOCKED_COMMANDS) {
    if (normalizedCmd.includes(blocked.toLowerCase())) {
      throw new Error(
        `Comando bloqueado por seguridad: "${blocked}"\n` +
          `Comando solicitado: "${command}"`
      );
    }
  }

  // Prevenir redirecciones peligrosas
  if (/>\s*\/dev\/(sda|sdb|null|zero)/.test(normalizedCmd)) {
    throw new Error(`Redirección peligrosa detectada en: "${command}"`);
  }

  logger.debug(`Comando validado: ${command}`);
  return true;
}

/**
 * Sanitiza el contenido de un archivo antes de escribirlo.
 * Verifica tamaño máximo y que el contenido no esté vacío.
 */
export function validateFileContent(content: string, maxSizeMB = 10): true {
  if (content === undefined || content === null || content.trim().length === 0) {
    throw new Error(
      `El contenido del archivo no puede estar vacío. ` +
      `Si necesitas limpiar el archivo, usa replace_in_file con el contenido correcto.`
    );
  }

  const sizeBytes = Buffer.byteLength(content, "utf8");
  const sizeMB = sizeBytes / (1024 * 1024);

  if (sizeMB > maxSizeMB) {
    throw new Error(
      `Contenido demasiado grande: ${sizeMB.toFixed(2)} MB (máximo ${maxSizeMB} MB)`
    );
  }

  return true;
}

export function getWorkspaceDir(): string {
  return path.resolve(process.env.WORKSPACE_DIR ?? "./workspace");
}
