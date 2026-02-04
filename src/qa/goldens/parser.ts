import fs from "node:fs";

export type GoldenCase = {
  title: string;
  input: string;
  expects: Array<
    | { kind: "includes"; value: string }
    | { kind: "not_includes"; value: string }
    | { kind: "regex"; value: RegExp }
  >;
};

function parseExpectLine(line: string): GoldenCase["expects"][number] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("-")) {
    return null;
  }
  const rest = trimmed.replace(/^\-\s*/, "");

  const inc = rest.match(/^includes\s*:\s*"([\s\S]+)"\s*$/);
  if (inc) {
    return { kind: "includes", value: inc[1] };
  }
  const not = rest.match(/^not_includes\s*:\s*"([\s\S]+)"\s*$/);
  if (not) {
    return { kind: "not_includes", value: not[1] };
  }
  const rx = rest.match(/^regex\s*:\s*\/(.+)\/(i|g|m|s|u|y)?\s*$/);
  if (rx) {
    return { kind: "regex", value: new RegExp(rx[1], rx[2] ?? "") };
  }
  return null;
}

export function parseGoldenMarkdown(markdown: string): GoldenCase[] {
  const lines = markdown.split(/\r?\n/);
  const cases: GoldenCase[] = [];

  let title = "";
  let mode: "none" | "input" | "expect" = "none";
  let input: string[] = [];
  let expects: GoldenCase["expects"] = [];

  const flush = () => {
    const inputStr = input.join("\n").trim();
    if (title && inputStr) {
      cases.push({ title, input: inputStr, expects });
    }
    title = "";
    mode = "none";
    input = [];
    expects = [];
  };

  for (const line of lines) {
    const h1 = line.match(/^#\s+Case:\s*(.+)\s*$/i);
    if (h1) {
      flush();
      title = h1[1].trim();
      continue;
    }
    if (line.match(/^##\s+INPUT\s*$/i)) {
      mode = "input";
      continue;
    }
    if (line.match(/^##\s+EXPECT\s*$/i)) {
      mode = "expect";
      continue;
    }

    if (mode === "input") {
      input.push(line);
      continue;
    }

    if (mode === "expect") {
      const parsed = parseExpectLine(line);
      if (parsed) {
        expects.push(parsed);
      }
      continue;
    }
  }

  flush();
  return cases;
}

export function loadGoldenFile(filePath: string): GoldenCase[] {
  const md = fs.readFileSync(filePath, "utf-8");
  return parseGoldenMarkdown(md);
}
