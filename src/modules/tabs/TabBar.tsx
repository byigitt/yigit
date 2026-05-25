import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fmtShortcut, MOD_KEY } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { fileIconUrl } from "@/modules/explorer/lib/iconResolver";
import {
  Cancel01Icon,
  Clock01Icon,
  ComputerTerminal02Icon,
  GitBranchIcon,
  GitCompareIcon,
  Globe02Icon,
  IncognitoIcon,
  PencilEdit02Icon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { EditorTab, Tab } from "./lib/useTabs";

type Props = {
  tabs: Tab[];
  activeId: number;
  onSelect: (id: number) => void;
  onNew: () => void;
  onNewPrivate: () => void;
  onNewPreview: () => void;
  onNewEditor: () => void;
  onNewGitGraph: () => void;
  onClose: (id: number) => void;
  /** Pin (promote) a preview tab to persistent on double-click. */
  onPin: (id: number) => void;
  /** Move `sourceId` to land before/after `targetId` in the bar. */
  onReorder: (
    sourceId: number,
    targetId: number,
    position: "before" | "after",
  ) => void;
  /**
   * Merge a dragged terminal tab into another terminal tab's pane tree as a
   * new split next to `targetLeafId`. `position` picks the side relative to
   * the target along `dir` (row=horizontal, col=vertical).
   */
  onDropOntoPane: (
    sourceTabId: number,
    targetTabId: number,
    targetLeafId: number,
    dir: "row" | "col",
    position: "before" | "after",
  ) => void;
  /** Set a user-defined display label for the tab. `null` clears it. */
  onRename: (id: number, title: string | null) => void;
  compact?: boolean;
};

type DropPosition = "before" | "after";

type PaneDropSide = "left" | "right" | "top" | "bottom";

type DragState = {
  sourceId: number;
  startX: number;
  startY: number;
  pointerId: number;
  started: boolean;
};

type PaneDropTarget = {
  tabId: number;
  leafId: number;
  side: PaneDropSide;
  // Cached viewport rect of the pane for overlay positioning. Re-read each
  // pointermove so the indicator follows window resizes.
  rect: { left: number; top: number; width: number; height: number };
};

const SIDE_TO_SPLIT: Record<
  PaneDropSide,
  { dir: "row" | "col"; position: "before" | "after" }
> = {
  left: { dir: "row", position: "before" },
  right: { dir: "row", position: "after" },
  top: { dir: "col", position: "before" },
  bottom: { dir: "col", position: "after" },
};

// Movement (in px) before pointerdown promotes to a drag rather than a click.
const DRAG_THRESHOLD_PX = 4;

export function TabBar({
  tabs,
  activeId,
  onSelect,
  onNew,
  onNewPrivate,
  onNewPreview,
  onNewEditor,
  onNewGitGraph,
  onClose,
  onPin,
  onReorder,
  onDropOntoPane,
  onRename,
  compact,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Horizontal wheel scroll without holding shift.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      if (el.scrollWidth <= el.clientWidth) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Keep the active tab visible after selection / open.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const active = el.querySelector<HTMLElement>(`[data-tab-id="${activeId}"]`);
    active?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId, tabs.length]);

  // --- pointer-driven drag-reorder ---
  // HTML5 native drag (`draggable={true}`) is unreliable inside Tauri's
  // WKWebView: dragstart often fails to fire on nested elements, and Tauri's
  // OS-level drag handlers can swallow the operation. Pointer events with
  // setPointerCapture are predictable across every platform.
  const dragStateRef = useRef<DragState | null>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    id: number;
    pos: DropPosition;
  } | null>(null);
  // Set immediately after a drag completes so the click event that follows
  // pointerup can be suppressed — otherwise the source tab activates on drop.
  const justDraggedRef = useRef(false);
  const [paneDropTarget, setPaneDropTarget] = useState<PaneDropTarget | null>(
    null,
  );

  const hitTestTab = useCallback(
    (clientX: number, clientY: number) => {
      const scrollEl = scrollRef.current;
      if (!scrollEl) return null;
      const wrappers = scrollEl.querySelectorAll<HTMLElement>("[data-tab-id]");
      if (wrappers.length === 0) return null;
      // Snap to nearest: pick the tab whose vertical band contains clientY and
      // whose horizontal range is closest to clientX. This makes drops onto
      // the tab-bar padding (before the first tab / after the last) and into
      // the inter-tab gap land on the nearest tab.
      let best: HTMLElement | null = null;
      let bestDist = Number.POSITIVE_INFINITY;
      for (const el of wrappers) {
        const rect = el.getBoundingClientRect();
        if (clientY < rect.top || clientY > rect.bottom) continue;
        const dist =
          clientX < rect.left
            ? rect.left - clientX
            : clientX > rect.right
              ? clientX - rect.right
              : 0;
        if (dist < bestDist) {
          bestDist = dist;
          best = el;
          if (dist === 0) break;
        }
      }
      if (!best) return null;
      const raw = best.dataset.tabId;
      const id = raw ? Number.parseInt(raw, 10) : Number.NaN;
      if (Number.isNaN(id)) return null;
      return { id, rect: best.getBoundingClientRect() };
    },
    [],
  );

  // Track which tab ids are terminals — only those can be dropped onto a
  // pane (otherwise the merge has no terminal session to graft).
  const terminalTabIds = useMemo(() => {
    const set = new Set<number>();
    for (const t of tabs) if (t.kind === "terminal") set.add(t.id);
    return set;
  }, [tabs]);

  /**
   * Hit-test against terminal pane elements anywhere on screen. Returns null
   * when the cursor isn't over a recognizable pane.
   */
  const hitTestPane = useCallback(
    (clientX: number, clientY: number): PaneDropTarget | null => {
      const el = document.elementFromPoint(clientX, clientY);
      if (!el) return null;
      const paneEl = el.closest<HTMLElement>("[data-pane-leaf]");
      if (!paneEl) return null;
      const tabRaw = paneEl.dataset.paneTab;
      const leafRaw = paneEl.dataset.paneLeaf;
      const tabId = tabRaw ? Number.parseInt(tabRaw, 10) : Number.NaN;
      const leafId = leafRaw ? Number.parseInt(leafRaw, 10) : Number.NaN;
      if (Number.isNaN(tabId) || Number.isNaN(leafId)) return null;
      const rect = paneEl.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      // Diagonals carve the pane into four triangles (top/right/bottom/left)
      // meeting at the center — the classic VS Code drop affordance.
      const nx = (clientX - rect.left) / rect.width;
      const ny = (clientY - rect.top) / rect.height;
      const side: PaneDropSide =
        ny < nx
          ? ny < 1 - nx
            ? "top"
            : "right"
          : ny < 1 - nx
            ? "left"
            : "bottom";
      return {
        tabId,
        leafId,
        side,
        rect: {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        },
      };
    },
    [],
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>, id: number) => {
      // Mouse: primary button only. Touch/pen: always allow.
      if (e.pointerType === "mouse" && e.button !== 0) return;
      dragStateRef.current = {
        sourceId: id,
        startX: e.clientX,
        startY: e.clientY,
        pointerId: e.pointerId,
        started: false,
      };
    },
    [],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const state = dragStateRef.current;
      if (!state || state.pointerId !== e.pointerId) return;
      if (!state.started) {
        const dx = e.clientX - state.startX;
        const dy = e.clientY - state.startY;
        if (
          Math.abs(dx) < DRAG_THRESHOLD_PX &&
          Math.abs(dy) < DRAG_THRESHOLD_PX
        ) {
          return;
        }
        state.started = true;
        // Capture so pointermove keeps firing on this element even when the
        // cursor crosses sibling tabs (needed for accurate hit-testing).
        e.currentTarget.setPointerCapture(e.pointerId);
        setDraggingId(state.sourceId);
      }
      const tabHit = hitTestTab(e.clientX, e.clientY);
      if (tabHit && tabHit.id !== state.sourceId) {
        const pos: DropPosition =
          e.clientX < tabHit.rect.left + tabHit.rect.width / 2
            ? "before"
            : "after";
        setDropTarget((curr) =>
          curr && curr.id === tabHit.id && curr.pos === pos
            ? curr
            : { id: tabHit.id, pos },
        );
        // Tab-bar hit wins over pane hit while the cursor is in the bar.
        setPaneDropTarget((curr) => (curr === null ? curr : null));
        return;
      }
      setDropTarget((curr) => (curr === null ? curr : null));
      // Pane drop is only allowed when the source tab itself is a terminal.
      // We don't merge editor/preview/diff tabs into terminal pane trees.
      const isTerminalSource = terminalTabIds.has(state.sourceId);
      const paneHit =
        isTerminalSource ? hitTestPane(e.clientX, e.clientY) : null;
      // Self-drop has no meaning (you can't split a pane with itself) — drop
      // the overlay so the user sees no false affordance.
      if (paneHit && paneHit.tabId === state.sourceId) {
        setPaneDropTarget((curr) => (curr === null ? curr : null));
        return;
      }
      if (!paneHit) {
        setPaneDropTarget((curr) => (curr === null ? curr : null));
        return;
      }
      setPaneDropTarget((curr) =>
        curr &&
        curr.tabId === paneHit.tabId &&
        curr.leafId === paneHit.leafId &&
        curr.side === paneHit.side &&
        curr.rect.left === paneHit.rect.left &&
        curr.rect.top === paneHit.rect.top &&
        curr.rect.width === paneHit.rect.width &&
        curr.rect.height === paneHit.rect.height
          ? curr
          : paneHit,
      );
    },
    [hitTestPane, hitTestTab, terminalTabIds],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const state = dragStateRef.current;
      if (!state || state.pointerId !== e.pointerId) return;
      const wasDrag = state.started;
      const tabTarget = dropTarget;
      const paneTarget = paneDropTarget;
      dragStateRef.current = null;
      setDraggingId(null);
      setDropTarget(null);
      setPaneDropTarget(null);
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      if (!wasDrag) return;
      // Block the synthetic click that follows pointerup so the source tab
      // doesn't get activated on drop. setPointerCapture changes click
      // targeting subtly across browsers; suppressing at the document level
      // (capture phase) is the most reliable cross-platform path.
      justDraggedRef.current = true;
      const swallowClick = (ev: MouseEvent) => {
        ev.preventDefault();
        ev.stopPropagation();
        document.removeEventListener("click", swallowClick, true);
      };
      document.addEventListener("click", swallowClick, true);
      window.setTimeout(() => {
        document.removeEventListener("click", swallowClick, true);
      }, 50);
      // Pane drop takes priority — if the cursor ended over a pane, that's
      // the user's intent.
      if (paneTarget) {
        const { dir, position } = SIDE_TO_SPLIT[paneTarget.side];
        onDropOntoPane(
          state.sourceId,
          paneTarget.tabId,
          paneTarget.leafId,
          dir,
          position,
        );
        return;
      }
      if (!tabTarget || tabTarget.id === state.sourceId) return;
      onReorder(state.sourceId, tabTarget.id, tabTarget.pos);
    },
    [dropTarget, onDropOntoPane, onReorder, paneDropTarget],
  );


  const handlePointerCancel = useCallback(() => {
    dragStateRef.current = null;
    setDraggingId(null);
    setDropTarget(null);
    setPaneDropTarget(null);
  }, []);

  const handleClickCapture = useCallback((e: React.MouseEvent) => {
    if (justDraggedRef.current) {
      justDraggedRef.current = false;
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  // --- rename state ---
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");

  const beginRename = useCallback((id: number, currentLabel: string) => {
    setRenamingId(id);
    setDraft(currentLabel);
  }, []);

  const commitRename = useCallback(() => {
    if (renamingId === null) return;
    const trimmed = draft.trim();
    // Empty string clears the custom title (revert to derived label).
    onRename(renamingId, trimmed === "" ? null : trimmed);
    setRenamingId(null);
  }, [draft, onRename, renamingId]);

  const cancelRename = useCallback(() => {
    setRenamingId(null);
  }, []);

  // Auto-clear stale rename target if its tab disappears.
  useEffect(() => {
    if (renamingId !== null && !tabs.some((t) => t.id === renamingId)) {
      setRenamingId(null);
    }
  }, [tabs, renamingId]);

  return (
    <>
      <PaneDropOverlay target={paneDropTarget} />
    <div
      ref={scrollRef}
      className="min-w-0 shrink overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <div className="flex w-max items-center gap-0.5 px-1">
        <Tabs
          value={String(activeId)}
          onValueChange={(v) => onSelect(Number(v))}
        >
          <TabsList className="h-7 w-max gap-0.5 bg-transparent p-0">
            {tabs.map((t) => {
              const isPreview =
                t.kind === "editor" && (t as EditorTab).preview;
              const isRenaming = renamingId === t.id;
              const isDragging = draggingId === t.id;
              const dropIndicator =
                dropTarget && dropTarget.id === t.id && draggingId !== t.id
                  ? dropTarget.pos
                  : null;
              return (
                <ContextMenu key={t.id}>
                  <ContextMenuTrigger asChild>
                    <div
                      data-tauri-drag-region="false"
                      onPointerDown={(e) =>
                        !isRenaming && handlePointerDown(e, t.id)
                      }
                      onPointerMove={handlePointerMove}
                      onPointerUp={handlePointerUp}
                      onPointerCancel={handlePointerCancel}
                      onClickCapture={handleClickCapture}
                      className={cn(
                        "relative shrink-0 touch-none",
                        isDragging && "opacity-40",
                      )}
                    >
                      {dropIndicator && (
                        <span
                          aria-hidden
                          className={cn(
                            "pointer-events-none absolute inset-y-0.5 z-10 w-[2px] rounded-full bg-primary",
                            "shadow-[0_0_6px_var(--color-primary),0_0_12px_var(--color-primary)]",
                            "animate-in fade-in-0 duration-150",
                            dropIndicator === "before"
                              ? "-left-px slide-in-from-left-1"
                              : "-right-px slide-in-from-right-1",
                          )}
                        />
                      )}
                      {isRenaming ? (
                        // While renaming we replace the <button> Trigger with a
                        // <div> that mimics its layout. An <input> nested inside
                        // a real <button> is invalid HTML and WebKit redirects
                        // focus back to the button, breaking the rename UI.
                        <div
                          data-tab-id={t.id}
                          data-state={t.id === activeId ? "active" : "inactive"}
                          className={cn(
                            "flex h-7 shrink-0 items-center gap-1.5 rounded-md text-xs justify-between",
                            t.id === activeId
                              ? "bg-accent text-foreground"
                              : "text-muted-foreground",
                            compact
                              ? "px-1.5"
                              : tabs.length === 1
                                ? "px-2"
                                : "ps-2 pe-1",
                          )}
                        >
                          <span
                            className={cn(
                              "flex items-center gap-1.5 truncate",
                              compact ? "max-w-48" : "max-w-80",
                            )}
                          >
                            <TabIcon tab={t} />
                            <RenameInput
                              initial={draft}
                              onChange={setDraft}
                              onCommit={commitRename}
                              onCancel={cancelRename}
                            />
                            {t.kind === "editor" && t.dirty ? (
                              <span
                                aria-label="Unsaved changes"
                                className="size-1.5 shrink-0 rounded-full bg-foreground/70"
                              />
                            ) : null}
                          </span>
                        </div>
                      ) : (
                        <TabsTrigger
                          value={String(t.id)}
                          data-tab-id={t.id}
                          onDoubleClick={() => isPreview && onPin(t.id)}
                          className={cn(
                            "group h-7 shrink-0 gap-1.5 rounded-md text-xs text-muted-foreground transition-colors data-[state=active]:bg-accent data-[state=active]:text-foreground hover:text-foreground/80 justify-between",
                            compact
                              ? "px-1.5!"
                              : tabs.length === 1
                                ? "px-2!"
                                : "ps-2! pe-1!",
                          )}
                        >
                          <span
                            className={cn(
                              "flex items-center gap-1.5 truncate",
                              compact ? "max-w-48" : "max-w-80",
                            )}
                          >
                            <TabIcon tab={t} />
                            <span
                              className={cn(
                                "truncate",
                                isPreview && "italic",
                              )}
                            >
                              {labelFor(t)}
                            </span>
                            {t.kind === "editor" && t.dirty ? (
                              <span
                                aria-label="Unsaved changes"
                                className="size-1.5 shrink-0 rounded-full bg-foreground/70"
                              />
                            ) : null}
                          </span>
                          {tabs.length > 1 && (
                            <span
                              role="button"
                              aria-label="Close tab"
                              onClick={(e) => {
                                e.stopPropagation();
                                onClose(t.id);
                              }}
                              className="rounded p-0.5 opacity-0 transition-opacity hover:bg-accent hover:opacity-100 group-hover:opacity-60"
                            >
                              <HugeiconsIcon
                                icon={Cancel01Icon}
                                size={11}
                                strokeWidth={2}
                              />
                            </span>
                          )}
                        </TabsTrigger>
                      )}
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent
                    className="min-w-40"
                    onCloseAutoFocus={(e) => {
                      // Always skip Radix's focus return: when "Rename" is
                      // chosen the input has already taken focus in its
                      // useLayoutEffect; for Close/Reset there's no element
                      // worth restoring focus to.
                      e.preventDefault();
                    }}
                  >
                    <ContextMenuItem
                      onSelect={() => beginRename(t.id, labelFor(t))}
                    >
                      Rename
                    </ContextMenuItem>
                    {t.customTitle ? (
                      <ContextMenuItem onSelect={() => onRename(t.id, null)}>
                        Reset name
                      </ContextMenuItem>
                    ) : null}
                    {tabs.length > 1 && (
                      <>
                        <ContextMenuSeparator />
                        <ContextMenuItem onSelect={() => onClose(t.id)}>
                          Close
                        </ContextMenuItem>
                      </>
                    )}
                  </ContextMenuContent>
                </ContextMenu>
              );
            })}
          </TabsList>
        </Tabs>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              title="New tab"
            >
              <HugeiconsIcon icon={PlusSignIcon} size={14} strokeWidth={2} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-44">
            <DropdownMenuItem onSelect={() => onNew()}>
              <HugeiconsIcon
                icon={ComputerTerminal02Icon}
                size={14}
                strokeWidth={1.75}
              />
              <span className="flex-1">Terminal</span>
              <span className="text-xs text-muted-foreground">
                {fmtShortcut(MOD_KEY, "T")}
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onNewPrivate()}>
              <HugeiconsIcon
                icon={IncognitoIcon}
                size={14}
                strokeWidth={1.75}
              />
              <span className="flex-1">Privacy</span>
              <span className="text-xs text-muted-foreground">
                {fmtShortcut(MOD_KEY, "R")}
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onNewEditor()}>
              <HugeiconsIcon
                icon={PencilEdit02Icon}
                size={14}
                strokeWidth={1.75}
              />
              <span className="flex-1">Editor</span>
              <span className="text-xs text-muted-foreground">
                {fmtShortcut(MOD_KEY, "E")}
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onNewPreview()}>
              <HugeiconsIcon icon={Globe02Icon} size={14} strokeWidth={1.75} />
              <span className="flex-1">Preview</span>
              <span className="text-xs text-muted-foreground">
                {fmtShortcut(MOD_KEY, "P")}
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onNewGitGraph()}>
              <HugeiconsIcon icon={GitBranchIcon} size={14} strokeWidth={1.75} />
              <span className="flex-1">Git Graph</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
    </>
  );
}

function PaneDropOverlay({ target }: { target: PaneDropTarget | null }) {
  if (target === null || typeof document === "undefined") return null;
  const { rect, side } = target;
  // Compute the highlight covering the half-pane that will receive the new
  // split. Position is absolute against the viewport.
  const half = (() => {
    switch (side) {
      case "left":
        return {
          left: rect.left,
          top: rect.top,
          width: rect.width / 2,
          height: rect.height,
        };
      case "right":
        return {
          left: rect.left + rect.width / 2,
          top: rect.top,
          width: rect.width / 2,
          height: rect.height,
        };
      case "top":
        return {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height / 2,
        };
      case "bottom":
        return {
          left: rect.left,
          top: rect.top + rect.height / 2,
          width: rect.width,
          height: rect.height / 2,
        };
    }
  })();
  return createPortal(
    <>
      {/* Outline of the full pane so the user sees the active drop target. */}
      <div
        aria-hidden
        className="pointer-events-none fixed z-[9999] rounded ring-2 ring-primary/70 ring-inset transition-[left,top,width,height] duration-100 ease-out"
        style={{
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        }}
      />
      {/* Filled half indicating where the dragged pane lands. */}
      <div
        aria-hidden
        className="pointer-events-none fixed z-[9999] bg-primary/35 ring-2 ring-primary ring-inset transition-[left,top,width,height] duration-100 ease-out"
        style={half}
      />
    </>,
    document.body,
  );
}

type RenameInputProps = {
  initial: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
};

function RenameInput({
  initial,
  onChange,
  onCommit,
  onCancel,
}: RenameInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initial);
  // Window (ms) during which blur events are treated as focus theft rather
  // than user intent. Radix's FocusScope schedules a setTimeout(0) restoration
  // that can fire after our initial focus call.
  const mountTimeRef = useRef(0);

  useLayoutEffect(() => {
    mountTimeRef.current = performance.now();
    const focusAndSelect = () => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.select();
    };
    focusAndSelect();
    // Schedule retries at each timing layer that could fire before vs. after
    // a focus-stealing handler. One of these will outrace whoever steals.
    const rafId = requestAnimationFrame(focusAndSelect);
    const t0 = setTimeout(focusAndSelect, 0);
    const t1 = setTimeout(focusAndSelect, 32);
    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(t0);
      clearTimeout(t1);
    };
  }, []);

  const handleBlur = () => {
    // Within the defense window, refocus instead of committing — the blur
    // is almost certainly Radix's FocusScope restoration, not the user
    // clicking away.
    if (performance.now() - mountTimeRef.current < 200) {
      queueMicrotask(() => {
        const el = inputRef.current;
        if (!el) return;
        el.focus();
        el.select();
      });
      return;
    }
    onCommit();
  };

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={(e) => {
        setValue(e.target.value);
        onChange(e.target.value);
      }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onCommit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      onBlur={handleBlur}
      // Width tracks content so the input matches a static label visually.
      // Min 2ch keeps the caret visible when emptied; +0.5ch absorbs caret width.
      style={{ width: `${Math.max(2, value.length) + 0.5}ch` }}
      className={cn(
        "min-w-0 max-w-40 truncate bg-transparent text-xs text-foreground/95",
        "outline-none ring-0 border-0 p-0 m-0 font-inherit",
        "caret-primary selection:bg-primary/40 selection:text-foreground",
      )}
      // Drag would otherwise consume the click and steal focus from the input.
      draggable={false}
      onDragStart={(e) => e.preventDefault()}
    />
  );
}

function TabIcon({ tab }: { tab: Tab }) {
  if (tab.kind === "editor" || tab.kind === "markdown") {
    const url = fileIconUrl(tab.title);
    return url ? <img src={url} alt="" className="size-3.5 shrink-0" /> : null;
  }
  if (tab.kind === "preview") {
    return (
      <HugeiconsIcon
        icon={Globe02Icon}
        size={14}
        strokeWidth={2}
        className="shrink-0"
      />
    );
  }
  if (tab.kind === "ai-diff") {
    return (
      <HugeiconsIcon
        icon={GitCompareIcon}
        size={14}
        strokeWidth={2}
        className="shrink-0"
      />
    );
  }
  if (tab.kind === "terminal" && tab.private) {
    return (
      <HugeiconsIcon
        icon={IncognitoIcon}
        size={14}
        strokeWidth={2}
        className="shrink-0"
      />
    );
  }
  if (tab.kind === "git-diff" || tab.kind === "git-commit-file") {
    return (
      <HugeiconsIcon
        icon={GitCompareIcon}
        size={14}
        strokeWidth={2}
        className="shrink-0"
      />
    );
  }
  if (tab.kind === "git-history") {
    return (
      <HugeiconsIcon
        icon={Clock01Icon}
        size={14}
        strokeWidth={2}
        className="shrink-0"
      />
    );
  }
  return (
    <HugeiconsIcon
      icon={ComputerTerminal02Icon}
      size={14}
      strokeWidth={2}
      className="shrink-0"
    />
  );
}

function labelFor(t: Tab): string {
  if (t.customTitle) return t.customTitle;
  if (t.kind === "editor") return t.title;
  if (t.kind === "preview") return t.title;
  if (t.kind === "markdown") return t.title;
  if (t.kind === "ai-diff") return t.title;
  if (t.kind === "git-diff") return t.title;
  if (t.kind === "git-history") return t.title;
  if (t.kind === "git-commit-file") return t.title;
  if (!t.cwd) return t.title;
  const parts = t.cwd.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "/";
}
