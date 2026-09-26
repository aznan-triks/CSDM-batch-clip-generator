/**
 * What the SETTINGS cards' models are made of: a text setting and an on/off
 * setting, each carrying its key, its words and its tooltip once, and the
 * two ways every style draws a text setting (a box, a word).
 */
import Field from "../../components/Field";
import PathField from "../../components/PathField";
import { TextWord, pathTail } from "../../components/cardstyle/StyledParts";
import SettingControl from "../../settings/SettingControl";
import { useSetting } from "../../settings/store";

export interface TextSetting {
  key: string;
  /** DOM id of its box: one box per key on screen. */
  id: string;
  label: string;
  value: string;
  set: (value: string) => void;
  tip?: string;
  placeholder?: string;
  /** A path, and which native picker its Browse opens. */
  path?: "file" | "dir";
  password?: boolean;
  /** What an empty value means, in a few words ("auto-detected"). */
  empty: string;
}

export interface ToggleSetting {
  key: string;
  label: string;
  on: boolean;
  tip: string;
  toggle: () => void;
}

export function useText(spec: Omit<TextSetting, "value" | "set">): TextSetting {
  const [raw, set] = useSetting<string>(spec.key);
  return { ...spec, value: typeof raw === "string" ? raw : raw == null ? "" : String(raw), set };
}

export function useToggle(key: string, label: string, tip: string): ToggleSetting {
  const [raw, set] = useSetting<boolean>(key);
  return { key, label, on: !!raw, tip, toggle: () => set(!raw) };
}

/** The setting's own box (a path box with Browse, or a text box). */
export function TextBox({ t, bare }: { t: TextSetting; bare?: boolean }) {
  const label = bare ? undefined : t.label;
  return (
    <SettingControl settingKey={t.key}>
      {t.path ? (
        <PathField id={t.id} label={label} placeholder={t.placeholder} value={t.value} onChange={t.set} mode={t.path} tip={t.tip} />
      ) : (
        <Field
          id={t.id}
          label={label}
          type={t.password ? "password" : "text"}
          placeholder={t.placeholder}
          value={t.value}
          onChange={t.set}
          tip={t.tip}
        />
      )}
    </SettingControl>
  );
}

/** The setting as a sentence word; its box opens under it. */
export function TextToken({ t, tone }: { t: TextSetting; tone?: "alt" }) {
  const shown = t.password ? (t.value ? "••••••" : "") : t.path ? pathTail(t.value) : t.value;
  return (
    <SettingControl settingKey={t.key}>
      <TextWord label={t.label} shown={shown} empty={t.empty} tip={t.tip} tone={tone}>
        <TextBox t={t} bare />
      </TextWord>
    </SettingControl>
  );
}

/* Flat glyphs, one stroke style (drawn by .sx-tile-ic / .st-ic). */
export const GLYPHS = {
  server: <path d="M4 5h16v5H4zM4 14h16v5H4zM7.5 7.5h.01M7.5 16.5h.01" />,
  port: <path d="M8 3v5M16 3v5M5 8h14v4a7 7 0 0 1-14 0zM12 19v2" />,
  db: <path d="M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />,
  user: <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0" />,
  key: <path d="M14 10a4 4 0 1 0-3.5 4L9 16H7v2H5v2H3v-3l7-7M16 7h.01" />,
  plug: <path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4" />,
  app: <path d="M4 5h16v14H4zM4 9h16M7 7h.01" />,
  cfg: <path d="M5 4h10l4 4v12H5zM15 4v4h4M8 12h8M8 16h5" />,
  film: <path d="M4 5h16v14H4zM8 5v14M16 5v14M4 9h4M4 15h4M16 9h4M16 15h4" />,
  join: <path d="M3 7h7v10H3zM14 7h7v10h-7zM10 12h4" />,
  reel: <path d="M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM12 9a1 1 0 1 1 0-.01M8 13h.01M16 13h.01M12 16h.01" />,
  tree: <path d="M4 4h6l2 2h8v5H4zM8 11v7h4M8 15h4M12 13h8v4h-8zM12 17h8v4h-8z" />,
  usb: <path d="M9 2h6v7H9zM7 9h10v7a5 5 0 0 1-10 0zM12 21v1" />,
  home: <path d="M3 11l9-7 9 7v9h-6v-6H9v6H3z" />,
  folder: <path d="M3 6h7l2 2h9v11H3z" />,
  save: <path d="M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6" />,
  load: <path d="M12 3v12M7 10l5 5 5-5M5 20h14" />,
  cpu: <path d="M7 7h10v10H7zM10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4" />,
  window: <path d="M3 4h18v16H3zM3 8h18M13 8v12" />,
  grid: <path d="M4 4h16v16H4zM4 10h16M4 16h16M10 4v16M16 4v16" />,
  tip: <path d="M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM12 11v6M12 7.5h.01" />,
  pin: <path d="M12 3a6 6 0 0 1 6 6c0 5-6 12-6 12S6 14 6 9a6 6 0 0 1 6-6zM12 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />,
  palette: <path d="M12 21a9 9 0 1 1 9-9c0 2-2 3-4 3h-2a2 2 0 0 0-1 3.7c.4.8-.3 2.3-2 2.3zM7.5 12h.01M9.5 7.5h.01M14.5 7.5h.01" />,
  moon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />,
  font: <path d="M4 20 10 4h1l6 16M6.5 14h8M17 20h4" />,
  term: <path d="M3 4h18v16H3zM7 9l3 3-3 3M12 15h5" />,
} as const;

export function Glyph({ g }: { g: keyof typeof GLYPHS }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {GLYPHS[g]}
    </svg>
  );
}
