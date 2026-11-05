import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import App from "../App";

describe("App canvas", () => {
  it("clears the whole canvas every frame", () => {
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (t, k) => (k in t ? t[k as string] : (t[k as string] = vi.fn(() => ({ addColorStop: vi.fn() })))),
      set: (t, k, v) => ((t[k as string] = v), true),
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });

    render(<App />);
    frames.shift()!(16);

    expect(ctx.clearRect).toHaveBeenCalled();
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });
});
