// =============================================
//   Web UI Server — MCP Dev Agent
//   Express + SSE para chat en tiempo real
// =============================================

import "dotenv/config";
import express, { type Request, type Response } from "express";
import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";
import { exec } from "child_process";
import { promisify } from "util";
import { MCPClient } from "../mcp/client.js";
import { DevAgent } from "../agent/agent.js";
import { logger } from "../utils/logger.js";
import { getWorkspaceDir } from "../utils/security.js";
import { config } from "../config/index.js";
import type {
  GitPanelResult,
  GitInfoResponse,
  GitFileEntry,
  CommitEntry,
  WorkspaceBody,
  ChatBody,
  GitAddBody,
  GitRestoreBody,
  GitCommitBody,
  DoneEvent,
  ToolEvent,
  ProviderSwitchEvent,
} from "../types/index.js";

const execAsync = promisify(exec);

async function gitExecPanel(args: string): Promise<GitPanelResult> {
  const cwd = getWorkspaceDir();
  try {
    const { stdout } = await execAsync(`git ${args}`, { cwd, timeout: 10000 });
    return { ok: true, out: stdout };
  } catch (err) {
    const error = err as { stderr?: string; message: string };
    return { ok: false, out: error.stderr ?? error.message };
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Inicializar agente ───────────────────────────────────────────────────────

const mcpClient = new MCPClient();
let agent: DevAgent | null = null;

async function initAgent(): Promise<void> {
  await mcpClient.connect();
  agent = new DevAgent(mcpClient);
  logger.info(`Web UI lista en http://localhost:${config.webPort}`);
}

// ─── Express app ──────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

app.get("/", (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/tools", (_req: Request, res: Response) => {
  res.json(mcpClient.listTools());
});

app.post("/clear", (_req: Request, res: Response) => {
  agent!.clearHistory();
  res.json({ ok: true });
});

app.get("/stats", (_req: Request, res: Response) => {
  res.json(agent!.getStats());
});

app.get("/workspace", (_req: Request, res: Response) => {
  res.json({ path: getWorkspaceDir() });
});

app.get("/browse", async (req: Request, res: Response) => {
  const reqPath = String(req.query.path || process.env.HOME || "/");
  const dir = path.resolve(reqPath);
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const dirs = entries
      .filter(e => e.isDirectory() && !e.name.startsWith("."))
      .map(e => e.name)
      .sort((a, b) => a.localeCompare(b));
    res.json({ path: dir, dirs });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post("/workspace", async (req: Request<object, object, WorkspaceBody>, res: Response) => {
  const { path: newPath } = req.body;
  if (!newPath?.trim()) {
    return res.status(400).json({ ok: false, error: "path requerido" });
  }

  const resolved = path.resolve(newPath.trim());
  try {
    await fs.access(resolved);
  } catch {
    return res.status(400).json({ ok: false, error: `Directorio no existe: ${resolved}` });
  }

  const gitCheck = await gitExecPanel("status --porcelain");
  const gitOut = gitCheck.out.toLowerCase();
  const isGitError = !gitCheck.ok || gitOut.includes("not a git repository") || gitOut.includes("fatal:") || gitOut.includes("no es un repositorio git");
  if (isGitError) {
    return res.status(400).json({ ok: false, error: `No es un repositorio git: ${resolved}` });
  }

  process.env.WORKSPACE_DIR = resolved;
  agent!.clearHistory();
  logger.info(`Workspace cambiado a: ${resolved}`);
  return res.json({ ok: true, path: resolved });
});

// ─── Git Panel Endpoints ──────────────────────────────────────────────────────

app.get("/git/info", async (_req: Request, res: Response) => {
  try {
    const workspaceDir = getWorkspaceDir();
    const project = path.basename(workspaceDir);
    const { out: branch }    = await gitExecPanel("branch --show-current");
    const { out: porcelain } = await gitExecPanel("status --porcelain");

    const staged: GitFileEntry[]    = [];
    const unstaged: GitFileEntry[]  = [];
    const untracked: GitFileEntry[] = [];

    const isGitError = porcelain && (porcelain.includes("not a git repository") || porcelain.includes("fatal:"));
    if (isGitError) {
      return res.json({
        project,
        branch: (branch || "unknown").trim(),
        staged: [],
        unstaged: [],
        untracked: [],
        error: porcelain
      });
    }

    const lineRegex = /^([ MADRCU?]{2})(.+)$/;
    for (const line of porcelain.split("\n").filter(Boolean)) {
      const match = line.match(lineRegex);
      if (!match) continue;
      
      const status = match[1];
      const file = match[2].trim();
      const X = status[0];
      const Y = status[1];

      if (X === "?" && Y === "?") {
        untracked.push({ file });
      } else {
        if (X !== " " && X !== "?") staged.push({ file, status: X });
        if (Y !== " " && Y !== "?") unstaged.push({ file, status: Y });
      }
    }

    const info: GitInfoResponse = { project, branch: (branch || "main").trim(), staged, unstaged, untracked };
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post("/git/add", async (req: Request<object, object, GitAddBody>, res: Response) => {
  try {
    const { files = "." } = req.body;
    const fileList = Array.isArray(files)
      ? files.map((f) => `"${f.replace(/"/g, '\\"')}"`).join(" ")
      : `"${String(files).replace(/"/g, '\\"')}"`;
    const result = await gitExecPanel(`add ${fileList}`);
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, out: (err as Error).message });
  }
});

app.post("/git/restore", async (req: Request<object, object, GitRestoreBody>, res: Response) => {
  try {
    const { files = ".", staged = false } = req.body;
    const fileList = Array.isArray(files)
      ? files.map((f) => `"${f.replace(/"/g, '\\"')}"`).join(" ")
      : `"${String(files).replace(/"/g, '\\"')}"`;
    const flag   = staged ? "--staged " : "";
    const result = await gitExecPanel(`restore ${flag}${fileList}`);
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, out: (err as Error).message });
  }
});

app.post("/git/remove", async (req: Request<object, object, GitAddBody>, res: Response) => {
  try {
    const { files } = req.body;
    if (!files) {
      return res.status(400).json({ ok: false, out: "files requerido" });
    }
    const fileList = Array.isArray(files)
      ? files
      : [files];
    
    const workspaceDir = getWorkspaceDir();
    for (const f of fileList) {
      const fullPath = path.join(workspaceDir, f);
      try {
        const stat = await fs.stat(fullPath);
        if (stat.isDirectory()) {
          await fs.rm(fullPath, { recursive: true });
          console.log(`[git/remove] Directorio eliminado: ${fullPath}`);
        } else {
          await fs.unlink(fullPath);
          console.log(`[git/remove] Archivo eliminado: ${fullPath}`);
        }
      } catch (unlinkErr: unknown) {
        const err = unlinkErr as { code?: string; message?: string };
        console.error(`[git/remove] Error al eliminar ${fullPath}:`, err);
        return res.status(500).json({ ok: false, out: `Error al eliminar ${f}: ${err.message || err.code}` });
      }
    }
    res.json({ ok: true, out: `Eliminado(s): ${fileList.join(", ")}` });
  } catch (err) {
    console.error(`[git/remove] Error:`, err);
    res.status(500).json({ ok: false, out: (err as Error).message });
  }
});

app.post("/git/commit", async (req: Request<object, object, GitCommitBody>, res: Response) => {
  try {
    const { message } = req.body;
    if (!message?.trim()) {
      return res.status(400).json({ ok: false, out: "Mensaje requerido" });
    }
    await gitExecPanel('config user.email "agent@mcp-dev-agent.local"');
    await gitExecPanel('config user.name "MCP Dev Agent"');
    const result = await gitExecPanel(`commit -m "${message.replace(/"/g, '\\"')}"`);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ ok: false, out: (err as Error).message });
  }
});

app.get("/git/log", async (_req: Request, res: Response) => {
  try {
    const { out } = await gitExecPanel("log --pretty=format:'%h|%ar|%s' -n 8");
    const commits: CommitEntry[] = (out ?? "").split("\n").filter(Boolean).map((line) => {
      const [hash, date, ...rest] = line.split("|");
      return { hash, date, message: rest.join("|") };
    });
    res.json(commits);
  } catch {
    res.json([]);
  }
});

/**
 * POST /chat  { message: string }
 * Responde con un stream SSE:
 *   data: { type: "tool",  name, args }
 *   data: { type: "done",  content, iterations, toolCalls }
 *   data: { type: "error", message }
 */
app.post("/chat", async (req: Request<object, object, ChatBody>, res: Response) => {
  const { message } = req.body;
  if (!message?.trim()) {
    return res.status(400).json({ error: "message requerido" });
  }

  res.setHeader("Content-Type",  "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection",    "keep-alive");
  res.flushHeaders();

  const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  const onTool   = ({ name, args }: ToolEvent)             => send({ type: "tool", name, args });
  const onDone   = (payload: DoneEvent)                    => { send({ type: "done", ...payload }); res.end(); };
  const onSwitch = ({ from, reason }: ProviderSwitchEvent) => send({ type: "providerSwitch", from, reason });

  agent!.events.once("done",           onDone);
  agent!.events.on("tool",             onTool);
  agent!.events.on("providerSwitch",   onSwitch);

  try {
    await agent!.processMessage(message);
  } catch (err) {
    // Escribir el evento de error y esperar un tick antes de cerrar
    // para garantizar que el cliente SSE recibe el dato antes del FIN TCP
    try {
      send({ type: "error", message: (err as Error).message });
    } catch { /* ignorar si la conexión ya se cerró */ }
    await new Promise<void>((resolve) => setImmediate(resolve));
    res.end();
  } finally {
    agent!.events.off("tool",           onTool);
    agent!.events.off("done",           onDone);
    agent!.events.off("providerSwitch", onSwitch);
  }

  return;
});

// ─── Arranque ─────────────────────────────────────────────────────────────────

process.on("SIGINT", async () => {
  await mcpClient.disconnect();
  process.exit(0);
});

initAgent()
  .then(() =>
    app.listen(config.webPort, () => {
      console.log(`\n🌐  Abre tu navegador en http://localhost:${config.webPort}\n`);
    })
  )
  .catch((err: Error) => {
    logger.error("Error iniciando el servidor web:", err.message);
    process.exit(1);
  });
