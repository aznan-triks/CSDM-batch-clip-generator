import { useEngineSelector } from "../motion/useEngineState";
import WeaponBand from "../weapon/WeaponBand";
import type { WeaponBandProps } from "../weapon/WeaponBand";

/**
 * The weapon band, fed from the engine store.
 *
 * Its own component so that the three slices it shows -- the progress line,
 * the busy flag and the summary sentence -- are read HERE and nowhere above.
 * A `progress` tick used to re-render AppShell, and with it every kept-alive
 * tab; now it only re-renders this band.
 */
export default function EngineWeaponBand({
  buttonRef,
}: {
  buttonRef: WeaponBandProps["buttonRef"];
}) {
  const progress = useEngineSelector((s) => s.progress);
  const busy = useEngineSelector((s) => s.busy);
  const summaryText = useEngineSelector((s) => s.summary?.text);
  return (
    <WeaponBand
      status={progress ?? (busy ? "working…" : "idle")}
      counter={summaryText ?? ""}
      buttonRef={buttonRef}
    />
  );
}
