/**
 * A big number tile: an icon, a title, the value large with its unit, and
 * minus / plus buttons. The value itself is a slider (arrow keys, wheel) so the
 * tile is operable without aiming at the small buttons.
 *
 * Generic: the card passes the art, the words and the setter; the tile only
 * clamps a step to `min`..`max`.
 */
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";

import "./SmallCard.css";

interface CountTileProps {
  icon: ReactNode;
  title: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  /** A word shown instead of the number for one special value, e.g. 0 = "auto". */
  special?: { value: number; word: string };
  /** Line under the value. */
  caption?: ReactNode;
  tip?: string;
  onChange: (value: number) => void;
}

export default function SmallCardCountTile({
  icon,
  title,
  value,
  unit,
  min,
  max,
  special,
  caption,
  tip,
  onChange,
}: CountTileProps) {
  const clamp = (v: number) => Math.max(min, Math.min(max, Math.round(v)));
  const step = (by: number) => {
    const next = clamp(value + by);
    if (next !== value) onChange(next);
  };
  const valueRef = useRef<HTMLSpanElement>(null);
  const latest = useRef(step);
  latest.current = step;

  // A wheel listener that may cancel the scroll: React's own is passive.
  useEffect(() => {
    const node = valueRef.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      latest.current(event.deltaY < 0 ? 1 : -1);
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, []);

  function onKeyDown(event: KeyboardEvent) {
    const by = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[event.key];
    if (by === undefined) return;
    event.preventDefault();
    step(by);
  }

  const isSpecial = special && special.value === value;
  return (
    <div className={isSpecial ? "sc-count special" : "sc-count"} title={tip}>
      <span className="sc-count-h">
        <span className="sc-count-ic" aria-hidden="true">
          {icon}
        </span>
        <b className="sc-count-t">{title}</b>
      </span>
      <span className="sc-count-row">
        <span
          ref={valueRef}
          className="sc-count-v"
          role="slider"
          tabIndex={0}
          aria-label={title}
          aria-valuenow={value}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuetext={isSpecial ? special.word : `${value}${unit}`}
          onKeyDown={onKeyDown}
        >
          {isSpecial ? (
            special.word
          ) : (
            <>
              {value}
              <small>{unit}</small>
            </>
          )}
        </span>
        <span className="sc-count-btns">
          <button type="button" aria-label={`${title} minus one`} disabled={value <= min} onClick={() => step(-1)}>
            −
          </button>
          <button type="button" aria-label={`${title} plus one`} disabled={value >= max} onClick={() => step(1)}>
            +
          </button>
        </span>
      </span>
      {caption && <small className="sc-count-cap">{caption}</small>}
    </div>
  );
}
