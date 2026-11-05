import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useHighScore } from "../hooks/useHighScore";

describe("useHighScore", () => {
  beforeEach(() => localStorage.clear());

  it("keeps the best score when a stale callback is called with a lower score", () => {
    const { result } = renderHook(() => useHighScore("k"));
    const firstUpdate = result.current[1]; // what the RAF loop captures on mount
    act(() => firstUpdate(500));
    act(() => firstUpdate(300));
    expect(result.current[0]).toBe(500);
    expect(localStorage.getItem("k")).toBe("500");
  });
});
