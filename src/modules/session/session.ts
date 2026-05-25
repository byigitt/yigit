import { LazyStore } from "@tauri-apps/plugin-store";
import { allPaneIds, type PaneNode } from "@/modules/terminal/lib/panes";
import type {
  EditorTab,
  ImageTab,
  MarkdownTab,
  PreviewTab,
  Tab,
  TerminalTab,
} from "@/modules/tabs";

// Bump when the tab shape changes in a way that would mis-deserialize older
// session files; old files are then ignored instead of restored as garbage.
const SESSION_VERSION = 1;

const STORE_PATH = "terax-session.json";
const KEY_VERSION = "version";
const KEY_TABS = "tabs";
const KEY_ACTIVE_ID = "activeId";

const store = new LazyStore(STORE_PATH, { defaults: {}, autoSave: false });

export type SessionTab =
  | TerminalTab
  | EditorTab
  | PreviewTab
  | MarkdownTab
  | ImageTab;

export type SessionState = {
  tabs: SessionTab[];
  activeId: number;
};

function isPaneNode(v: unknown): v is PaneNode {
  if (!v || typeof v !== "object") return false;
  const n = v as { kind?: unknown; id?: unknown };
  if (typeof n.id !== "number") return false;
  if (n.kind === "leaf") {
    const cwd = (v as { cwd?: unknown }).cwd;
    return cwd === undefined || typeof cwd === "string";
  }
  if (n.kind === "split") {
    const dir = (v as { dir?: unknown }).dir;
    const children = (v as { children?: unknown }).children;
    if (dir !== "row" && dir !== "col") return false;
    if (!Array.isArray(children) || children.length === 0) return false;
    return children.every(isPaneNode);
  }
  return false;
}

function leafIdsOf(n: PaneNode): number[] {
  if (n.kind === "leaf") return [n.id];
  return n.children.flatMap(leafIdsOf);
}

/**
 * Whitelist of restorable tab kinds with strict shape validation. Anything
 * else (private terminals, AI diffs, git diffs, dirty editor buffers) is
 * intentionally dropped so we never resurrect transient state.
 */
export function projectTab(t: unknown): SessionTab | null {
  if (!t || typeof t !== "object") return null;
  const tab = t as { kind?: unknown; id?: unknown; title?: unknown };
  if (typeof tab.id !== "number" || typeof tab.title !== "string") return null;
  switch (tab.kind) {
    case "terminal": {
      const tt = tab as Partial<TerminalTab>;
      if (tt.private) return null;
      if (!isPaneNode(tt.paneTree)) return null;
      const leaves = leafIdsOf(tt.paneTree);
      const activeLeafId =
        typeof tt.activeLeafId === "number" && leaves.includes(tt.activeLeafId)
          ? tt.activeLeafId
          : leaves[0];
      const restored: TerminalTab = {
        id: tt.id as number,
        kind: "terminal",
        title: tt.title as string,
        paneTree: tt.paneTree,
        activeLeafId,
      };
      if (typeof tt.customTitle === "string") restored.customTitle = tt.customTitle;
      if (typeof tt.cwd === "string") restored.cwd = tt.cwd;
      return restored;
    }
    case "editor": {
      const et = tab as Partial<EditorTab>;
      if (typeof et.path !== "string") return null;
      const restored: EditorTab = {
        id: et.id as number,
        kind: "editor",
        title: et.title as string,
        path: et.path,
        dirty: false,
        preview: false,
      };
      if (typeof et.customTitle === "string") restored.customTitle = et.customTitle;
      return restored;
    }
    case "preview": {
      const pt = tab as Partial<PreviewTab>;
      if (typeof pt.url !== "string") return null;
      const restored: PreviewTab = {
        id: pt.id as number,
        kind: "preview",
        title: pt.title as string,
        url: pt.url,
      };
      if (typeof pt.customTitle === "string") restored.customTitle = pt.customTitle;
      return restored;
    }
    case "markdown": {
      const mt = tab as Partial<MarkdownTab>;
      if (typeof mt.path !== "string") return null;
      const restored: MarkdownTab = {
        id: mt.id as number,
        kind: "markdown",
        title: mt.title as string,
        path: mt.path,
      };
      if (typeof mt.customTitle === "string") restored.customTitle = mt.customTitle;
      return restored;
    }
    case "image": {
      const it = tab as Partial<ImageTab>;
      if (typeof it.path !== "string") return null;
      const restored: ImageTab = {
        id: it.id as number,
        kind: "image",
        title: it.title as string,
        path: it.path,
      };
      if (typeof it.customTitle === "string") restored.customTitle = it.customTitle;
      return restored;
    }
    default:
      return null;
  }
}

export async function loadSession(): Promise<SessionState | null> {
  try {
    const version = await store.get<number>(KEY_VERSION);
    if (version !== SESSION_VERSION) return null;
    const tabsRaw = await store.get<unknown[]>(KEY_TABS);
    const activeIdRaw = await store.get<number>(KEY_ACTIVE_ID);
    if (!Array.isArray(tabsRaw) || tabsRaw.length === 0) return null;
    const tabs: SessionTab[] = [];
    for (const raw of tabsRaw) {
      const t = projectTab(raw);
      if (t) tabs.push(t);
    }
    if (tabs.length === 0) return null;
    const activeId =
      typeof activeIdRaw === "number" && tabs.some((t) => t.id === activeIdRaw)
        ? activeIdRaw
        : tabs[0].id;
    return { tabs, activeId };
  } catch {
    return null;
  }
}

export async function saveSession(state: {
  tabs: Tab[];
  activeId: number;
}): Promise<void> {
  const tabs: SessionTab[] = [];
  for (const t of state.tabs) {
    const projected = projectTab(t);
    if (projected) tabs.push(projected);
  }
  const activeId = tabs.some((t) => t.id === state.activeId)
    ? state.activeId
    : (tabs[0]?.id ?? state.activeId);
  await store.set(KEY_VERSION, SESSION_VERSION);
  await store.set(KEY_TABS, tabs);
  await store.set(KEY_ACTIVE_ID, activeId);
  await store.save();
}

export async function clearSession(): Promise<void> {
  try {
    await store.clear();
    await store.save();
  } catch {
    // session file may not exist yet
  }
}

/**
 * Highest id mentioned in a restored session (tab ids + every leaf/split id
 * inside terminal pane trees). Callers seed their id counter at +1 so freshly
 * created tabs/panes never collide with restored ones.
 */
export function maxRestoredId(state: SessionState): number {
  let max = 0;
  for (const t of state.tabs) {
    if (t.id > max) max = t.id;
    if (t.kind === "terminal") {
      for (const id of allPaneIds(t.paneTree)) {
        if (id > max) max = id;
      }
    }
  }
  return max;
}

// Pre-mount cache: main.tsx awaits `preloadInitialSession` before React renders
// so `useTabs` can seed from disk in a single setState, avoiding a flash of
// the default terminal tab.
let cachedInitial: SessionState | null = null;

export async function preloadInitialSession(enabled: boolean): Promise<void> {
  cachedInitial = enabled ? await loadSession() : null;
}

export function takeInitialSession(): SessionState | null {
  const s = cachedInitial;
  cachedInitial = null;
  return s;
}
