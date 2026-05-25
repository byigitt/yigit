import { Button } from "@/components/ui/button";
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
import { useCallback, useEffect, useRef, useState } from "react";
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
  compact?: boolean;
};

type DropPosition = "before" | "after";

type DragState = {
  sourceId: number;
  startX: number;
  startY: number;
  pointerId: number;
  started: boolean;
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
      const hit = hitTestTab(e.clientX, e.clientY);
      if (!hit || hit.id === state.sourceId) {
        setDropTarget((curr) => (curr === null ? curr : null));
        return;
      }
      const pos: DropPosition =
        e.clientX < hit.rect.left + hit.rect.width / 2 ? "before" : "after";
      setDropTarget((curr) =>
        curr && curr.id === hit.id && curr.pos === pos
          ? curr
          : { id: hit.id, pos },
      );
    },
    [hitTestTab],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const state = dragStateRef.current;
      if (!state || state.pointerId !== e.pointerId) return;
      const wasDrag = state.started;
      const target = dropTarget;
      dragStateRef.current = null;
      setDraggingId(null);
      setDropTarget(null);
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      if (!wasDrag) return;
      // Block the synthetic click that follows pointerup so the source tab
      // doesn't get activated on drop.
      justDraggedRef.current = true;
      if (!target || target.id === state.sourceId) return;
      onReorder(state.sourceId, target.id, target.pos);
    },
    [dropTarget, onReorder],
  );

  const handlePointerCancel = useCallback(() => {
    dragStateRef.current = null;
    setDraggingId(null);
    setDropTarget(null);
  }, []);

  const handleClickCapture = useCallback((e: React.MouseEvent) => {
    if (justDraggedRef.current) {
      justDraggedRef.current = false;
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  return (
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
              const isPreview = t.kind === "editor" && (t as EditorTab).preview;
              const isDragging = draggingId === t.id;
              const dropIndicator =
                dropTarget && dropTarget.id === t.id && draggingId !== t.id
                  ? dropTarget.pos
                  : null;
              return (
                <div
                  key={t.id}
                  data-tauri-drag-region="false"
                  onPointerDown={(e) => handlePointerDown(e, t.id)}
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
                      {/* Preview tabs use italic to signal the transient state,
                          matching the visual convention from VSCode. */}
                      <span className={cn("truncate", isPreview && "italic")}>
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
                </div>
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
