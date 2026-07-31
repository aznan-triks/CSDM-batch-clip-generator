import type { ReactNode } from "react";

import { Tab, TabBar } from "../components/Tab";
import { ICONS } from "../icons";
import "./HudNav.css";

interface HudNavTab<T extends string> {
  id: T;
  label: string;
  icon: ReactNode;
}

interface HudNavProps<T extends string> {
  tabs: HudNavTab<T>[];
  active: T;
  onSelect: (id: T) => void;
  /** The mock's `.navtools` pills. Values come from the caller, which is the
   *  one already inside the settings provider -- this stays presentational. */
  database?: string;
  preset?: string;
}

/**
 * The top nav band (mock `.hud-nav`): brand mark and product line, the tab
 * row, and the mock's `.navtools` status pills on the right.
 *
 * The pills carry REAL settings (`pg_db`, `video_preset`) rather than the
 * mock's invented `csdm` / `ace_pack`: the shape is the mock's, the content is
 * the application's own.
 */
export default function HudNav<T extends string>({
  tabs,
  active,
  onSelect,
  database,
  preset,
}: HudNavProps<T>) {
  return (
    <div className="hud-nav">
      <div className="hud-inner">
        <div className="brand">
          <div className="mark" aria-hidden="true">
            <ICONS.run />
          </div>
          <div>
            <b>CSDM</b>
            <span>BATCH CLIPS</span>
          </div>
        </div>
        <TabBar>
          {tabs.map((tab) => (
            <Tab
              key={tab.id}
              label={tab.label}
              icon={tab.icon}
              active={tab.id === active}
              onSelect={() => onSelect(tab.id)}
            />
          ))}
        </TabBar>
        <div className="navtools">
          <div className="p">
            DB <b>{database || "--"}</b>
          </div>
          <div className="p">
            Preset <b>{preset || "--"}</b>
          </div>
        </div>
      </div>
    </div>
  );
}
