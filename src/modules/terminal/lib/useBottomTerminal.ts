import { useCallback, useRef, useState } from "react";
import {
  findLeafCwd,
  hasLeaf,
  leafIds,
  nextLeafId as nextLeafIdInTree,
  removeLeaf,
  setLeafCwd as setLeafCwdInTree,
  siblingLeafOf,
  splitLeaf,
  type PaneNode,
  type SplitDir,
} from "./panes";
import { disposeSession } from "./useTerminalSession";

// Leaf ids for the bottom panel live in a separate, high range so they cannot
// collide with `useTabs` ids. The terminal session map (and renderer pool) is
// global, so unique ids across all panes are required.
const ID_BASE = 10_000_000;

const MAX_BOTTOM_PANES = 4;

export type BottomTerminalState = {
  paneTree: PaneNode;
  activeLeafId: number;
};

export function useBottomTerminal() {
  const [state, setState] = useState<BottomTerminalState | null>(null);
  const nextIdRef = useRef(ID_BASE + 1);

  /** Create the initial terminal if there isn't one yet. */
  const ensureInitial = useCallback((cwd?: string) => {
    setState((curr) => {
      if (curr) return curr;
      const leafId = nextIdRef.current++;
      return {
        paneTree: { kind: "leaf", id: leafId, cwd },
        activeLeafId: leafId,
      };
    });
  }, []);

  /** Split the active pane along `dir`. Returns the new leaf id, or null. */
  const splitActive = useCallback((dir: SplitDir): number | null => {
    let newLeafId: number | null = null;
    setState((curr) => {
      if (!curr) return curr;
      if (leafIds(curr.paneTree).length >= MAX_BOTTOM_PANES) return curr;
      const splitId = nextIdRef.current++;
      const leafId = nextIdRef.current++;
      newLeafId = leafId;
      const cwd = findLeafCwd(curr.paneTree, curr.activeLeafId);
      const paneTree = splitLeaf(
        curr.paneTree,
        curr.activeLeafId,
        splitId,
        leafId,
        dir,
        cwd,
      );
      return { paneTree, activeLeafId: leafId };
    });
    return newLeafId;
  }, []);

  const focusLeaf = useCallback((leafId: number) => {
    setState((curr) => {
      if (!curr || !hasLeaf(curr.paneTree, leafId)) return curr;
      if (curr.activeLeafId === leafId) return curr;
      return { ...curr, activeLeafId: leafId };
    });
  }, []);

  const focusNext = useCallback((delta: 1 | -1) => {
    setState((curr) => {
      if (!curr) return curr;
      const next = nextLeafIdInTree(curr.paneTree, curr.activeLeafId, delta);
      if (next === curr.activeLeafId) return curr;
      return { ...curr, activeLeafId: next };
    });
  }, []);

  /**
   * Close the focused pane. The owning PTY session is disposed. Returns `true`
   * when the panel is now empty (caller should hide the panel).
   */
  const closeActive = useCallback((): boolean => {
    let emptied = false;
    let removed: number | null = null;
    setState((curr) => {
      if (!curr) return curr;
      const target = curr.activeLeafId;
      const newTree = removeLeaf(curr.paneTree, target);
      removed = target;
      if (!newTree) {
        emptied = true;
        return null;
      }
      const remaining = leafIds(newTree);
      const sib = siblingLeafOf(curr.paneTree, target);
      const newActive =
        sib && remaining.includes(sib) ? sib : remaining[0];
      return { paneTree: newTree, activeLeafId: newActive };
    });
    if (removed !== null) disposeSession(removed);
    return emptied;
  }, []);

  /** Dispose every pane and reset the panel. */
  const reset = useCallback(() => {
    let toDispose: number[] = [];
    setState((curr) => {
      if (!curr) return curr;
      toDispose = leafIds(curr.paneTree);
      return null;
    });
    for (const id of toDispose) disposeSession(id);
  }, []);

  /** Mirror cwd updates from the PTY into the pane tree. */
  const setLeafCwd = useCallback((leafId: number, cwd: string) => {
    setState((curr) => {
      if (!curr || !hasLeaf(curr.paneTree, leafId)) return curr;
      const next = setLeafCwdInTree(curr.paneTree, leafId, cwd);
      return next === curr.paneTree ? curr : { ...curr, paneTree: next };
    });
  }, []);

  return {
    state,
    ensureInitial,
    splitActive,
    focusLeaf,
    focusNext,
    closeActive,
    reset,
    setLeafCwd,
    /** Per-tab cap, mirrored from `useTabs`. */
    maxPanes: MAX_BOTTOM_PANES,
  };
}
