import { describe, expect, it, vi } from "vitest";
import { type DriveChildEntry, walkFolderTree } from "./driveClient.js";

const FOLDER = "application/vnd.google-apps.folder";
const DOC = "application/vnd.google-apps.document";
const T = "2026-01-01T00:00:00.000Z";

function folder(id: string, name = id): DriveChildEntry {
  return { id, name, mimeType: FOLDER, modifiedTime: T };
}

function doc(id: string, name = id): DriveChildEntry {
  return { id, name, mimeType: DOC, modifiedTime: T };
}

function fakeTree(tree: Record<string, DriveChildEntry[]>) {
  return vi.fn(async (folderId: string) => tree[folderId] ?? []);
}

describe("walkFolderTree", () => {
  it("returns top-level files with their name as the path", async () => {
    const files = await walkFolderTree("root", fakeTree({ root: [doc("a", "a.pdf")] }));

    expect(files).toEqual([{ ...doc("a", "a.pdf"), path: "a.pdf" }]);
  });

  it("flattens files from nested subfolders into one list, recording their path", async () => {
    const listChildren = fakeTree({
      root: [doc("a", "a.pdf"), folder("f1", "Reports")],
      f1: [doc("b", "b.pdf"), folder("f2", "2026")],
      f2: [doc("c", "c.pdf")],
    });

    const files = await walkFolderTree("root", listChildren);

    expect(files.map((f) => [f.id, f.path])).toEqual([
      ["a", "a.pdf"],
      ["b", "Reports/b.pdf"],
      ["c", "Reports/2026/c.pdf"],
    ]);
    // Folders are traversed, never returned as sync candidates.
    expect(files.some((f) => f.mimeType === FOLDER)).toBe(false);
    expect(listChildren.mock.calls.map(([id]) => id)).toEqual(["root", "f1", "f2"]);
  });

  it("visits each folder once even when it's reachable by more than one route (or loops back)", async () => {
    const listChildren = fakeTree({
      root: [folder("x"), folder("y")],
      x: [folder("shared"), folder("root")],
      y: [folder("shared")],
      shared: [doc("d")],
    });

    const files = await walkFolderTree("root", listChildren);

    expect(files.map((f) => f.id)).toEqual(["d"]);
    expect(listChildren.mock.calls.map(([id]) => id).sort()).toEqual(["root", "shared", "x", "y"]);
  });

  it("lists a file once when it appears under two folders (first path wins)", async () => {
    const files = await walkFolderTree(
      "root",
      fakeTree({ root: [doc("dup", "dup.txt"), folder("f", "Sub")], f: [doc("dup", "dup.txt")] }),
    );

    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe("dup.txt");
  });

  it("returns an empty list for an empty tree", async () => {
    expect(await walkFolderTree("root", fakeTree({ root: [folder("empty")] }))).toEqual([]);
  });

  it("propagates a listing failure instead of returning a partial tree", async () => {
    const listChildren = vi.fn(async (id: string) => {
      if (id === "f") throw new Error("drive down");
      return [folder("f")];
    });

    await expect(walkFolderTree("root", listChildren)).rejects.toThrow("drive down");
  });
});
