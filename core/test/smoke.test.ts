import { describe, expect, it } from "vitest";
import { version } from "../src/index.js";

describe("core", () => {
  it("exports a version", () => {
    expect(version).toBe("0.0.0");
  });
});
