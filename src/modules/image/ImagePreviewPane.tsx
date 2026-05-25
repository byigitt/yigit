import { cn } from "@/lib/utils";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";

type Status =
  | { kind: "loading" }
  | { kind: "ready"; url: string; size: number }
  | { kind: "toolarge"; size: number; limit: number }
  | { kind: "error"; message: string };

type Props = {
  path: string;
  visible: boolean;
};

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  apng: "image/apng",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jfif: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  svg: "image/svg+xml",
  avif: "image/avif",
};

const IMAGE_EXTENSIONS = new Set(Object.keys(MIME_BY_EXT));

export function isImagePath(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot === -1) return false;
  return IMAGE_EXTENSIONS.has(path.slice(dot + 1).toLowerCase());
}

function mimeFromPath(path: string): string {
  const dot = path.lastIndexOf(".");
  if (dot === -1) return "application/octet-stream";
  return MIME_BY_EXT[path.slice(dot + 1).toLowerCase()] ?? "application/octet-stream";
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function parseTooLarge(err: string): { size: number; limit: number } | null {
  const m = /^toolarge:(\d+):(\d+)/.exec(err);
  if (!m) return null;
  return { size: Number(m[1]), limit: Number(m[2]) };
}

// 16x16 checkerboard so transparent regions are visible without leaking into
// the surrounding chrome. Inline so it doesn't require a tailwind theme entry.
const CHECKERBOARD_STYLE = {
  backgroundImage:
    "linear-gradient(45deg, rgb(0 0 0 / 0.06) 25%, transparent 25%), linear-gradient(-45deg, rgb(0 0 0 / 0.06) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgb(0 0 0 / 0.06) 75%), linear-gradient(-45deg, transparent 75%, rgb(0 0 0 / 0.06) 75%)",
  backgroundSize: "16px 16px",
  backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0",
} as const;

export function ImagePreviewPane({ path, visible }: Props) {
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [zoom, setZoom] = useState<"fit" | "actual">("fit");
  const [dimensions, setDimensions] = useState<{ w: number; h: number } | null>(
    null,
  );
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus({ kind: "loading" });
    setDimensions(null);
    setZoom("fit");
    const mimeType = mimeFromPath(path);
    invoke<ArrayBuffer>("fs_read_file_bytes", {
      path,
      workspace: currentWorkspaceEnv(),
    })
      .then((buffer) => {
        if (cancelled) return;
        const blob = new Blob([buffer], { type: mimeType });
        const url = URL.createObjectURL(blob);
        urlRef.current = url;
        setStatus({ kind: "ready", url, size: blob.size });
      })
      .catch((e) => {
        if (cancelled) return;
        const msg = String(e);
        const overflow = parseTooLarge(msg);
        if (overflow) {
          setStatus({
            kind: "toolarge",
            size: overflow.size,
            limit: overflow.limit,
          });
        } else {
          setStatus({ kind: "error", message: msg });
        }
      });
    return () => {
      cancelled = true;
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };
  }, [path]);

  return (
    <div
      className={cn(
        "flex h-full w-full flex-col overflow-hidden rounded-md border border-border/60 bg-background",
        !visible && "pointer-events-none",
      )}
    >
      {status.kind === "ready" && (
        <div className="flex h-7 shrink-0 items-center justify-between gap-3 border-b border-border/60 px-3 text-[11px] text-muted-foreground">
          <div className="flex min-w-0 items-center gap-3">
            <span className="truncate">{path}</span>
            {dimensions && (
              <span className="shrink-0 tabular-nums">
                {dimensions.w} × {dimensions.h}
              </span>
            )}
            <span className="shrink-0 tabular-nums">
              {formatBytes(status.size)}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setZoom((z) => (z === "fit" ? "actual" : "fit"))}
            className="shrink-0 rounded-sm px-1.5 py-0.5 text-foreground/80 transition-colors hover:bg-accent hover:text-foreground"
          >
            {zoom === "fit" ? "Actual size" : "Fit"}
          </button>
        </div>
      )}
      <div
        className={cn(
          "flex flex-1 items-center justify-center overflow-auto",
          zoom === "fit" ? "p-4" : "p-0",
        )}
        style={CHECKERBOARD_STYLE}
      >
        {status.kind === "loading" && (
          <p className="text-[12px] text-muted-foreground">Loading…</p>
        )}
        {status.kind === "error" && (
          <p className="px-4 text-center text-[12px] text-destructive">
            Failed to read file: {status.message}
          </p>
        )}
        {status.kind === "toolarge" && (
          <p className="px-4 text-center text-[12px] text-muted-foreground">
            Image is {formatBytes(status.size)}, preview limit{" "}
            {formatBytes(status.limit)}.
          </p>
        )}
        {status.kind === "ready" && (
          <img
            src={status.url}
            alt={path}
            draggable={false}
            onLoad={(e) => {
              const img = e.currentTarget;
              setDimensions({ w: img.naturalWidth, h: img.naturalHeight });
            }}
            className={cn(
              "select-none",
              zoom === "fit"
                ? "max-h-full max-w-full object-contain"
                : "max-w-none",
            )}
          />
        )}
      </div>
    </div>
  );
}
