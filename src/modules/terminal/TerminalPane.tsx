import { quoteShellArg } from "@/lib/shellQuote";
import { useTheme } from "@/modules/theme";
import type { SearchAddon } from "@xterm/addon-search";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { useTerminalSession } from "./lib/useTerminalSession";

export type TerminalPaneHandle = {
  write: (data: string) => void;
  paste: (data: string) => void;
  focus: () => void;
  getBuffer: (maxLines?: number) => string | null;
  getSelection: () => string | null;
};

type Props = {
  /** Stable identifier for this leaf (passed back through callbacks). */
  leafId: number;
  /** Tab containing this pane is on screen. */
  visible: boolean;
  /** This leaf is the active pane within its tab — receives auto-focus. */
  focused?: boolean;
  initialCwd?: string;
  onSearchReady?: (leafId: number, addon: SearchAddon) => void;
  onExit?: (leafId: number, code: number) => void;
  onCwd?: (leafId: number, cwd: string) => void;
};

export const TerminalPane = forwardRef<TerminalPaneHandle, Props>(
  function TerminalPane(
    {
      leafId,
      visible,
      focused = true,
      initialCwd,
      onSearchReady,
      onExit,
      onCwd,
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const { resolvedMode, themeId, customThemes } = useTheme();

    const session = useTerminalSession({
      leafId,
      container: containerRef,
      visible,
      focused,
      initialCwd,
      onSearchReady: (a) => onSearchReady?.(leafId, a),
      onExit: (c) => onExit?.(leafId, c),
      onCwd: (c) => onCwd?.(leafId, c),
    });

    useEffect(() => {
      // Defer one frame so CSS-variable token resolution sees the new class.
      const id = requestAnimationFrame(() => session.applyTheme());
      return () => cancelAnimationFrame(id);
    }, [resolvedMode, themeId, customThemes, session]);

    useImperativeHandle(
      ref,
      () => ({
        write: (data: string) => session.write(data),
        paste: (data: string) => session.paste(data),
        focus: () => session.focus(),
        getBuffer: (max?: number) => session.getBuffer(max),
        getSelection: () => session.getSelection(),
      }),
      [session],
    );

    return (
      <div
        ref={containerRef}
        className="zoom-exempt h-full w-full"
        data-terminal-leaf={leafId}
        onDragOver={(e) => {
          // Required to opt into the drop event. Default browser behavior
          // would reject the drop and show a forbidden cursor.
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }}
        onDrop={(e) => {
          // text/uri-list wins on Linux/Windows file drags (file:// URIs,
          // one per line). macOS Finder also exposes the absolute path via
          // text/plain, which is the same channel an in-page text drag uses.
          const uriList = e.dataTransfer.getData("text/uri-list");
          let payload = "";
          if (uriList) {
            payload = uriList
              .split(/\r?\n/)
              .map((l) => l.trim())
              .filter((l) => l && !l.startsWith("#"))
              .map((l) => {
                try {
                  return decodeURI(l.replace(/^file:\/\/(localhost)?/, ""));
                } catch {
                  return l;
                }
              })
              .map((p) => quoteShellArg(p))
              .join(" ");
          } else {
            payload = e.dataTransfer.getData("text/plain");
          }
          if (!payload) return;
          e.preventDefault();
          session.paste(payload);
          session.focus();
        }}
        style={{
          visibility: visible ? "visible" : "hidden",
          pointerEvents: visible ? "auto" : "none",
        }}
      />
    );
  },
);
