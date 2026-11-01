import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = process.env.HOTTASKS_VAULT_PLUGIN_DIR;
if (!target) throw new Error("Set HOTTASKS_VAULT_PLUGIN_DIR to <your vault>/.obsidian/plugins/hottasks");

const files = [join("dist", "main.js"), "manifest.json", "styles.css"];
for (const f of files) {
  if (!existsSync(join(root, f))) throw new Error(`Missing ${f}, run the build first`);
}

mkdirSync(target, { recursive: true });
for (const f of files) copyFileSync(join(root, f), join(target, f.replace(/^dist[\\/]/, "")));

const listPath = join(dirname(target), "..", "community-plugins.json");
let enabled = [];
if (existsSync(listPath)) enabled = JSON.parse(readFileSync(listPath, "utf8"));
if (!enabled.includes("hottasks")) {
  enabled.push("hottasks");
  writeFileSync(listPath, JSON.stringify(enabled, null, 2));
}
console.log(`Installed to ${target}`);
