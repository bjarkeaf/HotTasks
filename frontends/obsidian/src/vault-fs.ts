import type { DataAdapter } from "obsidian";
import type { FileSystem } from "@hottasks/core";

export function vaultFileSystem(adapter: DataAdapter): FileSystem {
  const mkdir = async (path: string): Promise<void> => {
    let current = "";
    for (const part of path.split("/").filter((p) => p !== "")) {
      current = current === "" ? part : `${current}/${part}`;
      if (!(await adapter.exists(current))) await adapter.mkdir(current);
    }
  };

  return {
    async read(path) {
      return (await adapter.exists(path)) ? adapter.read(path) : undefined;
    },
    async write(path, text) {
      const slash = path.lastIndexOf("/");
      if (slash > 0) await mkdir(path.slice(0, slash));
      await adapter.write(path, text);
    },
    exists: (path) => adapter.exists(path),
    mkdir,
    async mtime(path) {
      return (await adapter.stat(path))?.mtime;
    }
  };
}
