import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadGoldenFile } from "./parser.js";
import { assertGoldenCase } from "./runner.js";
import { execCommandsOnly } from "./executors/commands.js";

const workspaceDir = path.resolve(process.cwd());

const cfg = {
  agents: {
    defaults: {
      userTimezone: "America/Chicago",
    },
  },
} as any;

describe("goldens (astra)", () => {
  const file = path.join(workspaceDir, "test", "goldens", "astra-memory-review.md");
  const cases = loadGoldenFile(file);

  for (const c of cases) {
    it(c.title, async () => {
      const out = await execCommandsOnly({ input: c.input, cfg, workspaceDir });
      expect(typeof out).toBe("string");
      assertGoldenCase({ c, output: out });
    });
  }
});
