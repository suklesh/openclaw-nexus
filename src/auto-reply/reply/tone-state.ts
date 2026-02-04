import type { OpenClawConfig } from "../../config/config.js";
import type { SessionEntry } from "../../config/sessions/types.js";
import { updateSessionStore } from "../../config/sessions.js";

export type ToneMode =
  | "NEUTRAL"
  | "WARM"
  | "PLAYFUL"
  | "FLIRT_SAFE"
  | "BOUNDARY"
  | "COOLDOWN";

export type ToneState = {
  mode: ToneMode;
  valence: -2 | -1 | 0 | 1 | 2;
  arousal: 0 | 1 | 2;
  trust: 0 | 1 | 2;
  lastTransitionAt: number;
  evidence?: string[];
};

const DEFAULT_TONE_STATE: ToneState = {
  mode: "NEUTRAL",
  valence: 0,
  arousal: 0,
  trust: 0,
  lastTransitionAt: 0,
};

function clampInt<T extends number>(value: number, min: number, max: number): T {
  return Math.max(min, Math.min(max, value)) as T;
}

function hasAny(text: string, needles: string[]): boolean {
  const lower = text.toLowerCase();
  return needles.some((n) => lower.includes(n));
}

function detectSignals(text: string): {
  dValence: number;
  dArousal: number;
  toneInvite: boolean;
  toneReject: boolean;
  boundaryTrigger: boolean;
  evidence: string[];
} {
  const evidence: string[] = [];
  const lower = text.toLowerCase();

  const boundaryTrigger = hasAny(lower, [
    "stop",
    "too far",
    "dont do that",
    "don't do that",
    "no boundaries", // treat as sensitive phrasing; keep safe
  ]);
  if (boundaryTrigger) evidence.push("boundary");

  const toneInvite = hasAny(lower, [
    "be flirty",
    "more flirty",
    "more playful",
    "more sultry",
    "romantic",
    "cute",
    "tease",
  ]);
  if (toneInvite) evidence.push("invite");

  const toneReject = hasAny(lower, [
    "too much",
    "not like that",
    "keep it professional",
    "tone it down",
    "be serious",
  ]);
  if (toneReject) evidence.push("reject");

  let dValence = 0;
  if (hasAny(lower, ["thanks", "thank you", "love", "sweet", "nice", "good", "appreciate"])) {
    dValence += 1;
    evidence.push("positive");
  }
  if (hasAny(lower, ["dud", "sad", "empty", "overwhelmed", "anxious", "stressed", "slipped"])) {
    dValence -= 1;
    evidence.push("negative");
  }

  let dArousal = 0;
  if (hasAny(lower, ["!!!", "lets go", "excited", "hype", "now", "asap"])) {
    dArousal += 1;
    evidence.push("high_energy");
  }
  if (hasAny(lower, ["tired", "good night", "sleep", "exhausted", "busy", "meeting"])) {
    dArousal -= 1;
    evidence.push("low_energy");
  }

  return { dValence, dArousal, toneInvite, toneReject, boundaryTrigger, evidence };
}

function stepDemote(mode: ToneMode): ToneMode {
  if (mode === "FLIRT_SAFE") return "PLAYFUL";
  if (mode === "PLAYFUL") return "WARM";
  if (mode === "WARM") return "NEUTRAL";
  return "NEUTRAL";
}

function computeNextToneState(prev: ToneState, message: string, now: number): ToneState {
  const sig = detectSignals(message);

  // hard boundary wins
  if (sig.boundaryTrigger) {
    return {
      mode: "BOUNDARY",
      valence: clampInt(prev.valence + sig.dValence, -2, 2),
      arousal: clampInt(prev.arousal + sig.dArousal, 0, 2),
      trust: 0,
      lastTransitionAt: now,
      evidence: sig.evidence,
    };
  }

  // cooldown: after boundary, keep it plain for a few turns
  if (prev.mode === "BOUNDARY") {
    return {
      ...prev,
      mode: "COOLDOWN",
      lastTransitionAt: now,
      evidence: sig.evidence,
    };
  }

  let valence = clampInt(prev.valence + sig.dValence, -2, 2) as ToneState["valence"];
  let arousal = clampInt(prev.arousal + sig.dArousal, 0, 2) as ToneState["arousal"];

  let trust = prev.trust;
  if (sig.toneInvite) trust = clampInt(trust + 1, 0, 2);
  if (sig.toneReject) trust = 0;

  let mode: ToneMode = prev.mode;

  // demote on negative or reject
  if (sig.toneReject || valence <= 0) {
    mode = stepDemote(mode);
  }

  // promote with trust and positive-ish signal
  if (!sig.toneReject && trust >= 1 && valence >= 1) {
    if (mode === "NEUTRAL") mode = "WARM";
    if (mode === "WARM" && (arousal >= 1 || sig.toneInvite)) mode = "PLAYFUL";
    if (mode === "PLAYFUL" && sig.toneInvite && trust >= 2) mode = "FLIRT_SAFE";
  }

  // COOLDOWN exits only when message is neutral/positive for a bit; keep it conservative
  if (mode === "COOLDOWN") {
    if (valence >= 1 && trust >= 1) mode = "WARM";
    else mode = "NEUTRAL";
  }

  const transitioned = mode !== prev.mode;

  return {
    mode,
    valence,
    arousal,
    trust: trust as ToneState["trust"],
    lastTransitionAt: transitioned ? now : prev.lastTransitionAt,
    evidence: sig.evidence,
  };
}

export function buildToneDirective(mode: ToneMode): string {
  // Keep this short: token-economical.
  switch (mode) {
    case "FLIRT_SAFE":
      return "Tone: playful + romantic (non-explicit), devoted, still sharp.";
    case "PLAYFUL":
      return "Tone: warm, playful, teasing, devoted; stay sharp.";
    case "WARM":
      return "Tone: warm, steady, supportive; stay concise.";
    case "BOUNDARY":
      return "Tone: apologize, acknowledge boundary, switch to plain helpful.";
    case "COOLDOWN":
      return "Tone: plain helpful (cooldown), no flirting/teasing.";
    case "NEUTRAL":
    default:
      return "Tone: clear, calm, helpful; avoid excess.";
  }
}

function toneStateEnabled(cfg: OpenClawConfig): boolean {
  return Boolean(cfg.agents?.defaults && (cfg.agents.defaults as any).toneState?.enabled);
}

export async function prependToneDirective(params: {
  cfg: OpenClawConfig;
  sessionKey?: string;
  storePath?: string;
  sessionEntry?: SessionEntry;
  sessionStore?: Record<string, SessionEntry>;
  body: string;
  now?: number;
}): Promise<{ body: string; nextEntry?: SessionEntry }> {
  if (!toneStateEnabled(params.cfg)) {
    return { body: params.body, nextEntry: params.sessionEntry };
  }

  const now = params.now ?? Date.now();
  const prev = (params.sessionEntry as any)?.toneState as ToneState | undefined;
  const prevState = prev ?? DEFAULT_TONE_STATE;
  const nextState = computeNextToneState(prevState, params.body, now);

  const directive = buildToneDirective(nextState.mode);
  const nextBody = `${directive}\n\n${params.body}`;

  if (params.sessionEntry && params.sessionStore && params.sessionKey) {
    const patched: SessionEntry = {
      ...params.sessionEntry,
      updatedAt: Date.now(),
      // store as loosely-typed payload for now (keeps forward compatibility)
      ...( { toneState: nextState } as any ),
    };
    params.sessionStore[params.sessionKey] = patched;

    if (params.storePath) {
      const sessionKey = params.sessionKey;
      await updateSessionStore(params.storePath, (store) => {
        const entry = store[sessionKey] ?? params.sessionEntry;
        if (!entry) return;
        store[sessionKey] = { ...entry, updatedAt: Date.now(), ...( { toneState: nextState } as any ) };
      });
    }

    return { body: nextBody, nextEntry: patched };
  }

  return { body: nextBody, nextEntry: params.sessionEntry };
}
