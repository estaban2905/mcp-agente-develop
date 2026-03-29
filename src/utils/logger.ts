// =============================================
//   Logger utility con niveles y colores
// =============================================

import chalk from "chalk";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const currentLevel: number = LEVELS[(process.env.LOG_LEVEL as LogLevel) ?? "info"] ?? 1;

function timestamp(): string {
  return new Date().toISOString().replace("T", " ").split(".")[0];
}

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= currentLevel;
}

export const logger = {
  debug(msg: string, ...args: unknown[]): void {
    if (!shouldLog("debug")) return;
    console.error(chalk.gray(`[${timestamp()}] [DEBUG] ${msg}`), ...args);
  },

  info(msg: string, ...args: unknown[]): void {
    if (!shouldLog("info")) return;
    console.error(chalk.cyan(`[${timestamp()}] [INFO]  ${msg}`), ...args);
  },

  success(msg: string, ...args: unknown[]): void {
    if (!shouldLog("info")) return;
    console.error(chalk.green(`[${timestamp()}] [OK]    ${msg}`), ...args);
  },

  warn(msg: string, ...args: unknown[]): void {
    if (!shouldLog("warn")) return;
    console.warn(chalk.yellow(`[${timestamp()}] [WARN]  ${msg}`), ...args);
  },

  error(msg: string, ...args: unknown[]): void {
    if (!shouldLog("error")) return;
    console.error(chalk.red(`[${timestamp()}] [ERROR] ${msg}`), ...args);
  },

  agent(msg: string, ...args: unknown[]): void {
    console.error(chalk.magenta(`\n[${timestamp()}] [AGENT] `) + chalk.white(msg), ...args);
  },

  tool(name: string, msg: string, ...args: unknown[]): void {
    console.error(
      chalk.blue(`[${timestamp()}] [TOOL]  `) +
        chalk.bold.blue(`${name}`) +
        chalk.white(` → ${msg}`),
      ...args
    );
  },

  divider(label = ""): void {
    if (label) {
      const pad = Math.floor((60 - label.length - 2) / 2);
      console.error(chalk.gray(`${"─".repeat(pad)} ${label} ${"─".repeat(pad)}`));
    } else {
      console.error(chalk.gray("─".repeat(60)));
    }
  },
};
