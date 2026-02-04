import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { OpenClawConfig } from "../../config/config.js";
import type { SessionEntry } from "../../config/sessions.js";
import { resolveUserTimezone } from "../../agents/date-time.js";
import {
  loadSessionStore,
  updateSessionStore,
  updateSessionStoreEntry,
} from "../../config/sessions.js";
import { routeReply } from "./route-reply.js";

export type MemoryCandidate = {
  id: string;
  createdAt: number;
  text: string;
  sourceMessageId?: string;
  status: "pending" | "deferred";
  deferredUntil?: number;
};

export type MemoryReviewState = {
  queue?: MemoryCandidate[];
  lastPromptAt?: number;
};

const DEFAULT_PROMPT_INTERVAL_MS = 20 * 60 * 60 * 1000; // 20h
const DEFAULT_DEFER_MS = 24 * 60 * 60 * 1000; // 24h

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function normalizeMemoryReviewState(entry?: SessionEntry): MemoryReviewState {
  const raw = entry?.memoryReview;
  if (!raw || typeof raw !== "object") {
    return {};
  }
  // oxlint-disable-next-line typescript/no-explicit-any
  const obj = raw as any;
  const queue = Array.isArray(obj.queue)
    ? obj.queue
        .filter((c: unknown) => !!c && typeof c === "object")
        // oxlint-disable-next-line typescript/no-explicit-any
        .map((c: any) => ({
          id: isNonEmptyString(c.id) ? c.id : crypto.randomUUID(),
          createdAt: typeof c.createdAt === "number" ? c.createdAt : Date.now(),
          text: isNonEmptyString(c.text) ? c.text : "",
          sourceMessageId: isNonEmptyString(c.sourceMessageId) ? c.sourceMessageId : undefined,
          status: c.status === "deferred" ? "deferred" : "pending",
          deferredUntil: typeof c.deferredUntil === "number" ? c.deferredUntil : undefined,
        }))
        .filter((c: MemoryCandidate) => c.text.trim().length > 0)
    : undefined;
  const lastPromptAt = typeof obj.lastPromptAt === "number" ? obj.lastPromptAt : undefined;
  return { queue, lastPromptAt };
}

export function listPendingCandidates(entry?: SessionEntry, now = Date.now()): MemoryCandidate[] {
  const state = normalizeMemoryReviewState(entry);
  const queue = state.queue ?? [];
  return queue.filter((c) => {
    if (c.status === "pending") {
      return true;
    }
    if (c.status === "deferred") {
      return (c.deferredUntil ?? 0) <= now;
    }
    return false;
  });
}

export async function enqueueMemoryCandidate(params: {
  storePath: string;
  sessionKey: string;
  text: string;
  sourceMessageId?: string;
}): Promise<SessionEntry | null> {
  const { storePath, sessionKey } = params;
  const text = params.text.trim();
  if (!text) {
    return null;
  }
  const candidate: MemoryCandidate = {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    text,
    sourceMessageId: params.sourceMessageId,
    status: "pending",
  };

  return await updateSessionStoreEntry({
    storePath,
    sessionKey,
    update: async (entry) => {
      const state = normalizeMemoryReviewState(entry);
      const nextQueue = [...(state.queue ?? []), candidate].slice(-50);
      return {
        memoryReview: {
          ...state,
          queue: nextQueue,
        },
      };
    },
  });
}

function formatCandidateLine(candidate: MemoryCandidate, index: number): string {
  const preview = candidate.text.replace(/\s+/g, " ").trim();
  const clipped = preview.length > 160 ? `${preview.slice(0, 157)}...` : preview;
  return `${index + 1}. ${clipped}`;
}

export function buildMemoryReviewListText(params: {
  sessionEntry?: SessionEntry;
  now?: number;
}): string {
  const now = params.now ?? Date.now();
  const pending = listPendingCandidates(params.sessionEntry, now);
  if (pending.length === 0) {
    return "No memory candidates pending.";
  }
  const lines = pending.map((c, i) => formatCandidateLine(c, i));
  return (
    `Memory review: ${pending.length} pending\n\n` +
    lines.join("\n") +
    "\n\nActions:\n" +
    "• /memory-review keep <n>\n" +
    "• /memory-review edit <n> <new text>\n" +
    "• /memory-review discard <n>\n" +
    "• /memory-review defer <n> [hours]"
  );
}

function resolveDailyMemoryPath(
  cfg: OpenClawConfig,
  workspaceDir: string,
  now = new Date(),
): string {
  const timeZone = resolveUserTimezone(cfg.agents?.defaults?.userTimezone);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const pick = (type: string) => parts.find((p) => p.type === type)?.value;
  const yyyy = pick("year") ?? "0000";
  const mm = pick("month") ?? "00";
  const dd = pick("day") ?? "00";
  const filename = `${yyyy}-${mm}-${dd}.md`;
  return path.join(workspaceDir, "memory", filename);
}

async function appendToDailyMemory(params: {
  cfg: OpenClawConfig;
  workspaceDir: string;
  text: string;
}): Promise<void> {
  const filePath = resolveDailyMemoryPath(params.cfg, params.workspaceDir);
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const line = `- ${params.text.trim()}\n`;
  await fs.promises.appendFile(filePath, line, "utf-8");
}

export async function applyMemoryReviewAction(params: {
  cfg: OpenClawConfig;
  workspaceDir: string;
  storePath: string;
  sessionKey: string;
  action: "keep" | "discard" | "defer" | "edit";
  index: number;
  newText?: string;
  deferHours?: number;
}): Promise<string> {
  const now = Date.now();
  const { storePath, sessionKey } = params;

  let picked: MemoryCandidate | undefined;

  await updateSessionStore(storePath, async (store) => {
    const entry = store[sessionKey];
    if (!entry) {
      return;
    }
    const state = normalizeMemoryReviewState(entry);
    const pending = listPendingCandidates(entry, now);
    const target = pending[params.index];
    if (!target) {
      return;
    }
    picked = target;

    const queue = (state.queue ?? []).map((c) => ({ ...c }));
    const qIndex = queue.findIndex((c) => c.id === target.id);
    if (qIndex === -1) {
      return;
    }

    if (params.action === "discard") {
      queue.splice(qIndex, 1);
    } else if (params.action === "defer") {
      const hours = Math.max(1, Math.floor(params.deferHours ?? 24));
      queue[qIndex] = {
        ...queue[qIndex],
        status: "deferred",
        deferredUntil: now + hours * 60 * 60 * 1000,
      };
    } else if (params.action === "edit") {
      const nextText = params.newText?.trim();
      if (!nextText) {
        return;
      }
      queue[qIndex] = {
        ...queue[qIndex],
        text: nextText,
        status: "pending",
        deferredUntil: undefined,
      };
    } else if (params.action === "keep") {
      queue.splice(qIndex, 1);
    }

    store[sessionKey] = {
      ...entry,
      memoryReview: {
        ...state,
        queue,
      },
      updatedAt: Date.now(),
    };
  });

  if (!picked) {
    return "Couldn't find that memory item. Run /memory-review to see the list.";
  }

  if (params.action === "keep") {
    await appendToDailyMemory({
      cfg: params.cfg,
      workspaceDir: params.workspaceDir,
      text: picked.text,
    });
    return `✅ Saved to daily memory: ${picked.text}`;
  }

  if (params.action === "discard") {
    return "🗑️ Discarded.";
  }

  if (params.action === "defer") {
    const hours = Math.max(1, Math.floor(params.deferHours ?? 24));
    return `⏸️ Deferred for ~${hours}h.`;
  }

  if (params.action === "edit") {
    return "✍️ Edited. (Still pending — run /memory-review keep <n> to save it.)";
  }

  return "OK.";
}

export async function maybeNudgeMemoryReview(params: {
  cfg: OpenClawConfig;
  storePath?: string;
  workspaceDir: string;
  now?: number;
}): Promise<void> {
  const storePath = params.storePath;
  if (!storePath) {
    return;
  }
  const now = params.now ?? Date.now();

  const store = loadSessionStore(storePath);
  const sessionsToPrompt = Object.entries(store)
    .map(([key, entry]) => ({ key, entry }))
    .filter(({ entry }) => {
      const pending = listPendingCandidates(entry, now);
      if (pending.length === 0) {
        return false;
      }
      const state = normalizeMemoryReviewState(entry);
      const last = state.lastPromptAt ?? 0;
      return now - last >= DEFAULT_PROMPT_INTERVAL_MS;
    })
    .slice(0, 10);

  for (const { key: sessionKey, entry } of sessionsToPrompt) {
    const pendingCount = listPendingCandidates(entry, now).length;
    const channel = entry.lastChannel ?? entry.deliveryContext?.channel;
    const to = entry.lastTo ?? entry.deliveryContext?.to;
    if (!channel || !to) {
      continue;
    }

    await updateSessionStoreEntry({
      storePath,
      sessionKey,
      update: async (existing) => {
        const state = normalizeMemoryReviewState(existing);
        return {
          memoryReview: {
            ...state,
            lastPromptAt: now,
          },
        };
      },
    });

    await routeReply({
      cfg: params.cfg,
      channel,
      to,
      sessionKey,
      accountId: entry.lastAccountId ?? entry.deliveryContext?.accountId,
      threadId: entry.lastThreadId ?? entry.deliveryContext?.threadId,
      payload: {
        text: `🧠 Memory review pending: ${pendingCount} item${pendingCount === 1 ? "" : "s"}.\nReply /memory-review to review + keep/edit/discard/defer.`,
      },
    });
  }
}

export function extractExplicitMemoryCandidates(params: { body: string }): string[] {
  const lines = params.body.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const match = trimmed.match(/^remember\s*:?\s*(.+)$/i);
    if (match) {
      out.push(match[1].trim());
    }
  }
  return out;
}
