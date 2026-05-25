import { Alert02Icon, Globe02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { invoke } from "@tauri-apps/api/core";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { Webview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  PreviewAddressBar,
  type PreviewAddressBarHandle,
} from "./PreviewAddressBar";

export type PreviewPaneHandle = {
  reload: () => void;
  focusAddressBar: () => void;
  getUrl: () => string;
  openDevTools: () => void;
};

type Props = {
  paneId: number;
  url: string;
  visible: boolean;
  onUrlChange: (url: string) => void;
};

function labelFor(paneId: number): string {
  return `preview-${paneId}`;
}

function rectFor(el: HTMLElement): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  const r = el.getBoundingClientRect();
  return {
    x: Math.round(r.x),
    y: Math.round(r.y),
    w: Math.max(1, Math.round(r.width)),
    h: Math.max(1, Math.round(r.height)),
  };
}

export const PreviewPane = forwardRef<PreviewPaneHandle, Props>(
  function PreviewPane({ paneId, url, visible, onUrlChange }, ref) {
    const hostRef = useRef<HTMLDivElement>(null);
    const addressRef = useRef<PreviewAddressBarHandle>(null);
    const webviewRef = useRef<Webview | null>(null);
    const urlRef = useRef(url);
    urlRef.current = url;
    const visibleRef = useRef(visible);
    visibleRef.current = visible;
    const [ready, setReady] = useState(false);

    const label = labelFor(paneId);

    // Spin up one child webview per preview tab. Stays alive for the tab's
    // life so navigation history survives backgrounding; URL changes go
    // through `navigate` instead of remount.
    useEffect(() => {
      let cancelled = false;
      let created: Webview | null = null;

      void (async () => {
        const host = hostRef.current;
        if (!host) return;
        // Strict-mode replays the effect: any leftover with the same label
        // must go first or the constructor errors out.
        const stale = await Webview.getByLabel(label).catch(() => null);
        if (stale) await stale.close().catch(() => undefined);
        if (cancelled) return;

        const r = rectFor(host);
        const win = getCurrentWindow();
        const initial = urlRef.current || "about:blank";
        let wv: Webview;
        try {
          wv = new Webview(win, label, {
            url: initial,
            x: r.x,
            y: r.y,
            width: r.w,
            height: r.h,
            dragDropEnabled: false,
            acceptFirstMouse: true,
          });
        } catch (e) {
          console.error("preview webview construct failed", e);
          return;
        }
        created = wv;
        try {
          await new Promise<void>((resolve, reject) => {
            void wv.once("tauri://webview-created", () => resolve());
            void wv.once("tauri://created", () => resolve());
            void wv.once("tauri://error", (e) =>
              reject(new Error(String(e.payload))),
            );
            // Fallback: not every Tauri build emits the created event.
            setTimeout(resolve, 800);
          });
        } catch (e) {
          console.error("preview webview create failed", e);
        }
        if (cancelled) {
          await wv.close().catch(() => undefined);
          return;
        }
        webviewRef.current = wv;
        if (!visibleRef.current) await wv.hide().catch(() => undefined);
        setReady(true);
      })();

      return () => {
        cancelled = true;
        const wv = created ?? webviewRef.current;
        webviewRef.current = null;
        setReady(false);
        if (wv) void wv.close().catch(() => undefined);
      };
    }, [label]);

    // Keep the webview anchored to the placeholder div: resize observer for
    // size changes (which also picks up x/y shifts from sidebar resize), and
    // a window-resize listener for whole-window moves where the observer
    // wouldn't fire.
    useEffect(() => {
      if (!ready) return;
      const host = hostRef.current;
      const wv = webviewRef.current;
      if (!host || !wv) return;

      let raf = 0;
      const push = () => {
        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          if (!hostRef.current || !webviewRef.current) return;
          const r = rectFor(hostRef.current);
          void webviewRef.current
            .setPosition(new LogicalPosition(r.x, r.y))
            .catch(() => undefined);
          void webviewRef.current
            .setSize(new LogicalSize(r.w, r.h))
            .catch(() => undefined);
        });
      };

      const ro = new ResizeObserver(push);
      ro.observe(host);
      window.addEventListener("resize", push);
      // Initial sync after mount in case the host moved between effect runs.
      push();
      return () => {
        if (raf) cancelAnimationFrame(raf);
        ro.disconnect();
        window.removeEventListener("resize", push);
      };
    }, [ready]);

    // URL changes after the webview exists: navigate instead of remounting.
    useEffect(() => {
      if (!ready || !url) return;
      void invoke("preview_navigate", { label, url }).catch(console.error);
    }, [label, url, ready]);

    // Hide when the tab is in the background — webviews paint on top of the
    // DOM, leaving them visible would obscure terminal/editor tabs.
    useEffect(() => {
      if (!ready) return;
      const wv = webviewRef.current;
      if (!wv) return;
      if (visible) void wv.show().catch(() => undefined);
      else void wv.hide().catch(() => undefined);
    }, [visible, ready]);

    useImperativeHandle(
      ref,
      () => ({
        reload: () => {
          void invoke("preview_reload", { label }).catch(console.error);
        },
        focusAddressBar: () => addressRef.current?.focus(),
        getUrl: () => urlRef.current,
        openDevTools: () => {
          void invoke("preview_open_devtools", { label }).catch(console.error);
        },
      }),
      [label],
    );

    const showXfoHint = url ? !isLocalUrl(url) : false;

    return (
      <div
        className="flex h-full w-full flex-col overflow-hidden rounded-md border border-border/60 bg-background"
        style={{
          visibility: visible ? "visible" : "hidden",
          pointerEvents: visible ? "auto" : "none",
        }}
      >
        <PreviewAddressBar
          ref={addressRef}
          url={url}
          onSubmit={onUrlChange}
          onReload={() =>
            void invoke("preview_reload", { label }).catch(console.error)
          }
          onOpenDevTools={() =>
            void invoke("preview_open_devtools", { label }).catch(console.error)
          }
        />
        {showXfoHint ? (
          <div className="flex h-7 shrink-0 items-center gap-1.5 border-b border-border/60 bg-amber-500/8 px-3 text-[11px] text-amber-600 dark:text-amber-400">
            <HugeiconsIcon
              icon={Alert02Icon}
              size={12}
              strokeWidth={1.75}
              className="shrink-0"
            />
            <span className="truncate">
              Some sites refuse to embed (X-Frame-Options). If the page is
              blank, open it externally.
            </span>
          </div>
        ) : null}
        <div className="relative min-h-0 flex-1 bg-white">
          <div ref={hostRef} className="absolute inset-0" aria-hidden />
          {!url ? <EmptyState /> : null}
        </div>
      </div>
    );
  },
);

function EmptyState() {
  return (
    <div className="pointer-events-auto absolute inset-0 flex flex-col items-center justify-center gap-4 bg-background px-6 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl border border-border/60 bg-card text-muted-foreground">
        <HugeiconsIcon icon={Globe02Icon} size={20} strokeWidth={1.5} />
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-foreground">
          Nothing to preview yet
        </p>
        <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
          Type a URL above, or open the{" "}
          <span className="rounded bg-muted px-1 py-0.5 font-mono text-[10.5px]">
            Ports
          </span>{" "}
          dropdown to jump straight to your running dev server.
        </p>
      </div>
    </div>
  );
}

function isLocalUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const h = u.hostname;
    return (
      h === "localhost" ||
      h === "127.0.0.1" ||
      h === "0.0.0.0" ||
      h === "[::1]" ||
      h.endsWith(".localhost")
    );
  } catch {
    return false;
  }
}
