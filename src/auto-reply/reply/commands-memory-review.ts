import type { CommandHandlerResult, HandleCommandsParams } from "./commands-types.js";
import { shouldHandleTextCommands } from "../commands-registry.js";
import {
  applyMemoryReviewAction,
  buildMemoryReviewListText,
  enqueueMemoryCandidate,
} from "./memory-review.js";

function parseIntSafe(value?: string): number | null {
  if (!value) {
    return null;
  }
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

export async function handleMemoryReviewCommands(
  params: HandleCommandsParams,
  allowTextCommands: boolean,
): Promise<CommandHandlerResult | null> {
  if (!allowTextCommands) {
    return null;
  }
  if (
    !shouldHandleTextCommands({
      cfg: params.cfg,
      surface: params.command.surface,
      commandSource: params.ctx.CommandSource,
    })
  ) {
    return null;
  }

  const body = params.command.commandBodyNormalized.trim();
  if (
    !body.startsWith("/memory-review") &&
    !body.startsWith("/memoryreview") &&
    !body.startsWith("/remember")
  ) {
    return null;
  }

  if (!params.storePath) {
    return {
      reply: { text: "Session store is unavailable; can't manage memory review queue." },
      shouldContinue: false,
    };
  }

  if (body.startsWith("/remember")) {
    const text = body.replace(/^\/remember\s*/i, "").trim();
    if (!text) {
      return {
        reply: { text: "Usage: /remember <thing to remember>" },
        shouldContinue: false,
      };
    }
    await enqueueMemoryCandidate({
      storePath: params.storePath,
      sessionKey: params.sessionKey,
      text,
      sourceMessageId: params.ctx.MessageSid,
    });
    return { reply: { text: "✅ Added to memory review queue." }, shouldContinue: false };
  }

  // /memory-review [list|keep|edit|discard|defer] ...
  const rest = body.replace(/^\/(memory-review|memoryreview)\s*/i, "").trim();
  if (!rest) {
    return {
      reply: {
        text: buildMemoryReviewListText({ sessionEntry: params.sessionEntry }),
      },
      shouldContinue: false,
    };
  }

  const [actionRaw, nRaw, ...tail] = rest.split(/\s+/);
  const action = (actionRaw ?? "").toLowerCase();
  const indexOneBased = parseIntSafe(nRaw);
  if (!indexOneBased || indexOneBased < 1) {
    return {
      reply: {
        text: "Usage: /memory-review keep|edit|discard|defer <n> ... (run /memory-review to see n)",
      },
      shouldContinue: false,
    };
  }
  const index = indexOneBased - 1;

  if (action === "keep" || action === "discard") {
    const text = await applyMemoryReviewAction({
      cfg: params.cfg,
      workspaceDir: params.workspaceDir,
      storePath: params.storePath,
      sessionKey: params.sessionKey,
      action,
      index,
    });
    return { reply: { text }, shouldContinue: false };
  }

  if (action === "defer") {
    const hours = parseIntSafe(tail[0]) ?? undefined;
    const text = await applyMemoryReviewAction({
      cfg: params.cfg,
      workspaceDir: params.workspaceDir,
      storePath: params.storePath,
      sessionKey: params.sessionKey,
      action: "defer",
      index,
      deferHours: hours,
    });
    return { reply: { text }, shouldContinue: false };
  }

  if (action === "edit") {
    const newText = tail.join(" ").trim();
    if (!newText) {
      return {
        reply: { text: "Usage: /memory-review edit <n> <new text>" },
        shouldContinue: false,
      };
    }
    const text = await applyMemoryReviewAction({
      cfg: params.cfg,
      workspaceDir: params.workspaceDir,
      storePath: params.storePath,
      sessionKey: params.sessionKey,
      action: "edit",
      index,
      newText,
    });
    return { reply: { text }, shouldContinue: false };
  }

  return {
    reply: { text: "Unknown action. Use: /memory-review keep|edit|discard|defer" },
    shouldContinue: false,
  };
}
