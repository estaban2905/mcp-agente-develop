// =============================================
//   Configuración centralizada desde env vars
// =============================================

import type { LogLevel } from "../utils/logger.js";

function getEnvInt(key: string, defaultValue: number): number {
  const val = process.env[key];
  return val ? parseInt(val, 10) : defaultValue;
}

function getEnvString(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}

export const config = {
  maxIterations:    getEnvInt("MAX_ITERATIONS",   30),
  maxResultChars:   getEnvInt("MAX_RESULT_CHARS",  6000),
  maxHistoryMsgs:   getEnvInt("MAX_HISTORY_MSGS",  30),
  commandTimeout:   getEnvInt("COMMAND_TIMEOUT",   30000),
  circuitThreshold: getEnvInt("CIRCUIT_THRESHOLD", 3),
  circuitResetMs:   getEnvInt("CIRCUIT_RESET_MS",  60000),
  webPort:          getEnvInt("WEB_PORT",          4000),
  workspaceDir:     getEnvString("WORKSPACE_DIR",  "./workspace"),
  logLevel:         getEnvString("LOG_LEVEL",      "info") as LogLevel,
  blockedCommands:  getEnvString("BLOCKED_COMMANDS", "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean),
} as const;
