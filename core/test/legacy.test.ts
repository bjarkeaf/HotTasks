import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { extractLegacyTimestamp, migrateLegacyText, parse, serialize, items } from "../src/index.js";

const D = "2026-10-15";

describe("extractLegacyTimestamp", () => {
  it.each([
    ["Followed up with Ronen Tuesday (2026-10-13), 13:30", "Followed up with Ronen", { date: "2026-10-13", time: "13:30" }],
    ["Forwarded to Ronen yesterday (2026-10-14), 08:00", "Forwarded to Ronen", { date: "2026-10-14", time: "08:00" }],
    ["Auto-reminder today (2026-10-15) at 8:00", "Auto-reminder", { date: "2026-10-15", time: "08:00" }],
    ["Based on Sebastian Teams message Thursday (2026-10-15), 15:59", "Based on Sebastian Teams message", { date: "2026-10-15", time: "15:59" }],
    ["Emailed Michael about the length table, Wednesday (2026-10-28)", "Emailed Michael about the length table", { date: "2026-10-28" }],
    ["Sent email to Sami 13/10, 10:00", "Sent email to Sami", { date: "2026-10-13", time: "10:00" }],
    ["Based on Sebastian Teams message 15/10 15:59", "Based on Sebastian Teams message", { date: "2026-10-15", time: "15:59" }],
    ["Can be ignored according to Sunny Shi, 13/10", "Can be ignored according to Sunny Shi", { date: "2026-10-13" }],
    ["Reminded 13:10", "Reminded", { date: D, time: "13:10" }],
    ["Asaf,Yariv reminded 09:35", "Asaf,Yariv reminded", { date: D, time: "09:35" }],
    ["Shani Zamir reminded to sign for T2P_Change_Analyst 15:17", "Shani Zamir reminded to sign for T2P_Change_Analyst", { date: D, time: "15:17" }]
  ])("%s", (line, text, at) => {
    expect(extractLegacyTimestamp(line, D)).toEqual({ text, at });
  });

  it.each([
    "Auto Teams reply to Ronen on Sunday 8:00",
    "Auto email reply to Shani and Ronen on Sunday at 8:00",
    "Auto-reminder tomorrow at 8:00",
    "Amphenol confirmed PN active, 75 in stock, 100 more by EOM",
    "Ratio 1:2 is fine"
  ])("leaves %s alone", (line) => {
    expect(extractLegacyTimestamp(line, D)).toEqual({ text: line });
  });
});

describe("migrateLegacyText", () => {
  it("converts a legacy item: task first, dated lines become events, the rest facts", () => {
    const legacy = [
      "* Cable - HAR002731",
      "\t* Amphenol MCO-042215: *Engineering*",
      "\t\t* Ask for Ronen's approval of MCO",
      "\t\t* Followed up with Ronen Tuesday (2026-10-13), 13:30",
      "\t\t* Amphenol confirmed PN active, 75 in stock",
      "\t\t* Forwarded to Ronen yesterday (2026-10-14), 08:00",
      "\t\t* **Ask Ronen if MCO can be promoted now**",
      ""
    ].join("\n");
    const expected = [
      "* Cable - HAR002731",
      "\t* [ ] Amphenol MCO-042215: *Engineering*",
      "\t\t* **Ask Ronen if MCO can be promoted now**",
      "\t\t* Ask for Ronen's approval of MCO",
      "\t\t* @2026-10-13 13:30 Followed up with Ronen",
      "\t\t* Amphenol confirmed PN active, 75 in stock",
      "\t\t* @2026-10-14 08:00 Forwarded to Ronen",
      ""
    ].join("\n");
    expect(migrateLegacyText(legacy, D)).toBe(expected);
  });

  it("strips bold from a top-level bullet name and reads heading lanes", () => {
    const legacy = "## Task status\n\n* **Merge in 1:1 todos!!**\n* Lab PCs\n\t* **Follow up with Brian**\n\t* Request sent 08:00\n\n### Done\n* Old thing\n\t* Done\n";
    const out = migrateLegacyText(legacy, D);
    expect(out).toContain("* [ ] Merge in 1:1 todos!!\n");
    expect(out).toContain("* [ ] Lab PCs\n\t* **Follow up with Brian**\n\t* @2026-10-15 08:00 Request sent\n");
    expect(out).toContain("### Done\n* [x] Old thing\n\t* Done\n");
  });

  it("is idempotent", () => {
    const legacy = "* A\n\t* B: *Review*\n\t\t* Pinged 10:00\n\t\t* **Chase**\n";
    const once = migrateLegacyText(legacy, D);
    expect(migrateLegacyText(once, "2026-11-01")).toBe(once);
    expect(serialize(parse(once))).toBe(once);
  });
});

describe("legacy fixtures", () => {
  const dir = join(__dirname, "fixtures");
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.startsWith("legacy-")) : [];
  if (files.length === 0) it.skip("no legacy fixtures present", () => {});
  it.each(files)("%s migrates, is idempotent and keeps every line", (name) => {
    const text = readFileSync(join(dir, name), "utf8");
    const date = name.slice("legacy-".length, "legacy-".length + 10);
    const once = migrateLegacyText(text, date);
    expect(migrateLegacyText(once, "2026-11-01")).toBe(once);
    expect(once.split("\n").length).toBe(text.split("\n").length);
    const doc = parse(once);
    const all = [...items(doc)];
    expect(all.length).toBeGreaterThan(5);
    expect(all.filter((e) => e.item.events.some((ev) => ev.explicit)).length).toBeGreaterThan(0);
  });
});
