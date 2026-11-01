// Converts the Task status section of a daily note into a HotTasks tasks.md.
//
//   node scripts/migrate.ts <notes folder> <tasks folder> [--write] [--date YYYY-MM-DD]
//   node scripts/migrate.ts <notes folder> --check-all
//
// Without --write the result is printed. --check-all runs the conversion over every
// daily note that has a Task status section and reports which ones fail.
// Build core first: npm run build -w @hottasks/core

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { migrateLegacyText, parse, serialize, items, ensureIds } from "@hottasks/core";

const NOTE = /^(\d{4}-\d{2}-\d{2})\.md$/;

function taskSection(text: string): string | undefined {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^## Task status\s*$/.test(l));
  if (start < 0) return undefined;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i]!)) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n").replace(/\n+$/, "") + "\n";
}

function convert(section: string, date: string): string {
  const text = migrateLegacyText(section, date);
  const doc = parse(text, { today: date });
  ensureIds(doc);
  return serialize(doc);
}

function latestNote(folder: string, wanted?: string): { date: string; path: string } {
  const dates = readdirSync(folder)
    .map((f) => NOTE.exec(f)?.[1])
    .filter((d): d is string => d !== undefined)
    .sort();
  const date = wanted ?? dates[dates.length - 1];
  if (!date) throw new Error(`No daily notes in ${folder}`);
  return { date, path: join(folder, `${date}.md`) };
}

function main(argv: string[]): number {
  const notes = argv[0];
  if (!notes) {
    console.error("usage: migrate.ts <notes folder> <tasks folder> [--write] [--date YYYY-MM-DD] | <notes folder> --check-all");
    return 2;
  }
  if (argv.includes("--check-all")) {
    let failed = 0;
    for (const f of readdirSync(notes).filter((f) => NOTE.test(f)).sort()) {
      const date = NOTE.exec(f)![1]!;
      const section = taskSection(readFileSync(join(notes, f), "utf8"));
      if (!section) continue;
      try {
        const out = convert(section, date);
        const again = serialize(parse(out, { today: date }));
        const count = [...items(parse(out))].length;
        const stable = again === out;
        if (!stable) failed++;
        console.log(`${f}: ${count} items${stable ? "" : "  NOT STABLE"}`);
      } catch (err) {
        failed++;
        console.log(`${f}: ERROR ${(err as Error).message}`);
      }
    }
    return failed === 0 ? 0 : 1;
  }
  const tasks = argv[1];
  if (!tasks) {
    console.error("missing <tasks folder>");
    return 2;
  }
  const dateIdx = argv.indexOf("--date");
  const wanted = dateIdx >= 0 ? argv[dateIdx + 1] : undefined;
  const { date, path } = latestNote(notes, wanted);
  const section = taskSection(readFileSync(path, "utf8"));
  if (!section) {
    console.error(`${path} has no Task status section`);
    return 1;
  }
  const out = convert(section, date);
  if (!argv.includes("--write")) {
    process.stdout.write(out);
    return 0;
  }
  const target = join(tasks, "tasks.md");
  if (existsSync(target)) {
    console.error(`${target} already exists, refusing to overwrite`);
    return 1;
  }
  mkdirSync(tasks, { recursive: true });
  writeFileSync(target, out, "utf8");
  console.log(`wrote ${target} from ${path}`);
  return 0;
}

process.exit(main(process.argv.slice(2)));
