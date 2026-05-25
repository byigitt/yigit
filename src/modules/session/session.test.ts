import { describe, expect, it } from "vitest";
import { maxRestoredId, projectTab } from "./session";

describe("projectTab", () => {
  it("preserves terminal tab with valid pane tree", () => {
    const restored = projectTab({
      id: 1,
      kind: "terminal",
      title: "shell",
      paneTree: { kind: "leaf", id: 2, cwd: "/home" },
      activeLeafId: 2,
      cwd: "/home",
    });
    expect(restored).toMatchObject({
      id: 1,
      kind: "terminal",
      activeLeafId: 2,
      cwd: "/home",
    });
  });

  it("drops private terminal tabs", () => {
    expect(
      projectTab({
        id: 1,
        kind: "terminal",
        title: "private",
        paneTree: { kind: "leaf", id: 2 },
        activeLeafId: 2,
        private: true,
      }),
    ).toBeNull();
  });

  it("falls back to first leaf when activeLeafId is stale", () => {
    const restored = projectTab({
      id: 1,
      kind: "terminal",
      title: "shell",
      paneTree: {
        kind: "split",
        id: 10,
        dir: "row",
        children: [
          { kind: "leaf", id: 11 },
          { kind: "leaf", id: 12 },
        ],
      },
      activeLeafId: 999,
    });
    expect(restored).toMatchObject({ activeLeafId: 11 });
  });

  it("forces editor tabs back to clean + persistent on restore", () => {
    const restored = projectTab({
      id: 1,
      kind: "editor",
      title: "App.tsx",
      path: "/x/App.tsx",
      dirty: true,
      preview: true,
    });
    expect(restored).toMatchObject({
      id: 1,
      kind: "editor",
      path: "/x/App.tsx",
      dirty: false,
      preview: false,
    });
  });

  it("validates pane tree shape and rejects malformed splits", () => {
    expect(
      projectTab({
        id: 1,
        kind: "terminal",
        title: "shell",
        paneTree: { kind: "split", id: 1, dir: "diagonal", children: [] },
        activeLeafId: 2,
      }),
    ).toBeNull();
  });

  it("rejects ai-diff, git-diff and other non-restorable kinds", () => {
    for (const kind of ["ai-diff", "git-diff", "git-history", "git-commit-file"]) {
      expect(projectTab({ id: 1, kind, title: "x" })).toBeNull();
    }
  });

  it("accepts preview, markdown, and image tabs with required fields", () => {
    expect(
      projectTab({ id: 1, kind: "preview", title: "p", url: "http://a" }),
    ).toMatchObject({ kind: "preview", url: "http://a" });
    expect(
      projectTab({ id: 2, kind: "markdown", title: "m", path: "/x.md" }),
    ).toMatchObject({ kind: "markdown", path: "/x.md" });
    expect(
      projectTab({ id: 3, kind: "image", title: "i", path: "/x.png" }),
    ).toMatchObject({ kind: "image", path: "/x.png" });
  });

  it("rejects tabs missing id or title", () => {
    expect(projectTab({ kind: "editor", path: "/x", title: "x" })).toBeNull();
    expect(projectTab({ id: 1, kind: "editor", path: "/x" })).toBeNull();
  });
});

describe("maxRestoredId", () => {
  it("returns max across tab ids and nested pane ids", () => {
    const max = maxRestoredId({
      tabs: [
        {
          id: 5,
          kind: "terminal",
          title: "a",
          paneTree: {
            kind: "split",
            id: 10,
            dir: "row",
            children: [
              { kind: "leaf", id: 11 },
              { kind: "leaf", id: 42 },
            ],
          },
          activeLeafId: 11,
        },
        { id: 7, kind: "editor", title: "b", path: "/p", dirty: false, preview: false },
      ],
      activeId: 5,
    });
    expect(max).toBe(42);
  });
});
