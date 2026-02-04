import path from "node:path";
import { describe, expect, it } from "vitest";
import { execCommandsOnly } from "./executors/commands.js";
import { loadGoldenFile } from "./parser.js";
import { assertGoldenCase } from "./runner.js";

const workspaceDir = path.resolve(process.cwd());

const cfg = {
  agents: {
    defaults: {
      userTimezone: "America/Chicago",
    },
  },
} as any;

describe("goldens (astra)", () => {
  const files = ["astra-memory-review.md", "astra-remember-explicit.md"].map((name) =>
    path.join(workspaceDir, "test", "goldens", name),
  );

  for (const file of files) {
    const cases = loadGoldenFile(file);
    for (const c of cases) {
      it(c.title, async () => {
        const out = await execCommandsOnly({ input: c.input, cfg, workspaceDir });
        expect(typeof out).toBe("string");
        assertGoldenCase({ c, output: out });
      });
    }
  }
});
