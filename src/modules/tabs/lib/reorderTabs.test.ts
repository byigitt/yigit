import { describe, expect, it } from "vitest";
import { reorderTabs } from "./useTabs";

const make = (ids: number[]) => ids.map((id) => ({ id }));
const ids = (tabs: { id: number }[]) => tabs.map((t) => t.id);

describe("reorderTabs", () => {
  it("moves an item forward with position=before", () => {
    expect(ids(reorderTabs(make([1, 2, 3, 4]), 1, 3, "before"))).toEqual([
      2, 1, 3, 4,
    ]);
  });

  it("moves an item forward with position=after", () => {
    expect(ids(reorderTabs(make([1, 2, 3, 4]), 1, 3, "after"))).toEqual([
      2, 3, 1, 4,
    ]);
  });

  it("moves an item backward with position=before", () => {
    expect(ids(reorderTabs(make([1, 2, 3, 4]), 4, 2, "before"))).toEqual([
      1, 4, 2, 3,
    ]);
  });

  it("moves an item backward with position=after", () => {
    expect(ids(reorderTabs(make([1, 2, 3, 4]), 4, 2, "after"))).toEqual([
      1, 2, 4, 3,
    ]);
  });

  it("supports moving to the start", () => {
    expect(ids(reorderTabs(make([1, 2, 3]), 3, 1, "before"))).toEqual([
      3, 1, 2,
    ]);
  });

  it("supports moving to the end", () => {
    expect(ids(reorderTabs(make([1, 2, 3]), 1, 3, "after"))).toEqual([
      2, 3, 1,
    ]);
  });

  it("returns the same reference for a same-id move", () => {
    const list = make([1, 2, 3]);
    expect(reorderTabs(list, 2, 2, "before")).toBe(list);
  });

  it("returns the same reference when source is missing", () => {
    const list = make([1, 2, 3]);
    expect(reorderTabs(list, 99, 2, "after")).toBe(list);
  });

  it("returns the same reference when target is missing", () => {
    const list = make([1, 2, 3]);
    expect(reorderTabs(list, 1, 99, "after")).toBe(list);
  });

  it("returns the same reference when the move would be a no-op (adjacent neighbour, before)", () => {
    // Moving 2 to before 3 in [1,2,3] should leave [1,2,3] — source already in
    // that position.
    const list = make([1, 2, 3]);
    expect(reorderTabs(list, 2, 3, "before")).toBe(list);
  });

  it("returns the same reference when the move would be a no-op (adjacent neighbour, after)", () => {
    // Moving 2 to after 1 in [1,2,3] should leave [1,2,3].
    const list = make([1, 2, 3]);
    expect(reorderTabs(list, 2, 1, "after")).toBe(list);
  });
});
