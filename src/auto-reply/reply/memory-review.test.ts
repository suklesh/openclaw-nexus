import { describe, expect, it } from "vitest";
import { extractExplicitMemoryCandidates } from "./memory-review.js";

describe("memory review", () => {
  it("extracts explicit remember lines", () => {
    const body = "hello\nremember: buy milk\nREMEMBER call mom\nnope";
    expect(extractExplicitMemoryCandidates({ body })).toEqual(["buy milk", "call mom"]);
  });
});
