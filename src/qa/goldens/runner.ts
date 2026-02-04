import type { GoldenCase } from "./parser.js";

export type GoldenRun = {
  title: string;
  input: string;
  output: string;
};

export type GoldenExecutor = (input: string) => Promise<string> | string;

export async function runGoldenCases(params: {
  cases: GoldenCase[];
  exec: GoldenExecutor;
}): Promise<GoldenRun[]> {
  const out: GoldenRun[] = [];
  for (const c of params.cases) {
    const output = await params.exec(c.input);
    out.push({ title: c.title, input: c.input, output });
  }
  return out;
}

export function assertGoldenCase(params: {
  c: GoldenCase;
  output: string;
}): void {
  for (const e of params.c.expects) {
    if (e.kind === "includes") {
      if (!params.output.includes(e.value)) {
        throw new Error(`Expected output to include: ${JSON.stringify(e.value)}\n\nOUTPUT:\n${params.output}`);
      }
      continue;
    }
    if (e.kind === "not_includes") {
      if (params.output.includes(e.value)) {
        throw new Error(`Expected output to NOT include: ${JSON.stringify(e.value)}\n\nOUTPUT:\n${params.output}`);
      }
      continue;
    }
    if (e.kind === "regex") {
      if (!e.value.test(params.output)) {
        throw new Error(`Expected output to match regex: ${String(e.value)}\n\nOUTPUT:\n${params.output}`);
      }
      continue;
    }
  }
}
