// =============================================
//   Tests: JobStore (SQLite persistente)
// =============================================

import { describe, it, expect, beforeEach } from "vitest";
import { jobStore } from "../utils/job-store.js";

function uid() { return `test-${Date.now()}-${Math.random().toString(36).slice(2)}`; }

describe("jobStore", () => {
  it("crea y recupera un job por id", () => {
    const id = uid();
    const job = jobStore.create(id);
    expect(job.id).toBe(id);
    expect(job.status).toBe("running");
    expect(job.events).toHaveLength(0);

    const retrieved = jobStore.get(id);
    expect(retrieved).toBeDefined();
    expect(retrieved!.id).toBe(id);
  });

  it("has() retorna true si el job existe", () => {
    const id = uid();
    expect(jobStore.has(id)).toBe(false);
    jobStore.create(id);
    expect(jobStore.has(id)).toBe(true);
    jobStore.delete(id);
  });

  it("emite y persiste eventos", () => {
    const id = uid();
    const job = jobStore.create(id);
    jobStore.emitEvent(job, { type: "tool", name: "read_file" });
    jobStore.emitEvent(job, { type: "done", content: "ok" });

    expect(job.events).toHaveLength(2);

    // Verificar que persiste en DB recuperando desde store
    const fresh = jobStore.get(id);
    expect(fresh!.events).toHaveLength(2);
    expect((fresh!.events[0] as { type: string }).type).toBe("tool");

    jobStore.delete(id);
  });

  it("actualiza status correctamente", () => {
    const id = uid();
    const job = jobStore.create(id);
    expect(job.status).toBe("running");

    jobStore.setStatus(job, "done");
    expect(job.status).toBe("done");

    const fresh = jobStore.get(id);
    expect(fresh!.status).toBe("done");

    jobStore.delete(id);
  });

  it("notifica listeners en tiempo real", () => {
    const id = uid();
    const job = jobStore.create(id);
    const received: object[] = [];

    job.listeners.add((data) => received.push(data));
    jobStore.emitEvent(job, { type: "ping" });
    jobStore.emitEvent(job, { type: "pong" });

    expect(received).toHaveLength(2);
    expect((received[0] as { type: string }).type).toBe("ping");

    jobStore.delete(id);
  });

  it("closeListeners notifica _close y vacía listeners", () => {
    const id = uid();
    const job = jobStore.create(id);
    const signals: string[] = [];

    job.listeners.add((data) => signals.push((data as { type: string }).type));
    jobStore.closeListeners(job);

    expect(signals).toContain("_close");
    expect(job.listeners.size).toBe(0);

    jobStore.delete(id);
  });

  it("delete elimina el job", () => {
    const id = uid();
    jobStore.create(id);
    jobStore.delete(id);
    expect(jobStore.has(id)).toBe(false);
  });
});
