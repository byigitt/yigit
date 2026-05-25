import { describe, expect, it } from "vitest";
import type {
  CheckState,
  SourceControlFileEntry,
} from "../useSourceControlPanel";
import {
  buildTree,
  collectFileEntries,
  compactFolders,
  flattenTree,
  folderCheckState,
  type TreeFolderNode,
  type TreeNode,
} from "./tree";

const entry = (
  path: string,
  checkState: CheckState = "unchecked",
): SourceControlFileEntry => ({
  key: `f:${path}`,
  path,
  originalPath: null,
  statusCode: "M",
  statusLabel: "Modified",
  checkState,
  staged: checkState === "checked",
  unstaged: checkState !== "checked",
  untracked: false,
});

const findFolder = (
  nodes: TreeNode[],
  name: string,
): TreeFolderNode | undefined =>
  nodes.find(
    (n): n is TreeFolderNode =>
      n.kind === "folder" && n.displayName === name,
  );

describe("buildTree", () => {
  it("places top-level files alongside folders, folders sorted first", () => {
    const tree = buildTree([entry("README.md"), entry("src/foo.ts")]);
    expect(tree).toHaveLength(2);
    expect(tree[0].kind).toBe("folder");
    expect((tree[0] as TreeFolderNode).displayName).toBe("src");
    expect(tree[1].kind).toBe("file");
  });

  it("groups files by directory at every depth", () => {
    const tree = buildTree([
      entry("src/a.ts"),
      entry("src/b.ts"),
      entry("src/nested/c.ts"),
    ]);
    const src = findFolder(tree, "src");
    expect(src).toBeDefined();
    expect(src!.children).toHaveLength(3);
    const nested = findFolder(src!.children, "nested");
    expect(nested?.children).toHaveLength(1);
  });

  it("sorts case-insensitively with folders first", () => {
    const tree = buildTree([
      entry("Zfile.ts"),
      entry("apple.ts"),
      entry("b/inner.ts"),
    ]);
    expect(tree.map((n) => (n.kind === "folder" ? n.displayName : n.entry.path))).toEqual([
      "b",
      "apple.ts",
      "Zfile.ts",
    ]);
  });
});

describe("compactFolders", () => {
  it("collapses single-child folder chains into a/b/c", () => {
    const tree = buildTree([entry("src/modules/tabs/TabBar.tsx")]);
    const compact = compactFolders(tree);
    expect(compact).toHaveLength(1);
    const top = compact[0] as TreeFolderNode;
    expect(top.kind).toBe("folder");
    expect(top.displayName).toBe("src/modules/tabs");
    expect(top.children).toHaveLength(1);
    expect(top.children[0].kind).toBe("file");
  });

  it("does not collapse when a folder has multiple children", () => {
    const tree = buildTree([
      entry("src/foo.ts"),
      entry("src/bar.ts"),
    ]);
    const compact = compactFolders(tree);
    const src = compact[0] as TreeFolderNode;
    expect(src.displayName).toBe("src");
    expect(src.children).toHaveLength(2);
  });

  it("recursively compacts nested chains", () => {
    const tree = buildTree([
      entry("a/b/c/d.ts"),
      entry("a/b/c/e.ts"),
    ]);
    const compact = compactFolders(tree);
    const top = compact[0] as TreeFolderNode;
    expect(top.displayName).toBe("a/b/c");
    expect(top.children).toHaveLength(2);
  });
});

describe("flattenTree", () => {
  it("expands all folders by default", () => {
    const tree = buildTree([entry("src/a.ts"), entry("src/b.ts")]);
    const flat = flattenTree(tree, new Set());
    expect(flat).toHaveLength(3);
    expect(flat[0]).toMatchObject({ kind: "folder", depth: 0 });
    expect(flat[1]).toMatchObject({ kind: "file", depth: 1 });
    expect(flat[2]).toMatchObject({ kind: "file", depth: 1 });
  });

  it("hides descendants of a collapsed folder", () => {
    const tree = buildTree([entry("src/a.ts"), entry("src/b.ts")]);
    const flat = flattenTree(tree, new Set(["src"]));
    expect(flat).toHaveLength(1);
    expect(flat[0]).toMatchObject({ kind: "folder", depth: 0 });
  });
});

describe("folderCheckState", () => {
  it("returns unchecked when every descendant is unstaged", () => {
    const tree = buildTree([entry("a/b.ts"), entry("a/c.ts")]);
    expect(folderCheckState(tree[0] as TreeFolderNode)).toBe("unchecked");
  });

  it("returns checked when every descendant is staged", () => {
    const tree = buildTree([
      entry("a/b.ts", "checked"),
      entry("a/c.ts", "checked"),
    ]);
    expect(folderCheckState(tree[0] as TreeFolderNode)).toBe("checked");
  });

  it("returns indeterminate on a mix of states", () => {
    const tree = buildTree([
      entry("a/b.ts", "checked"),
      entry("a/c.ts", "unchecked"),
    ]);
    expect(folderCheckState(tree[0] as TreeFolderNode)).toBe("indeterminate");
  });

  it("returns indeterminate when any descendant is indeterminate", () => {
    const tree = buildTree([
      entry("a/b.ts", "checked"),
      entry("a/c.ts", "indeterminate"),
    ]);
    expect(folderCheckState(tree[0] as TreeFolderNode)).toBe("indeterminate");
  });
});

describe("collectFileEntries", () => {
  it("collects every descendant file", () => {
    const tree = buildTree([
      entry("a/b.ts"),
      entry("a/c/d.ts"),
      entry("a/c/e.ts"),
    ]);
    const files = collectFileEntries(tree[0] as TreeFolderNode);
    // Folders sort before files, so subtree under `a/c` is emitted before `a/b.ts`.
    expect(files.map((f) => f.path)).toEqual([
      "a/c/d.ts",
      "a/c/e.ts",
      "a/b.ts",
    ]);
  });
});
