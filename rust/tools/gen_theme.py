"""Generates csdm-core/src/theme_v12.rs from the 3.5 stylesheets (ticket 11 « Thème V12 »).

Replays the CSS cascade of the 3.5 window for the custom properties the Rust
shell paints with: the four sheets in the order main.tsx loads them
(mock-v12.css, mock-bridge.css, tokens.css, grounds.css), `:root` rules first,
then the `:root[data-mode=...]` / `:root[data-ground=...]` rules (higher
specificity) in load order. `var()` and `color-mix(in srgb, A p%, B)` are
resolved; a colour that mixes the user's accent stays symbolic (pct + other
colour) and is finished at run time, since the accent is a setting.

Usage (from rust/):  python tools/gen_theme.py ..            # check only
                     python tools/gen_theme.py .. --write    # rewrite the module
The check mode fails when the committed module differs from a fresh run.
"""
import re
import sys
from pathlib import Path

SHEETS = ["mock-v12.css", "mock-bridge.css", "tokens.css", "grounds.css"]
THEME_DIR = Path("electron/renderer/src/theme")
OUT = Path("rust/csdm-core/src/theme_v12.rs")
# Light ground + the four night grounds of `_BG_PRESETS` (csdm/theme.py), as theme/mode.ts maps them.
GROUNDS = [("white", "light"), ("dark", "dark"), ("amoled", "dark"), ("deepblue", "dark"), ("terminal", "dark")]
ACCENT_VARS = {"--accent", "--gold", "--holo", "--holo-color"}
TOKENS = [
    "page-0", "page-1", "txt", "txt-hi", "muted", "faint", "solid", "surface", "surface-2", "band",
    "border", "hair", "hair-2", "tile-fill", "tile-bevel", "tile-border", "glow-in", "glow-out",
    "amb-a", "amb-b", "amb-c", "lime", "lime-ink", "lime-glow", "emerald", "amber", "rose", "blue-2", "accent-soft",
]
ACCENT_PRESETS_TS = Path("electron/renderer/src/theme/accent.ts")


def rules(css):
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", css):
        sel = " ".join(m.group(1).split())
        decls = {}
        for d in m.group(2).split(";"):
            if ":" in d and d.strip().startswith("--"):
                k, v = d.split(":", 1)
                decls[k.strip()] = " ".join(v.split())
        if decls:
            yield sel, decls


def cascade(root, mode, ground):
    """Custom properties in force on <html data-mode=mode data-ground=ground>."""
    low, high = {}, {}
    for name in SHEETS:
        for sel, decls in rules((root / THEME_DIR / name).read_text(encoding="utf-8")):
            for s in (x.strip() for x in sel.split(",")):
                if s == ":root":
                    low.update(decls)
                elif s in (f':root[data-mode="{mode}"]', f':root[data-ground="{ground}"]'):
                    high.update(decls)
    return {**low, **high}


def hex_rgba(h):
    h = h.lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 255)


def parse_color(v):
    v = v.strip()
    if v == "transparent":
        return (0, 0, 0, 0)
    if v.startswith("#"):
        return hex_rgba(v)
    m = re.fullmatch(r"rgba?\(([^)]*)\)", v)
    if m:
        p = [x.strip() for x in m.group(1).split(",")]
        a = float(p[3]) if len(p) > 3 else 1.0
        return (int(p[0]), int(p[1]), int(p[2]), round(a * 255))
    if v == "#fff" or v == "white":
        return (255, 255, 255, 255)
    raise ValueError(f"unsupported colour: {v}")


def mix(a, pa, b):
    """color-mix(in srgb, a pa%, b): premultiplied interpolation, as browsers do."""
    t = pa / 100.0
    alpha = a[3] / 255 * t + b[3] / 255 * (1 - t)
    if alpha == 0:
        return (0, 0, 0, 0)
    ch = [(a[i] * a[3] / 255 * t + b[i] * b[3] / 255 * (1 - t)) / alpha for i in range(3)]
    return (round(ch[0]), round(ch[1]), round(ch[2]), round(alpha * 255))


def resolve(props, value, depth=0):
    """A colour tuple, or ("accent", pct, other) for a mix with the user's accent."""
    if depth > 20:
        raise ValueError(f"var() loop at {value}")
    value = value.strip()
    m = re.fullmatch(r"var\((--[\w-]+)(?:,\s*(.*))?\)", value)
    if m:
        if m.group(1) in ACCENT_VARS:
            return ("accent", 100, (0, 0, 0, 0))
        if m.group(1) in props:
            return resolve(props, props[m.group(1)], depth + 1)
        return resolve(props, m.group(2), depth + 1)
    m = re.fullmatch(r"color-mix\(in srgb,\s*(.+?)\s+([\d.]+)%\s*,\s*(.+)\)", value)
    if m:
        a, pct, b = resolve(props, m.group(1), depth + 1), float(m.group(2)), resolve(props, m.group(3), depth + 1)
        if isinstance(a, tuple) and a and a[0] == "accent":
            if isinstance(b, tuple) and b and b[0] == "accent":
                return ("accent", a[1], (0, 0, 0, 0))
            return ("accent", a[1] * pct / 100, b)
        if isinstance(b, tuple) and b and b[0] == "accent":
            raise ValueError(f"accent as second colour unsupported: {value}")
        return mix(a, pct, b)
    return parse_color(value)


def accent_presets(root):
    text = (root / ACCENT_PRESETS_TS).read_text(encoding="utf-8")
    return re.findall(r'\{ name: "(\w+)", hex: "(#[0-9A-Fa-f]{6})" \}', text)


def rust_color(c):
    if c[0] == "accent":
        o = c[2]
        return f"Tone::Accent {{ pct: {c[1]:.1f}, other: [{o[0]}, {o[1]}, {o[2]}, {o[3]}] }}"
    return f"Tone::Rgba([{c[0]}, {c[1]}, {c[2]}, {c[3]}])"


def generate(root):
    out = [
        "// @generated by rust/tools/gen_theme.py from electron/renderer/src/theme/*.css -- DO NOT EDIT.",
        "//! V12 palette per ground, resolved from the 3.5 stylesheets' cascade.",
        "//! Regenerate: `python tools/gen_theme.py .. --write` (from rust/).",
        "",
        "/// A colour of the palette: fixed, or a share of the user's accent over another colour.",
        "#[derive(Clone, Copy, Debug, PartialEq)]",
        "pub enum Tone { Rgba([u8; 4]), Accent { pct: f32, other: [u8; 4] } }",
        "",
        "#[derive(Clone, Copy, Debug, PartialEq)]",
        "pub struct Palette {",
        "    pub ground: &'static str,",
        "    pub dark: bool,",
    ]
    out += [f"    pub {t.replace('-', '_')}: Tone," for t in TOKENS]
    out += ["}", "", "pub const GROUNDS: [Palette; %d] = [" % len(GROUNDS)]
    for ground, mode in GROUNDS:
        props = cascade(root, mode, ground)
        out.append("    Palette {")
        out.append(f'        ground: "{ground}",')
        out.append(f"        dark: {'true' if mode == 'dark' else 'false'},")
        for t in TOKENS:
            if f"--{t}" not in props:
                raise SystemExit(f"--{t} not defined for ground {ground}")
            out.append(f"        {t.replace('-', '_')}: {rust_color(resolve(props, props['--' + t]))},")
        out.append("    },")
    out.append("];")
    presets = accent_presets(root)
    out += ["", "/// `theme/accent.ts::ACCENT_PRESETS`: (name, hex). The first is the default.",
            f"pub const ACCENT_PRESETS: [(&str, &str); {len(presets)}] = ["]
    out += [f'    ("{n}", "{h}"),' for n, h in presets]
    out += ["];", ""]
    return "\n".join(out)


def main():
    root = Path(sys.argv[1] if len(sys.argv) > 1 else "..").resolve()
    text = generate(root)
    target = root / OUT
    if "--write" in sys.argv:
        target.write_text(text, encoding="utf-8", newline="\n")
        print(f"written {target}")
    elif not target.exists() or target.read_text(encoding="utf-8") != text:
        sys.exit(f"{target} is out of date: run tools/gen_theme.py .. --write")
    else:
        print("theme module up to date")


if __name__ == "__main__":
    main()
