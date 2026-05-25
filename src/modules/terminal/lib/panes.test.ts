import { describe, expect, it } from "vitest";
import { mergeIntoLeaf, type PaneNode } from "./panes";

const leaf = (id: number): PaneNode => ({ kind: "leaf", id });

describe("mergeIntoLeaf", () => {
  it("turns a single leaf into a row split with incoming on the right", () => {
    const tree = leaf(1);
    const out = mergeIntoLeaf(tree, 1, leaf(9), 100, "row", "after");
    expect(out).toEqual({
      kind: "split",
      id: 100,
      dir: "row",
      children: [leaf(1), leaf(9)],
    });
  });

  it("places incoming on the left when position is 'before'", () => {
    const out = mergeIntoLeaf(leaf(1), 1, leaf(9), 100, "row", "before");
    expect(out).toMatchObject({
      kind: "split",
      children: [leaf(9), leaf(1)],
    });
  });

  it("turns a leaf into a column split for vertical drop", () => {
    const out = mergeIntoLeaf(leaf(1), 1, leaf(9), 100, "col", "after");
    expect(out).toMatchObject({
      kind: "split",
      dir: "col",
      children: [leaf(1), leaf(9)],
    });
  });

  it("splices into an existing same-direction split (no nested duplicate split)", () => {
    const tree: PaneNode = {
      kind: "split",
      id: 50,
      dir: "row",
      children: [leaf(1), leaf(2)],
    };
    const out = mergeIntoLeaf(tree, 2, leaf(9), 100, "row", "after");
    expect(out).toEqual({
      kind: "split",
      id: 50,
      dir: "row",
      children: [leaf(1), leaf(2), leaf(9)],
    });
  });

  it("nests a perpendicular split when the enclosing split direction differs", () => {
    const tree: PaneNode = {
      kind: "split",
      id: 50,
      dir: "row",
      children: [leaf(1), leaf(2)],
    };
    const out = mergeIntoLeaf(tree, 2, leaf(9), 100, "col", "after");
    expect(out).toMatchObject({
      kind: "split",
      dir: "row",
      children: [
        leaf(1),
        { kind: "split", dir: "col", children: [leaf(2), leaf(9)] },
      ],
    });
  });

  it("merges an entire subtree, not just a leaf", () => {
    const tree = leaf(1);
    const incoming: PaneNode = {
      kind: "split",
      id: 60,
      dir: "col",
      children: [leaf(7), leaf(8)],
    };
    const out = mergeIntoLeaf(tree, 1, incoming, 100, "row", "after");
    expect(out).toEqual({
      kind: "split",
      id: 100,
      dir: "row",
      children: [leaf(1), incoming],
    });
  });

  it("returns the tree unchanged when the target leaf is missing", () => {
    const tree: PaneNode = {
      kind: "split",
      id: 50,
      dir: "row",
      children: [leaf(1), leaf(2)],
    };
    const out = mergeIntoLeaf(tree, 99, leaf(9), 100, "row", "after");
    expect(out).toEqual(tree);
  });
});
