import { describe, expect, it } from "vitest";
import { buildToneDirective } from "./tone-state.js";

describe("tone-state", () => {
  it("builds short directives", () => {
    expect(buildToneDirective("NEUTRAL")).toContain("Tone:");
    expect(buildToneDirective("PLAYFUL")).toMatch(/playful/i);
    expect(buildToneDirective("FLIRT_SAFE")).toMatch(/romantic/i);
  });
});
