import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import type { FileSystem } from "./store.js";

/** FileSystem backed by node:fs, for scripts, tests and frontends running in Node or Electron. */
export const nodeFileSystem: FileSystem = {
  async read(path) {
    try {
      return await readFile(path, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw err;
    }
  },
  async write(path, text) {
    await writeFile(path, text, "utf8");
  },
  async exists(path) {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  },
  async mkdir(path) {
    await mkdir(path, { recursive: true });
  },
  async mtime(path) {
    try {
      return (await stat(path)).mtimeMs;
    } catch {
      return undefined;
    }
  }
};
