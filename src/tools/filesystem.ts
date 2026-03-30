// =============================================
//   Filesystem Tools: read_file, write_file,
//   list_directory, delete_file, create_directory
// =============================================

import fs from "fs/promises";
import path from "path";
import os from "os";
import { exec } from "child_process";
import { promisify } from "util";
import { validatePath, validateFileContent, getWorkspaceDir } from "../utils/security.js";
import { logger } from "../utils/logger.js";
import type {
  ToolResult,
  ReadFileParams,
  WriteFileParams,
  ListDirectoryParams,
  DeleteFileParams,
  DeleteDirectoryParams,
  CreateDirectoryParams,
  ApplyDiffParams,
  SearchFilesParams,
  ReadFileRangeParams,
  AppendFileParams,
  RenameFileParams,
  MoveFileParams,
  CopyFileParams,
  ReplaceInFileParams,
  SaveNoteParams,
} from "../types/index.js";

const NOTES_FILENAME = ".agent-notes.md";

const execAsync = promisify(exec);

/**
 * Lee el contenido de un archivo.
 */
export async function readFile({ path: filePath }: ReadFileParams): Promise<ToolResult> {
  logger.tool("read_file", filePath);

  const resolvedPath = validatePath(filePath);

  try {
    const stat = await fs.stat(resolvedPath);

    if (stat.isDirectory()) {
      throw new Error(`"${filePath}" es un directorio, no un archivo.`);
    }

    const content = await fs.readFile(resolvedPath, "utf-8");
    const lines = content.split("\n").length;
    const sizeKB = (stat.size / 1024).toFixed(2);

    logger.success(`read_file: ${lines} líneas, ${sizeKB} KB`);

    return {
      content: [
        {
          type: "text",
          text: [
            `📄 Archivo: ${filePath}`,
            `📏 Tamaño: ${sizeKB} KB | Líneas: ${lines}`,
            `${"─".repeat(50)}`,
            content,
          ].join("\n"),
        },
      ],
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Archivo no encontrado: "${filePath}"`);
    }
    throw err;
  }
}

/**
 * Escribe contenido en un archivo (crea o sobreescribe).
 */
export async function writeFile({
  path: filePath,
  content,
  create_dirs = true,
}: WriteFileParams): Promise<ToolResult> {
  logger.tool("write_file", filePath);

  const resolvedPath = validatePath(filePath);
  validateFileContent(content);

  if (create_dirs) {
    await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
  }

  const fileExists = await fs
    .access(resolvedPath)
    .then(() => true)
    .catch(() => false);

  if (!fileExists) {
    const basename = path.basename(filePath);
    logger.warn(`write_file: "${filePath}" no existe — creando archivo nuevo.`);
    // Buscar si existe un archivo con el mismo nombre en subdirectorios
    try {
      const { stdout } = await execAsync(
        `find . -name "${basename}" -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/dist/*" 2>/dev/null | head -5`,
        { cwd: getWorkspaceDir(), timeout: 5000 }
      );
      const matches = stdout.trim().split("\n").filter(Boolean);
      if (matches.length > 0) {
        throw new Error(
          `Archivo "${filePath}" no existe, pero se encontraron archivos con el mismo nombre:\n` +
          matches.map((m) => `  - ${m}`).join("\n") + "\n" +
          `Usa read_file sobre la ruta correcta y apply_diff para modificarlo en lugar de crear uno nuevo.`
        );
      }
    } catch (err) {
      if ((err as Error).message.includes("Usa read_file")) throw err;
      // Si find falla, continuar sin la sugerencia
    }
  } else {
    // Protección anti-vaciado: si el archivo existente tiene contenido sustancial
    // y el nuevo contenido es sospechosamente pequeño, bloquear la operación.
    const existing = await fs.readFile(resolvedPath, "utf-8");
    if (existing.trim().length > 100 && content.trim().length < existing.trim().length * 0.1) {
      throw new Error(
        `Protección anti-vaciado activada en "${filePath}":\n` +
        `  Contenido actual: ${existing.trim().length} chars\n` +
        `  Contenido nuevo:  ${content.trim().length} chars (reducción >90%)\n` +
        `Acción requerida: usa replace_in_file para modificaciones parciales, ` +
        `o lee el archivo completo con read_file y asegúrate de incluir TODO el contenido actualizado.`
      );
    }
  }

  await fs.writeFile(resolvedPath, content, "utf-8");

  const stat = await fs.stat(resolvedPath);
  const sizeKB = (stat.size / 1024).toFixed(2);
  const action = fileExists ? "actualizado" : "creado";

  logger.success(`write_file: "${filePath}" ${action} (${sizeKB} KB)`);

  return {
    content: [
      {
        type: "text",
        text: `✅ Archivo ${action} exitosamente: ${filePath}\n📏 Tamaño: ${sizeKB} KB`,
      },
    ],
  };
}

/**
 * Lista el contenido de un directorio con metadatos.
 */
export async function listDirectory({
  path: dirPath = ".",
  recursive = false,
}: ListDirectoryParams): Promise<ToolResult> {
  logger.tool("list_directory", `${dirPath} (recursive: ${recursive})`);

  const resolvedPath = validatePath(dirPath);

  try {
    const stat = await fs.stat(resolvedPath);
    if (!stat.isDirectory()) {
      throw new Error(`"${dirPath}" no es un directorio.`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Directorio no encontrado: "${dirPath}"`);
    }
    throw err;
  }

  const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".cache", "coverage", ".next", "build", "__pycache__"]);

  async function buildTree(currentPath: string, prefix = "", depth = 0): Promise<string[]> {
    if (depth > 6) return ["  (profundidad máxima alcanzada)"];

    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    const lines: string[] = [];

    const sortedEntries = entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    for (let i = 0; i < sortedEntries.length; i++) {
      const entry = sortedEntries[i];
      const isLast = i === sortedEntries.length - 1;
      const connector = isLast ? "└── " : "├── ";
      const childPrefix = prefix + (isLast ? "    " : "│   ");

      if (entry.isDirectory()) {
        const skip = recursive && SKIP_DIRS.has(entry.name);
        lines.push(`${prefix}${connector}📁 ${entry.name}/${skip ? " (omitido)" : ""}`);
        if (recursive && !skip) {
          const subPath = path.join(currentPath, entry.name);
          const subLines = await buildTree(subPath, childPrefix, depth + 1);
          lines.push(...subLines);
        }
      } else {
        try {
          const fileStat = await fs.stat(path.join(currentPath, entry.name));
          const sizeKB = (fileStat.size / 1024).toFixed(1);
          lines.push(`${prefix}${connector}📄 ${entry.name} (${sizeKB} KB)`);
        } catch {
          lines.push(`${prefix}${connector}📄 ${entry.name}`);
        }
      }
    }

    return lines;
  }

  const treeLines = await buildTree(resolvedPath);
  const output = [`📂 ${dirPath}/`, ...treeLines].join("\n");

  logger.success(`list_directory: ${treeLines.length} entradas encontradas`);

  return {
    content: [{ type: "text", text: output }],
  };
}

/**
 * Elimina un archivo.
 */
export async function deleteFile({ path: filePath }: DeleteFileParams): Promise<ToolResult> {
  logger.tool("delete_file", filePath);

  const resolvedPath = validatePath(filePath);

  try {
    const stat = await fs.stat(resolvedPath);
    if (stat.isDirectory()) {
      throw new Error(`"${filePath}" es un directorio. Usa delete_directory para directorios.`);
    }

    await fs.unlink(resolvedPath);
    logger.success(`delete_file: "${filePath}" eliminado`);

    return {
      content: [{ type: "text", text: `🗑️ Archivo eliminado: ${filePath}` }],
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Archivo no encontrado: "${filePath}"`);
    }
    throw err;
  }
}

/**
 * Elimina un directorio y todo su contenido de forma recursiva.
 */
export async function deleteDirectory({ path: dirPath }: DeleteDirectoryParams): Promise<ToolResult> {
  logger.tool("delete_directory", dirPath);

  const resolvedPath = validatePath(dirPath);

  try {
    const stat = await fs.stat(resolvedPath);
    if (!stat.isDirectory()) {
      throw new Error(`"${dirPath}" no es un directorio. Usa delete_file para archivos.`);
    }

    await fs.rm(resolvedPath, { recursive: true, force: true });
    logger.success(`delete_directory: "${dirPath}" eliminado`);

    return {
      content: [{ type: "text", text: `🗑️ Directorio eliminado: ${dirPath}` }],
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Directorio no encontrado: "${dirPath}"`);
    }
    throw err;
  }
}

/**
 * Crea un directorio (con padres si es necesario).
 */
export async function createDirectory({ path: dirPath }: CreateDirectoryParams): Promise<ToolResult> {
  logger.tool("create_directory", dirPath);

  const resolvedPath = validatePath(dirPath);
  await fs.mkdir(resolvedPath, { recursive: true });

  logger.success(`create_directory: "${dirPath}" creado`);

  return {
    content: [{ type: "text", text: `📁 Directorio creado: ${dirPath}` }],
  };
}

/**
 * Aplica un patch en formato unified diff a un archivo del workspace.
 */
export async function applyDiff({ path: filePath, diff }: ApplyDiffParams): Promise<ToolResult> {
  logger.tool("apply_diff", filePath);

  validatePath(filePath);
  const workspaceDir = getWorkspaceDir();

  // Si el diff no tiene headers de archivo (--- / +++), agregarlos automáticamente.
  // Muchos LLMs generan solo el hunk (@@ ... @@) sin los headers que patch requiere.
  let processedDiff = diff;
  if (!diff.includes("--- ") && !diff.includes("+++ ")) {
    processedDiff = `--- a/${filePath}\n+++ b/${filePath}\n${diff}`;
  }
  // Asegurar que el diff termina con newline (patch es estricto con esto)
  const normalizedDiff = processedDiff.endsWith("\n") ? processedDiff : processedDiff + "\n";
  const tmpFile = path.join(os.tmpdir(), `mcp-patch-${Date.now()}.diff`);

  try {
    await fs.writeFile(tmpFile, normalizedDiff, "utf-8");

    // Intento 1: patch estricto
    let stdout = "";
    let stderr = "";
    let usedFuzz = false;

    try {
      const result = await execAsync(`patch -p1 --no-backup-if-mismatch < "${tmpFile}"`, {
        cwd: workspaceDir,
        timeout: 15000,
      });
      stdout = result.stdout;
      stderr = result.stderr;
    } catch (firstErr) {
      const e = firstErr as { stderr?: string; message: string };
      const errMsg = e.stderr?.trim() ?? e.message;

      // Intento 2: patch con fuzz (tolerante a contexto incompleto o desplazado)
      try {
        logger.warn(`apply_diff: patch estricto falló ("${errMsg}"), reintentando con --fuzz=3...`);
        const result = await execAsync(`patch -p1 --no-backup-if-mismatch --fuzz=3 --ignore-whitespace < "${tmpFile}"`, {
          cwd: workspaceDir,
          timeout: 15000,
        });
        stdout = result.stdout;
        stderr = result.stderr;
        usedFuzz = true;
      } catch (secondErr) {
        const e2 = secondErr as { stderr?: string; message: string };
        const finalErr = e2.stderr?.trim() ?? e2.message;
        throw new Error(
          `Diff inválido para "${filePath}": ${finalErr}\n` +
          `Causa probable: el hunk header (@@ -x,y +x,y @@) no coincide con el contenido real del archivo.\n` +
          `Solución: lee el archivo con read_file, verifica las líneas exactas y regenera el diff.`
        );
      }
    }

    // Limpiar archivos residuales que patch puede crear (.orig, .rej)
    const resolvedFilePath = validatePath(filePath);
    await fs.unlink(`${resolvedFilePath}.orig`).catch(() => {});
    await fs.unlink(`${resolvedFilePath}.rej`).catch(() => {});

    logger.success(`apply_diff: patch aplicado en "${filePath}"${usedFuzz ? " (con fuzz)" : ""}`);

    return {
      content: [
        {
          type: "text",
          text: [
            `✅ Patch aplicado en: ${filePath}${usedFuzz ? " (modo tolerante)" : ""}`,
            stdout.trim() ? `\n${stdout.trim()}` : "",
            stderr.trim() ? `\n⚠️ ${stderr.trim()}` : "",
          ].join(""),
        },
      ],
    };
  } finally {
    await fs.unlink(tmpFile).catch(() => {});
  }
}

/**
 * Reemplaza una cadena exacta dentro de un archivo. Más confiable que apply_diff
 * porque no depende de números de línea ni contexto, solo del texto exacto a reemplazar.
 */
export async function replaceInFile({ path: filePath, old_string, new_string, replace_all = false }: ReplaceInFileParams): Promise<ToolResult> {
  logger.tool("replace_in_file", filePath);

  validatePath(filePath);
  const resolvedPath = validatePath(filePath);

  const content = await fs.readFile(resolvedPath, "utf-8");

  if (!content.includes(old_string)) {
    const preview = old_string.length > 120 ? old_string.slice(0, 120) + "..." : old_string;
    throw new Error(
      `El texto a reemplazar no se encontró en "${filePath}".\n` +
      `Texto buscado (primeros 120 chars): ${preview}\n` +
      `Solución: usa read_file para ver el contenido exacto del archivo y copia el texto tal como aparece.`
    );
  }

  if (new_string.trim().length === 0 && old_string.trim().length > 50) {
    throw new Error(
      `Reemplazo bloqueado en "${filePath}": no se puede reemplazar un bloque de ${old_string.trim().length} chars con contenido vacío.\n` +
      `Si deseas eliminar código, asegúrate de que new_string contenga el contenido correcto.`
    );
  }

  let newContent: string;
  if (replace_all) {
    newContent = content.split(old_string).join(new_string);
  } else {
    const idx = content.indexOf(old_string);
    newContent = content.slice(0, idx) + new_string + content.slice(idx + old_string.length);
  }

  validateFileContent(newContent);
  await fs.writeFile(resolvedPath, newContent, "utf-8");

  const occurrences = replace_all
    ? content.split(old_string).length - 1
    : 1;

  logger.success(`replace_in_file: ${occurrences} ocurrencia(s) reemplazada(s) en "${filePath}"`);

  return {
    content: [
      {
        type: "text",
        text: `✅ Reemplazado en: ${filePath} (${occurrences} ocurrencia${occurrences > 1 ? "s" : ""})`,
      },
    ],
  };
}

/**
 * Busca texto o patrones en archivos del workspace usando grep.
 */
export async function searchFiles({
  pattern,
  path: searchPath = ".",
  include,
  case_sensitive = true,
}: SearchFilesParams): Promise<ToolResult> {
  logger.tool("search_files", `"${pattern}" en ${searchPath}`);

  const resolvedPath = validatePath(searchPath);
  const workspaceDir = getWorkspaceDir();

  if (!resolvedPath.startsWith(workspaceDir)) {
    throw new Error("Ruta fuera del workspace.");
  }

  const flags = ["-rn", "--color=never"];
  if (!case_sensitive) flags.push("-i");

  const includeFlag = include ? `--include="${include}"` : "";
  const excludeDirs = '--exclude-dir="{node_modules,.git,dist,build,.cache,coverage}"';

  const cmd = `grep ${flags.join(" ")} ${includeFlag} ${excludeDirs} "${pattern.replace(/"/g, '\\"')}" .`;

  try {
    const { stdout } = await execAsync(cmd, {
      cwd: resolvedPath,
      timeout: 15000,
      maxBuffer: 1024 * 1024 * 5,
    });

    const lines = stdout.trim().split("\n").filter(Boolean);
    logger.success(`search_files: ${lines.length} coincidencias`);

    return {
      content: [
        {
          type: "text",
          text: lines.length
            ? `🔍 ${lines.length} coincidencias para "${pattern}":\n${"─".repeat(50)}\n${lines.join("\n")}`
            : `🔍 Sin resultados para "${pattern}" en ${searchPath}`,
        },
      ],
    };
  } catch (err) {
    const error = err as { code?: number; stdout?: string };
    // grep exit code 1 = no matches (not an error)
    if (error.code === 1) {
      return {
        content: [{ type: "text", text: `🔍 Sin resultados para "${pattern}" en ${searchPath}` }],
      };
    }
    throw err;
  }
}

/**
 * Lee solo un rango de líneas de un archivo.
 */
export async function readFileRange({
  path: filePath,
  start_line,
  end_line,
}: ReadFileRangeParams): Promise<ToolResult> {
  logger.tool("read_file_range", `${filePath} [${start_line}-${end_line}]`);

  const resolvedPath = validatePath(filePath);

  try {
    const content = await fs.readFile(resolvedPath, "utf-8");
    const allLines = content.split("\n");
    const totalLines = allLines.length;

    const start = Math.max(1, start_line);
    const end = Math.min(totalLines, end_line);

    if (start > totalLines) {
      throw new Error(`start_line (${start_line}) supera el total de líneas del archivo (${totalLines}).`);
    }

    const selectedLines = allLines.slice(start - 1, end);
    const numbered = selectedLines.map((line, i) => `${String(start + i).padStart(4)} │ ${line}`).join("\n");

    logger.success(`read_file_range: líneas ${start}-${end} de ${totalLines}`);

    return {
      content: [
        {
          type: "text",
          text: [
            `📄 ${filePath} (líneas ${start}–${end} de ${totalLines})`,
            "─".repeat(50),
            numbered,
          ].join("\n"),
        },
      ],
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Archivo no encontrado: "${filePath}"`);
    }
    throw err;
  }
}

/**
 * Agrega contenido al final de un archivo sin borrar lo existente.
 */
export async function appendFile({ path: filePath, content }: AppendFileParams): Promise<ToolResult> {
  logger.tool("append_file", filePath);

  const resolvedPath = validatePath(filePath);
  validateFileContent(content);

  const fileExists = await fs.access(resolvedPath).then(() => true).catch(() => false);
  if (!fileExists) {
    const basename = path.basename(filePath);
    throw new Error(
      `Archivo no encontrado: "${filePath}".\n` +
      `No puedes hacer append a un archivo que no existe.\n` +
      `Acción requerida: usa list_directory para encontrar la ruta correcta de "${basename}" antes de continuar.`
    );
  }

  await fs.appendFile(resolvedPath, content, "utf-8");

  const stat = await fs.stat(resolvedPath);
  const sizeKB = (stat.size / 1024).toFixed(2);

  logger.success(`append_file: contenido agregado a "${filePath}" (${sizeKB} KB total)`);

  return {
    content: [{ type: "text", text: `✅ Contenido agregado a: ${filePath}\n📏 Tamaño total: ${sizeKB} KB` }],
  };
}

/**
 * Renombra un archivo dentro de su mismo directorio.
 */
export async function renameFile({ path: filePath, new_name }: RenameFileParams): Promise<ToolResult> {
  logger.tool("rename_file", `${filePath} → ${new_name}`);

  const resolvedPath = validatePath(filePath);
  const newResolvedPath = validatePath(path.join(path.dirname(filePath), new_name));

  await fs.rename(resolvedPath, newResolvedPath);

  logger.success(`rename_file: "${filePath}" → "${new_name}"`);

  return {
    content: [{ type: "text", text: `✅ Archivo renombrado: ${filePath} → ${path.join(path.dirname(filePath), new_name)}` }],
  };
}

/**
 * Mueve un archivo a otra ubicación dentro del workspace.
 */
export async function moveFile({ path: filePath, destination }: MoveFileParams): Promise<ToolResult> {
  logger.tool("move_file", `${filePath} → ${destination}`);

  const resolvedSrc = validatePath(filePath);
  const resolvedDst = validatePath(destination);

  await fs.mkdir(path.dirname(resolvedDst), { recursive: true });
  await fs.rename(resolvedSrc, resolvedDst);

  logger.success(`move_file: "${filePath}" → "${destination}"`);

  return {
    content: [{ type: "text", text: `✅ Archivo movido: ${filePath} → ${destination}` }],
  };
}

/**
 * Copia un archivo a otra ubicación dentro del workspace.
 */
export async function copyFile({ path: filePath, destination }: CopyFileParams): Promise<ToolResult> {
  logger.tool("copy_file", `${filePath} → ${destination}`);

  const resolvedSrc = validatePath(filePath);
  const resolvedDst = validatePath(destination);

  await fs.mkdir(path.dirname(resolvedDst), { recursive: true });
  await fs.copyFile(resolvedSrc, resolvedDst);

  const stat = await fs.stat(resolvedDst);
  const sizeKB = (stat.size / 1024).toFixed(2);

  logger.success(`copy_file: "${filePath}" → "${destination}" (${sizeKB} KB)`);

  return {
    content: [{ type: "text", text: `✅ Archivo copiado: ${filePath} → ${destination}\n📏 Tamaño: ${sizeKB} KB` }],
  };
}

// ─── Project Notes ────────────────────────────────────────────────────────────

/**
 * Guarda una nota en el archivo .agent-notes.md del workspace.
 * Las notas persisten entre sesiones y se inyectan como contexto al agente.
 */
export async function saveNote({ content, title }: SaveNoteParams): Promise<ToolResult> {
  logger.tool("save_note", title ?? "(sin título)");

  const workspaceDir = getWorkspaceDir();
  const notesPath = path.join(workspaceDir, NOTES_FILENAME);
  const timestamp = new Date().toLocaleString("es", { dateStyle: "short", timeStyle: "short" });
  const header = `\n## ${title ?? "Nota"}\n*${timestamp}*\n\n`;
  const entry = header + content.trim() + "\n\n---\n";

  await fs.appendFile(notesPath, entry, "utf-8");

  logger.success(`save_note: entrada guardada en ${NOTES_FILENAME}`);
  return {
    content: [{ type: "text", text: `✅ Nota guardada en ${NOTES_FILENAME}\nTítulo: ${title ?? "Nota"}\nFecha: ${timestamp}` }],
  };
}

/**
 * Lee todas las notas del proyecto desde .agent-notes.md.
 */
export async function readNotes(): Promise<ToolResult> {
  logger.tool("read_notes", NOTES_FILENAME);

  const workspaceDir = getWorkspaceDir();
  const notesPath = path.join(workspaceDir, NOTES_FILENAME);

  try {
    const content = await fs.readFile(notesPath, "utf-8");
    if (!content.trim()) {
      return { content: [{ type: "text", text: "📭 No hay notas guardadas para este proyecto." }] };
    }
    const lines = content.split("\n").length;
    logger.success(`read_notes: ${lines} líneas`);
    return {
      content: [{ type: "text", text: `📝 Notas del proyecto (${NOTES_FILENAME}):\n${"─".repeat(40)}\n${content}` }],
    };
  } catch {
    return { content: [{ type: "text", text: "📭 No hay notas guardadas para este proyecto." }] };
  }
}

/**
 * Elimina todas las notas del proyecto.
 */
export async function clearNotes(): Promise<ToolResult> {
  logger.tool("clear_notes", NOTES_FILENAME);

  const workspaceDir = getWorkspaceDir();
  const notesPath = path.join(workspaceDir, NOTES_FILENAME);

  await fs.writeFile(notesPath, "", "utf-8");
  logger.success(`clear_notes: ${NOTES_FILENAME} vaciado`);

  return {
    content: [{ type: "text", text: `🗑️ Notas del proyecto limpiadas.` }],
  };
}
