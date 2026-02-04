import type { OpenClawConfig } from "../../../config/config.js";
import type { HandleCommandsParams } from "../../../auto-reply/reply/commands-types.js";
import { handleCommands } from "../../../auto-reply/reply/commands-core.js";

// A tiny deterministic executor: run the text-command handler and capture its immediate reply.
// NOTE: This does not run the LLM agent. It's for command behavior + formatting.
export async function execCommandsOnly(params: {
  input: string;
  cfg: OpenClawConfig;
  workspaceDir: string;
}): Promise<string> {
  const text = params.input.trim();

  // Provide a real session store path so commands that persist session metadata can run.
  const os = await import("node:os");
  const fs = await import("node:fs");
  const path = await import("node:path");
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "openclaw-goldens-"));
  const storePath = path.join(tmpDir, "sessions.json");
  await fs.promises.writeFile(storePath, "{}", "utf-8");

  const sessionKey = "agent:main:main";
  const sessionEntry = {
    sessionId: "test",
    updatedAt: Date.now(),
    lastChannel: "webchat",
    lastTo: "test",
  } as any;

  const base: HandleCommandsParams = {
    ctx: {
      Body: text,
      RawBody: text,
      CommandBody: text,
      CommandSource: "text",
      ChatType: "direct",
      MessageSid: "golden-message",
    },
    cfg: params.cfg,
    command: {
      surface: "webchat",
      channel: "webchat",
      ownerList: ["test"],
      isAuthorizedSender: true,
      rawBodyNormalized: text,
      commandBodyNormalized: text,
      from: "test",
      to: "test",
    },
    directives: {
      hasThinkDirective: false,
      hasVerboseDirective: false,
      hasReasoningDirective: false,
      hasElevatedDirective: false,
    },
    elevated: { enabled: false, allowed: false, failures: [] },
    sessionEntry,
    previousSessionEntry: undefined,
    sessionStore: { [sessionKey]: sessionEntry },
    sessionKey,
    storePath,
    sessionScope: "per-sender",
    workspaceDir: params.workspaceDir,
    defaultGroupActivation: () => "mention",
    resolvedThinkLevel: "off",
    resolvedVerboseLevel: "off",
    resolvedReasoningLevel: "off",
    resolvedElevatedLevel: "off",
    resolveDefaultThinkingLevel: async () => "off",
    provider: "openai-codex",
    model: "gpt-5.2",
    contextTokens: 100_000,
    isGroup: false,
    skillCommands: [],
  };

  const res = await handleCommands(base);
  return res.reply?.text ?? "";
}
