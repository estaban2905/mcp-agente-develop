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
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import * as pty from "node-pty";
import { MCPClient } from "../mcp/client.js";
import { DevAgent } from "../agent/agent.js";
import { ProviderRegistry } from "../providers/registry.js";
import { TestAgent, CodeReviewAgent } from "../agents/index.js";
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
  GitBranchBody,
  NotesBody,
  DoneEvent,
  ToolEvent,
  ConfirmEvent,
  ProviderSwitchEvent,
} from "../types/index.js";

const NOTES_FILE     = ".agent-notes.md";
const PROVIDERS_FILE = path.resolve(process.cwd(), "providers.json");

const execAsync = promisify(exec);

// ─── Provider config types & helpers ─────────────────────────────────────────

interface ProviderConfigRaw {
  apiKey:   string;
  model:    string;
  baseUrl:  string;
  headers:  string;
  enabled:  boolean;
}

async function readJsonProviders(): Promise<ProviderConfigRaw[]> {
  try {
    const content = await fs.readFile(PROVIDERS_FILE, "utf-8");
    return JSON.parse(content) as ProviderConfigRaw[];
  } catch {
    return [];
  }
}

async function writeJsonProviders(providers: ProviderConfigRaw[]): Promise<void> {
  await fs.writeFile(PROVIDERS_FILE, JSON.stringify(providers, null, 2), "utf-8");
}

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
let devAgent: DevAgent | null = null;
let testAgent: TestAgent | null = null;
let codeReviewAgent: CodeReviewAgent | null = null;

function getAgent(agentType: string | undefined) {
  switch (agentType) {
    case "test": return testAgent;
    case "codereview": return codeReviewAgent;
    default: return devAgent;
  }
}

const pendingConfirms = new Map<string, (approved: boolean) => void>();

// ─── Job Store ────────────────────────────────────────────────────────────────

type JobListener = (data: object, idx: number) => void;

interface Job {
  status: "running" | "done" | "error";
  events: object[];
  listeners: Set<JobListener>;
  createdAt: number;
}

const jobStore = new Map<string, Job>();

function generateJobId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function emitJobEvent(job: Job, data: object): void {
  const idx = job.events.length;
  job.events.push(data);
  for (const listener of job.listeners) {
    listener(data, idx);
  }
}

function closeJobListeners(job: Job): void {
  for (const listener of job.listeners) {
    listener({ type: "_close" }, -1);
  }
  job.listeners.clear();
}

async function initAgent(): Promise<void> {
  await mcpClient.connect();
  devAgent = new DevAgent(mcpClient);
  testAgent = new TestAgent(mcpClient);
  codeReviewAgent = new CodeReviewAgent(mcpClient);
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

app.get("/agents", (_req: Request, res: Response) => {
  res.json([
    { id: "dev", name: "Dev Agent", description: "Agente general de desarrollo" },
    { id: "test", name: "Test Agent", description: "Genera tests unitarios y de integración" },
    { id: "codereview", name: "Code Review", description: "Analiza código y detecta problemas" },
  ]);
});

app.post("/clear", (_req: Request, res: Response) => {
  devAgent!.clearHistory();
  testAgent?.clearHistory();
  codeReviewAgent?.clearHistory();
  res.json({ ok: true });
});

app.get("/stats", (_req: Request, res: Response) => {
  res.json(devAgent!.getStats());
});

app.get("/providers", async (_req: Request, res: Response) => {
  try {
    const providers = await readJsonProviders();
    return res.json({ ok: true, providers });
  } catch (err) {
    return res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

app.post("/providers", async (req: Request<object, object, { providers: ProviderConfigRaw[] }>, res: Response) => {
  try {
    const { providers } = req.body;
    if (!Array.isArray(providers)) {
      return res.status(400).json({ ok: false, error: "providers debe ser un array" });
    }
    for (const p of providers) {
      if (!p.apiKey?.trim()) return res.status(400).json({ ok: false, error: "Todos los proveedores necesitan API key" });
      if (!p.model?.trim())  return res.status(400).json({ ok: false, error: "Todos los proveedores necesitan modelo" });
    }
    await writeJsonProviders(providers);
    devAgent!.reloadProviders();
    return res.json({ ok: true, count: providers.length });
  } catch (err) {
    return res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

app.get("/providers/test", async (req: Request, res: Response) => {
  const idx = parseInt(String(req.query.index ?? "0"), 10);
  if (isNaN(idx) || idx < 0) {
    return res.status(400).json({ ok: false, error: "index inválido" });
  }
  try {
    const result = await devAgent!.testProvider(idx);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

app.post("/providers/test/adhoc", async (req: Request<object, object, { apiKey?: string; model?: string; baseUrl?: string; headers?: string }>, res: Response) => {
  const { apiKey, model, baseUrl, headers } = req.body;
  if (!apiKey?.trim()) return res.status(400).json({ ok: false, error: "apiKey requerida" });
  if (!model?.trim())  return res.status(400).json({ ok: false, error: "model requerido" });
  try {
    const result = await ProviderRegistry.testAdhoc({ apiKey, model, baseURL: baseUrl, headers });
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ ok: false, error: (err as Error).message });
  }
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

  // Validar git en el NUEVO path, no en el actual
  try {
    const { stdout } = await execAsync("git status --porcelain", { cwd: resolved, timeout: 10000 });
    const out = stdout.toLowerCase();
    if (out.includes("not a git repository") || out.includes("fatal:") || out.includes("no es un repositorio git")) {
      return res.status(400).json({ ok: false, error: `No es un repositorio git: ${resolved}` });
    }
  } catch (err) {
    const errMsg = ((err as { stderr?: string; message?: string }).stderr ?? (err as Error).message ?? "").toLowerCase();
    if (errMsg.includes("not a git repository") || errMsg.includes("fatal:") || errMsg.includes("no es un repositorio git")) {
      return res.status(400).json({ ok: false, error: `No es un repositorio git: ${resolved}` });
    }
    // Si el error es otro (ej: git no instalado), lo ignoramos y continuamos
  }

  process.env.WORKSPACE_DIR = resolved;
  devAgent!.clearHistory();
  testAgent?.clearHistory();
  codeReviewAgent?.clearHistory();

  // Reiniciar el subprocess MCP para que tome el nuevo WORKSPACE_DIR
  try {
    await mcpClient.reconnect();
  } catch (reconnectErr) {
    logger.error("Error al reconectar MCP Client:", (reconnectErr as Error).message);
    return res.status(500).json({ ok: false, error: "Error al reconectar el servidor MCP" });
  }

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
    const result = await gitExecPanel("log --pretty=format:'%h|%ar|%s' -n 8");
    if (!result.ok) return res.json([]);
    const commits: CommitEntry[] = (result.out ?? "").split("\n").filter(Boolean).map((line) => {
      const [hash, date, ...rest] = line.split("|");
      return { hash: hash ?? "", date: date ?? "", message: rest.join("|") };
    });
    res.json(commits);
  } catch {
    res.json([]);
  }
});

app.get("/git/branches", async (_req: Request, res: Response) => {
  const result = await gitExecPanel("branch '--format=%(refname:short)'");
  if (!result.ok) return res.json({ ok: false, branches: [] });
  const branches = result.out.split("\n").map(b => b.trim()).filter(Boolean);
  res.json({ ok: true, branches });
});

app.post("/git/checkout", async (req: Request<object, object, { branch?: string }>, res: Response) => {
  const { branch } = req.body;
  if (!branch?.trim()) return res.status(400).json({ ok: false, out: "Nombre de rama requerido" });
  const result = await gitExecPanel(`checkout ${branch.trim()}`);
  res.json(result);
});

app.post("/git/branch", async (req: Request<object, object, GitBranchBody>, res: Response) => {
  const { name, from } = req.body;
  if (!name?.trim()) return res.status(400).json({ ok: false, out: "Nombre de rama requerido" });
  const base = from?.trim() || "HEAD";
  const result = await gitExecPanel(`checkout -b ${name.trim()} ${base}`);
  res.json(result);
});

app.post("/git/branch/rename", async (req: Request<object, object, { oldName?: string; newName?: string }>, res: Response) => {
  const { oldName, newName } = req.body;
  if (!oldName?.trim() || !newName?.trim()) return res.status(400).json({ ok: false, out: "Nombres requeridos" });
  const result = await gitExecPanel(`branch -m ${oldName.trim()} ${newName.trim()}`);
  res.json(result);
});

app.post("/git/branch/delete", async (req: Request<object, object, { name?: string; force?: boolean }>, res: Response) => {
  const { name, force } = req.body;
  if (!name?.trim()) return res.status(400).json({ ok: false, out: "Nombre de rama requerido" });
  const PROTECTED = ["master", "main", "develop", "production"];
  if (PROTECTED.includes(name.trim())) return res.status(400).json({ ok: false, out: `La rama "${name}" está protegida y no se puede eliminar.` });
  const flag = force ? "-D" : "-d";
  const result = await gitExecPanel(`branch ${flag} ${name.trim()}`);
  res.json(result);
});

app.post("/git/init", async (_req: Request, res: Response) => {
  try {
    const cwd = getWorkspaceDir();
    const result = await execAsync("git init", { cwd, timeout: 10000 });
    res.json({ ok: true, out: result.stdout });
  } catch (err) {
    const error = err as { stderr?: string; message: string };
    res.status(500).json({ ok: false, out: error.stderr ?? error.message });
  }
});

// ─── Notes Endpoints ─────────────────────────────────────────────────────────

app.get("/notes", async (_req: Request, res: Response) => {
  const notesPath = path.join(getWorkspaceDir(), NOTES_FILE);
  try {
    const content = await fs.readFile(notesPath, "utf-8");
    res.json({ content: content.trim() });
  } catch {
    res.json({ content: "" });
  }
});

app.post("/notes", async (req: Request<object, object, NotesBody>, res: Response) => {
  const { content, title } = req.body;
  if (!content?.trim()) return res.status(400).json({ ok: false, error: "content requerido" });

  const notesPath = path.join(getWorkspaceDir(), NOTES_FILE);
  const timestamp = new Date().toLocaleString("es", { dateStyle: "short", timeStyle: "short" });
  const entry = `\n## ${title?.trim() || "Nota"}\n*${timestamp}*\n\n${content.trim()}\n\n---\n`;
  await fs.appendFile(notesPath, entry, "utf-8");
  return res.json({ ok: true });
});

app.delete("/notes/:index", async (req: Request, res: Response) => {
  const idx = parseInt(req.params.index as string, 10);
  if (isNaN(idx) || idx < 0) return res.status(400).json({ ok: false, error: "index inválido" });
  const notesPath = path.join(getWorkspaceDir(), NOTES_FILE);
  try {
    const raw = await fs.readFile(notesPath, "utf-8");
    const sections = raw.split(/\n---\n/).filter((s: string) => s.trim());
    if (idx >= sections.length) return res.status(404).json({ ok: false, error: "nota no encontrada" });
    sections.splice(idx, 1);
    const newContent = sections.length ? sections.join("\n---\n") + "\n---\n" : "";
    await fs.writeFile(notesPath, newContent, "utf-8");
    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ ok: false, error: "error al eliminar nota" });
  }
});

app.delete("/notes", async (_req: Request, res: Response) => {
  const notesPath = path.join(getWorkspaceDir(), NOTES_FILE);
  await fs.writeFile(notesPath, "", "utf-8");
  res.json({ ok: true });
});

/**
 * POST /chat  { message: string, agent?: "dev" | "test" | "codereview" }
 * Responde con un stream SSE:
 *   data: { type: "tool",  name, args }
 *   data: { type: "done",  content, iterations, toolCalls }
 *   data: { type: "error", message }
 */
app.post("/chat", (req: Request<object, object, ChatBody>, res: Response) => {
  const { message, agent: agentType, jobId: clientJobId } = req.body;
  if (!message?.trim()) {
    return res.status(400).json({ error: "message requerido" });
  }

  const currentAgent = getAgent(agentType);
  if (!currentAgent) {
    return res.status(400).json({ error: "Agente no disponible" });
  }

  // Usar jobId del cliente si es válido y no está en uso
  const jobId = (clientJobId && typeof clientJobId === "string" && !jobStore.has(clientJobId))
    ? clientJobId
    : generateJobId();

  const job: Job = {
    status: "running",
    events: [],
    listeners: new Set(),
    createdAt: Date.now(),
  };
  jobStore.set(jobId, job);

  // Start processing in background
  (async () => {
    const onTool    = ({ name, args }: ToolEvent)             => emitJobEvent(job, { type: "tool", name, args });
    const onDone    = (payload: DoneEvent)                    => {
      emitJobEvent(job, { type: "done", ...payload });
      job.status = "done";
      closeJobListeners(job);
    };
    const onSwitch  = ({ from, reason }: ProviderSwitchEvent) => emitJobEvent(job, { type: "providerSwitch", from, reason });
    const onConfirm = (event: ConfirmEvent) => {
      pendingConfirms.set(event.id, event.resolve);
      emitJobEvent(job, { type: "confirm", id: event.id, toolName: event.toolName, args: event.args });
    };

    currentAgent.events.once("done",         onDone);
    currentAgent.events.on("tool",           onTool);
    currentAgent.events.on("providerSwitch", onSwitch);
    currentAgent.events.on("confirm",        onConfirm);

    try {
      await currentAgent.processMessage(message);
    } catch (err) {
      emitJobEvent(job, { type: "error", message: (err as Error).message });
      job.status = "error";
      closeJobListeners(job);
    } finally {
      currentAgent.events.off("tool",          onTool);
      currentAgent.events.off("done",          onDone);
      currentAgent.events.off("providerSwitch", onSwitch);
      currentAgent.events.off("confirm",        onConfirm);
      // Auto-cleanup after 30 minutes
      setTimeout(() => jobStore.delete(jobId), 30 * 60 * 1000);
    }
  })();

  return res.json({ jobId });
});

app.get("/chat/job/:jobId", (req: Request, res: Response) => {
  const job = jobStore.get(req.params.jobId as string);
  if (!job) return res.status(404).json({ error: "Job no encontrado o expirado" });
  return res.json({ status: job.status, eventCount: job.events.length });
});

app.get("/chat/stream/:jobId", (req: Request, res: Response) => {
  const job = jobStore.get(req.params.jobId as string);
  if (!job) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    res.write(`data: ${JSON.stringify({ type: "error", message: "Job no encontrado o expirado" })}\n\n`);
    res.end();
    return;
  }

  res.setHeader("Content-Type",  "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection",    "keep-alive");
  res.flushHeaders();

  const lastEventId = parseInt(req.headers["last-event-id"] as string || "-1", 10);
  const startFrom = isNaN(lastEventId) ? 0 : lastEventId + 1;

  const send = (data: object, idx: number) => {
    try { res.write(`id: ${idx}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* ignore */ }
  };

  // Replay missed/buffered events
  for (let i = startFrom; i < job.events.length; i++) {
    send(job.events[i], i);
  }

  if (job.status !== "running") {
    res.end();
    return;
  }

  const keepalive = setInterval(() => {
    try { res.write(": ping\n\n"); } catch { clearInterval(keepalive); }
  }, 15000);

  const listener: JobListener = (data, idx) => {
    if ((data as { type: string }).type === "_close") {
      clearInterval(keepalive);
      job.listeners.delete(listener);
      res.end();
    } else {
      send(data, idx);
    }
  };

  job.listeners.add(listener);

  req.on("close", () => {
    clearInterval(keepalive);
    job.listeners.delete(listener);
  });
});

app.post("/chat/confirm", (req: Request<object, object, { id: string; approved: boolean }>, res: Response) => {
  const { id, approved } = req.body;
  const resolve = pendingConfirms.get(id);
  if (!resolve) {
    return res.status(404).json({ error: "Confirmación no encontrada o ya expirada" });
  }
  pendingConfirms.delete(id);
  resolve(approved === true);
  return res.json({ ok: true });
});

// ─── Arranque ─────────────────────────────────────────────────────────────────

const httpServer = createServer(app);

// ─── Terminal WebSocket ───────────────────────────────────────────────────────

const wss = new WebSocketServer({ server: httpServer, path: "/terminal" });

wss.on("connection", (ws: WebSocket) => {
  const cwd = getWorkspaceDir();
  const shell = process.env.SHELL || "/bin/bash";

  const ptyProc = pty.spawn(shell, [], {
    name: "xterm-256color",
    cols: 120,
    rows: 30,
    cwd,
    env: process.env as Record<string, string>,
  });

  ptyProc.onData((data: string) => {
    if (ws.readyState === WebSocket.OPEN) {
      const b64 = Buffer.from(data, "utf-8").toString("base64");
      ws.send(JSON.stringify({ type: "data", data: b64 }));
    }
  });

  ptyProc.onExit(({ exitCode }) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "exit", code: exitCode }));
      ws.close();
    }
  });

  ws.on("message", (msg: Buffer) => {
    try {
      const parsed = JSON.parse(msg.toString()) as { type: string; data?: string; cols?: number; rows?: number };
      if (parsed.type === "input" && parsed.data) {
        ptyProc.write(Buffer.from(parsed.data, "base64").toString("utf-8"));
      } else if (parsed.type === "resize" && parsed.cols && parsed.rows) {
        ptyProc.resize(parsed.cols, parsed.rows);
      }
    } catch { /* ignore malformed */ }
  });

  ws.on("close", () => {
    try { ptyProc.kill(); } catch { /* ignore */ }
  });
});

process.on("SIGINT", async () => {
  await mcpClient.disconnect();
  process.exit(0);
});

initAgent()
  .then(() =>
    httpServer.listen(config.webPort, () => {
      console.log(`\n🌐  Abre tu navegador en http://localhost:${config.webPort}\n`);
    })
  )
  .catch((err: Error) => {
    logger.error("Error iniciando el servidor web:", err.message);
    process.exit(1);
  });
