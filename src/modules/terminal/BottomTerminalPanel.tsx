import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  Cancel01Icon,
  ComputerTerminal02Icon,
  Delete02Icon,
  LayoutTwoColumnIcon,
  LayoutTwoRowIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { SearchAddon } from "@xterm/addon-search";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { PaneTreeView } from "./PaneTreeView";
import type { TerminalPaneHandle } from "./TerminalPane";
import { leafIds } from "./lib/panes";
import type { SplitDir, PaneNode } from "./lib/panes";

type Bundle = {
  setRef: (h: TerminalPaneHandle | null) => void;
  onSearch: (addon: SearchAddon) => void;
  onCwd: (cwd: string) => void;
  onExit: (code: number) => void;
};

type Props = {
  paneTree: PaneNode;
  activeLeafId: number;
  /** Toolbar visibility / hint text. */
  paneCount: number;
  canSplit: boolean;
  onSplit: (dir: SplitDir) => void;
  /** Close the focused pane (or the whole panel when it was the last one). */
  onCloseActive: () => void;
  /** Hide the panel without destroying pane sessions. */
  onHide: () => void;
  onFocusLeaf: (leafId: number) => void;
  onCwd: (leafId: number, cwd: string) => void;
  onExit: (leafId: number, code: number) => void;
};

export function BottomTerminalPanel({
  paneTree,
  activeLeafId,
  paneCount,
  canSplit,
  onSplit,
  onCloseActive,
  onHide,
  onFocusLeaf,
  onCwd,
  onExit,
}: Props) {
  // Stable per-leaf callback bundle — re-created lazily and garbage-collected
  // when the leaf is gone from the tree.
  const bundles = useRef(new Map<number, Bundle>());
  const cwdRef = useRef(onCwd);
  const exitRef = useRef(onExit);
  useEffect(() => {
    cwdRef.current = onCwd;
  }, [onCwd]);
  useEffect(() => {
    exitRef.current = onExit;
  }, [onExit]);

  const getBundle = useCallback((leafId: number): Bundle => {
    let b = bundles.current.get(leafId);
    if (!b) {
      b = {
        setRef: () => {},
        onSearch: () => {},
        onCwd: (cwd) => cwdRef.current(leafId, cwd),
        onExit: (code) => exitRef.current(leafId, code),
      };
      bundles.current.set(leafId, b);
    }
    return b;
  }, []);

  const live = useMemo(() => new Set(leafIds(paneTree)), [paneTree]);
  useEffect(() => {
    for (const id of bundles.current.keys()) {
      if (!live.has(id)) bundles.current.delete(id);
    }
  }, [live]);

  return (
    <div className="flex h-full min-h-0 flex-col border-t border-border/60 bg-card/40">
      <div className="flex h-7 shrink-0 items-center gap-1 border-b border-border/40 px-2">
        <div className="flex shrink-0 items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-[0.16em] text-muted-foreground/85">
          <HugeiconsIcon
            icon={ComputerTerminal02Icon}
            size={11}
            strokeWidth={2}
            className="text-muted-foreground/85"
          />
          <span>Terminal</span>
          {paneCount > 1 ? (
            <span className="rounded-full border border-border/60 px-1 text-[9px] font-semibold tracking-normal text-muted-foreground/85">
              {paneCount}
            </span>
          ) : null}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <ToolbarButton
            label="Split right"
            disabled={!canSplit}
            onClick={() => onSplit("row")}
          >
            <HugeiconsIcon
              icon={LayoutTwoColumnIcon}
              size={13}
              strokeWidth={1.85}
            />
          </ToolbarButton>
          <ToolbarButton
            label="Split down"
            disabled={!canSplit}
            onClick={() => onSplit("col")}
          >
            <HugeiconsIcon
              icon={LayoutTwoRowIcon}
              size={13}
              strokeWidth={1.85}
            />
          </ToolbarButton>
          <ToolbarButton label="Kill terminal" onClick={onCloseActive}>
            <HugeiconsIcon icon={Delete02Icon} size={13} strokeWidth={1.85} />
          </ToolbarButton>
          <ToolbarButton label="Hide panel" onClick={onHide}>
            <HugeiconsIcon icon={Cancel01Icon} size={13} strokeWidth={2} />
          </ToolbarButton>
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        <PaneTreeView
          node={paneTree}
          tabVisible
          activeLeafId={activeLeafId}
          onFocusLeaf={onFocusLeaf}
          getBundle={getBundle}
        />
      </div>
    </div>
  );
}

function ToolbarButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          disabled={disabled}
          onClick={onClick}
          className={cn(
            "size-6 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground",
            "disabled:opacity-40",
          )}
          aria-label={label}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-[10.5px]">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
