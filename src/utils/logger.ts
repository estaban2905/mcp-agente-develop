// =============================================
//   Logger — Winston (consola + archivo)
// =============================================

import winston from "winston";
import path from "path";
import fs from "fs";

export type LogLevel = "debug" | "info" | "warn" | "error";

// Asegurar que exista el directorio de logs
const LOGS_DIR = path.resolve(process.cwd(), "logs");
try { fs.mkdirSync(LOGS_DIR, { recursive: true }); } catch { /* ya existe */ }

// Colores para consola
const COLORS: Record<string, string> = {
  debug: "\x1b[90m",  // gris
  info:  "\x1b[36m",  // cyan
  warn:  "\x1b[33m",  // amarillo
  error: "\x1b[31m",  // rojo
  RESET: "\x1b[0m",
};

const consoleFormat = winston.format.printf(({ level, message, timestamp, ...meta }) => {
  const color = COLORS[level] ?? "";
  const reset = COLORS.RESET;
  const label = level.toUpperCase().padEnd(5);
  const extra = Object.keys(meta).length ? " " + JSON.stringify(meta) : "";
  return `${color}[${timestamp}] [${label}] ${message}${extra}${reset}`;
});

const fileFormat = winston.format.printf(({ level, message, timestamp, ...meta }) => {
  const extra = Object.keys(meta).length ? " " + JSON.stringify(meta) : "";
  return `[${timestamp}] [${level.toUpperCase().padEnd(5)}] ${message}${extra}`;
});

const winstonLogger = winston.createLogger({
  level: (process.env.LOG_LEVEL as LogLevel) ?? "info",
  transports: [
    // Consola — igual que antes (stderr para no mezclar con stdout del agente)
    new winston.transports.Console({
      stderrLevels: ["debug", "info", "warn", "error"],
      format: winston.format.combine(
        winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
        consoleFormat
      ),
    }),
    // Archivo rotativo diario — info+
    new winston.transports.File({
      filename: path.join(LOGS_DIR, "app.log"),
      maxsize: 10 * 1024 * 1024,   // 10 MB por archivo
      maxFiles: 5,
      tailable: true,
      format: winston.format.combine(
        winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
        fileFormat
      ),
    }),
    // Archivo separado solo para errores
    new winston.transports.File({
      filename: path.join(LOGS_DIR, "error.log"),
      level: "error",
      maxsize: 5 * 1024 * 1024,
      maxFiles: 3,
      tailable: true,
      format: winston.format.combine(
        winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
        fileFormat
      ),
    }),
  ],
});

export const logger = {
  debug(msg: string, ...args: unknown[]): void {
    winstonLogger.debug(msg, ...args);
  },

  info(msg: string, ...args: unknown[]): void {
    winstonLogger.info(msg, ...args);
  },

  success(msg: string, ...args: unknown[]): void {
    winstonLogger.info(`[OK] ${msg}`, ...args);
  },

  warn(msg: string, ...args: unknown[]): void {
    winstonLogger.warn(msg, ...args);
  },

  error(msg: string, ...args: unknown[]): void {
    winstonLogger.error(msg, ...args);
  },

  agent(msg: string, ...args: unknown[]): void {
    winstonLogger.info(`[AGENT] ${msg}`, ...args);
  },

  tool(name: string, msg: string, ...args: unknown[]): void {
    winstonLogger.info(`[TOOL] ${name} → ${msg}`, ...args);
  },

  divider(label = ""): void {
    const line = label
      ? `${"─".repeat(20)} ${label} ${"─".repeat(20)}`
      : "─".repeat(60);
    winstonLogger.info(line);
  },
};
