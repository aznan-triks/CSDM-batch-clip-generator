/**
 * The pre-click check coalesces: while one question is in flight, newer
 * settings wait, and only the latest is asked when it returns. A stale answer
 * never overwrites a fresher question's.
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const calls: { cfg: unknown; resolve: (problem: string | null) => void }[] = [];

vi.mock("../../bridge", () => ({
  runCommand: (_name: string, payload: { cfg: unknown }) =>
    new Promise((resolve) => {
      calls.push({ cfg: payload.cfg, resolve: (problem) => resolve({ ok: true, problem }) });
    }),
}));

import { useRunInputsProblem } from "../useRunInputsProblem";

describe("useRunInputsProblem", () => {
  it("asks one question at a time, then only for the latest settings", async () => {
    calls.length = 0;
    const a = { n: 1 };
    const b = { n: 2 };
    const c = { n: 3 };
    const { result, rerender } = renderHook(({ cfg }) => useRunInputsProblem(cfg), {
      initialProps: { cfg: a as Record<string, unknown> },
    });
    rerender({ cfg: b });
    rerender({ cfg: c });
    expect(calls.map((call) => call.cfg)).toEqual([a]);

    // The answer about `a` is stale by now: it must not show.
    await act(async () => calls[0].resolve("about a"));
    expect(result.current).toBeNull();
    expect(calls.map((call) => call.cfg)).toEqual([a, c]);

    await act(async () => calls[1].resolve("about c"));
    expect(result.current).toBe("about c");
    expect(calls).toHaveLength(2);
  });
});
