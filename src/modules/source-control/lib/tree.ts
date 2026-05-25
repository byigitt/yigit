import type {
  CheckState,
  SourceControlFileEntry,
} from "../useSourceControlPanel";

export type TreeFolderNode = {
  kind: "folder";
  /** Slash-joined path relative to the repo root (no trailing slash). */
  path: string;
  /** Display name. After compaction this may join several segments ("a/b/c"). */
  displayName: string;
  children: TreeNode[];
};

export type TreeFileNode = {
  kind: "file";
  entry: SourceControlFileEntry;
};

export type TreeNode = TreeFolderNode | TreeFileNode;

/** A node together with the depth at which it should render. */
export type FlatTreeNode =
  | { kind: "folder"; depth: number; folder: TreeFolderNode }
  | { kind: "file"; depth: number; entry: SourceControlFileEntry };

/**
 * Group file entries into a directory tree. The input order determines the
 * order of children within each folder — callers should pre-sort entries (the
 * source-control hook already sorts paths case-insensitively).
 */
export function buildTree(entries: SourceControlFileEntry[]): TreeNode[] {
  const root: TreeFolderNode = {
    kind: "folder",
    path: "",
    displayName: "",
    children: [],
  };
  for (const entry of entries) {
    const parts = entry.path.split("/").filter(Boolean);
    let parent = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const segment = parts[i];
      const segPath = parent.path ? `${parent.path}/${segment}` : segment;
      let folder = parent.children.find(
        (c): c is TreeFolderNode =>
          c.kind === "folder" && c.displayName === segment,
      );
      if (!folder) {
        folder = {
          kind: "folder",
          path: segPath,
          displayName: segment,
          children: [],
        };
        parent.children.push(folder);
      }
      parent = folder;
    }
    parent.children.push({ kind: "file", entry });
  }
  sortTree(root);
  return root.children;
}

function sortTree(folder: TreeFolderNode): void {
  folder.children.sort((a, b) => {
    // Folders before files at the same level, then case-insensitive name.
    if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
    const an = nodeName(a).toLowerCase();
    const bn = nodeName(b).toLowerCase();
    return an < bn ? -1 : an > bn ? 1 : 0;
  });
  for (const c of folder.children) {
    if (c.kind === "folder") sortTree(c);
  }
}

const nodeName = (n: TreeNode): string =>
  n.kind === "folder" ? n.displayName : leafName(n.entry.path);

const leafName = (p: string): string => {
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(i + 1) : p;
};

/**
 * Collapse chains of single-child folders into one row ("a/b/c"), matching
 * VS Code's "compact folders" default. A folder with a single child that is
 * also a folder is merged with that child.
 */
export function compactFolders(nodes: TreeNode[]): TreeNode[] {
  return nodes.map(compactNode);
}

function compactNode(node: TreeNode): TreeNode {
  if (node.kind === "file") return node;
  let merged = node;
  while (
    merged.children.length === 1 &&
    merged.children[0].kind === "folder"
  ) {
    const child = merged.children[0] as TreeFolderNode;
    merged = {
      kind: "folder",
      path: child.path,
      displayName: `${merged.displayName}/${child.displayName}`,
      children: child.children,
    };
  }
  return {
    ...merged,
    children: compactFolders(merged.children),
  };
}

/**
 * Walk the tree depth-first, emitting visible rows. Folders in `collapsed`
 * suppress their descendants. The repo root sits at depth 0; folder/file
 * children are at depth 1, etc.
 */
export function flattenTree(
  nodes: TreeNode[],
  collapsed: Set<string>,
): FlatTreeNode[] {
  const out: FlatTreeNode[] = [];
  walk(nodes, collapsed, 0, out);
  return out;
}

function walk(
  nodes: TreeNode[],
  collapsed: Set<string>,
  depth: number,
  out: FlatTreeNode[],
): void {
  for (const node of nodes) {
    if (node.kind === "folder") {
      out.push({ kind: "folder", depth, folder: node });
      if (!collapsed.has(node.path)) {
        walk(node.children, collapsed, depth + 1, out);
      }
    } else {
      out.push({ kind: "file", depth, entry: node.entry });
    }
  }
}

/** Collect every file entry under a folder, depth-first. */
export function collectFileEntries(
  folder: TreeFolderNode,
  out: SourceControlFileEntry[] = [],
): SourceControlFileEntry[] {
  for (const c of folder.children) {
    if (c.kind === "folder") collectFileEntries(c, out);
    else out.push(c.entry);
  }
  return out;
}

/**
 * Derive the aggregate check state for a folder from its descendants:
 * - `checked` — every descendant file is staged.
 * - `unchecked` — every descendant file is fully unstaged.
 * - `indeterminate` — any descendant is partially staged, or files mix
 *   staged/unstaged.
 */
export function folderCheckState(folder: TreeFolderNode): CheckState {
  let seenChecked = false;
  let seenUnchecked = false;
  const stack: TreeNode[] = [...folder.children];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (node.kind === "folder") {
      for (const c of node.children) stack.push(c);
      continue;
    }
    if (node.entry.checkState === "indeterminate") return "indeterminate";
    if (node.entry.checkState === "checked") seenChecked = true;
    else seenUnchecked = true;
    if (seenChecked && seenUnchecked) return "indeterminate";
  }
  if (seenChecked && !seenUnchecked) return "checked";
  return "unchecked";
}
