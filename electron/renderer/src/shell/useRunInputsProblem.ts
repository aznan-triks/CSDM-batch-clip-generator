/**
 * Why RUN / PREVIEW cannot start with the current settings, asked BEFORE the
 * click.
 *
 * The rule lives in the engine (`csdm/engine/core.py::run_inputs_problem`),
 * which `start_run` / `start_preview` already apply on click. The window used
 * to learn about it only then, in a dialog. This asks the engine the same
 * question (`run_inputs_problem` in `csdm/bridge/host.py`) whenever the
 * settings change, so the buttons can grey themselves out and say why. No
 * copy of the rule in TypeScript: a copy would drift.
 *
 * Coalesced, never timed: while one check is in flight, newer settings wait,
 * and only the latest is asked once it returns. A slider drag therefore costs
 * one round trip at a time, not one per tick.
 */
import { useEffect, useRef, useState } from "react";

import { runCommand } from "../bridge";

/**
 * The engine's sentence, or null when the settings can run -- or when the
 * answer is not known (no reply yet, engine gone). Unknown never blocks: the
 * engine still checks on click, so a missing answer must not lock the user out.
 */
export function useRunInputsProblem(cfg: Record<string, unknown>): string | null {
  const [problem, setProblem] = useState<string | null>(null);
  const latest = useRef(cfg);
  latest.current = cfg;
  const inFlight = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (inFlight.current) return; // the reply's `finally` asks for the latest
    const ask = (sent: Record<string, unknown>) => {
      inFlight.current = true;
      runCommand("run_inputs_problem", { cfg: sent })
        .then((result) => {
          if (!mounted.current || sent !== latest.current) return;
          setProblem(typeof result.problem === "string" ? result.problem : null);
        })
        .catch(() => {
          if (mounted.current && sent === latest.current) setProblem(null);
        })
        .finally(() => {
          inFlight.current = false;
          if (mounted.current && sent !== latest.current) ask(latest.current);
        });
    };
    ask(cfg);
  }, [cfg]);

  return problem;
}
