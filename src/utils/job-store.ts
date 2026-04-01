// =============================================
//   Job Store — SQLite persistente
//   Guarda historial de jobs incluso si el
//   servidor se reinicia. Limpieza automática
//   de jobs > 24h.
// =============================================

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const DB_DIR = path.resolve(process.cwd(), "data");
fs.mkdirSync(DB_DIR, { recursive: true });

const db = new Database(path.join(DB_DIR, "jobs.db"));

// WAL para mejor rendimiento concurrente
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id         TEXT PRIMARY KEY,
    status     TEXT NOT NULL DEFAULT 'running',
    events     TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at);
`);

// Limpiar jobs de más de 24h al arrancar
const cleanup = db.prepare(`DELETE FROM jobs WHERE created_at < ?`);
cleanup.run(Date.now() - 24 * 60 * 60 * 1000);

// ─── Prepared statements ─────────────────────────────────────────────────────

const stmtInsert = db.prepare(`
  INSERT INTO jobs (id, status, events, created_at, updated_at)
  VALUES (@id, @status, @events, @created_at, @updated_at)
`);

const stmtUpdateStatus = db.prepare(`
  UPDATE jobs SET status = @status, updated_at = @updated_at WHERE id = @id
`);

const stmtAppendEvent = db.prepare(`
  UPDATE jobs SET events = @events, updated_at = @updated_at WHERE id = @id
`);

const stmtGet = db.prepare(`SELECT * FROM jobs WHERE id = ?`);

const stmtDelete = db.prepare(`DELETE FROM jobs WHERE id = ?`);

// ─── Tipos ───────────────────────────────────────────────────────────────────

export type JobStatus = "running" | "done" | "error";

export type JobListener = (data: object, idx: number) => void;

export interface PersistedJob {
  id:         string;
  status:     JobStatus;
  events:     object[];
  createdAt:  number;
  // Runtime-only (no se persiste en DB):
  listeners:  Set<JobListener>;
}

// ─── Cache en memoria para listeners activos ─────────────────────────────────

const runtimeMap = new Map<string, PersistedJob>();

function dbRowToJob(row: { id: string; status: string; events: string; created_at: number }): PersistedJob {
  const existing = runtimeMap.get(row.id);
  return {
    id:        row.id,
    status:    row.status as JobStatus,
    events:    JSON.parse(row.events) as object[],
    createdAt: row.created_at,
    listeners: existing?.listeners ?? new Set(),
  };
}

// ─── API pública ─────────────────────────────────────────────────────────────

export const jobStore = {
  create(id: string): PersistedJob {
    const now = Date.now();
    stmtInsert.run({ id, status: "running", events: "[]", created_at: now, updated_at: now });
    const job: PersistedJob = { id, status: "running", events: [], createdAt: now, listeners: new Set() };
    runtimeMap.set(id, job);
    // Auto-limpiar de memoria a los 30min (DB persiste 24h)
    setTimeout(() => runtimeMap.delete(id), 30 * 60 * 1000);
    return job;
  },

  get(id: string): PersistedJob | undefined {
    // Primero buscar en cache runtime
    const cached = runtimeMap.get(id);
    if (cached) return cached;
    // Luego en DB (permite recuperar jobs de sesiones anteriores)
    const row = stmtGet.get(id) as { id: string; status: string; events: string; created_at: number } | undefined;
    if (!row) return undefined;
    const job = dbRowToJob(row);
    runtimeMap.set(id, job);
    return job;
  },

  has(id: string): boolean {
    if (runtimeMap.has(id)) return true;
    return !!stmtGet.get(id);
  },

  emitEvent(job: PersistedJob, data: object): void {
    const idx = job.events.length;
    job.events.push(data);
    // Persistir en DB
    stmtAppendEvent.run({ events: JSON.stringify(job.events), updated_at: Date.now(), id: job.id });
    // Notificar listeners en tiempo real
    for (const listener of job.listeners) {
      listener(data, idx);
    }
  },

  setStatus(job: PersistedJob, status: JobStatus): void {
    job.status = status;
    stmtUpdateStatus.run({ status, updated_at: Date.now(), id: job.id });
  },

  closeListeners(job: PersistedJob): void {
    for (const listener of job.listeners) {
      listener({ type: "_close" }, -1);
    }
    job.listeners.clear();
  },

  delete(id: string): void {
    runtimeMap.delete(id);
    stmtDelete.run(id);
  },
};
