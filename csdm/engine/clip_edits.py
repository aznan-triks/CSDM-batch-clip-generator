"""Per-clip edits from the EDITING tab, applied to the sequences a run records.

The renderer sends GENERATE's selection as `selected_clips`: one entry per
clip the user kept, addressed by the pair the engine already uses to name a
clip uniquely, `(demo_path, start_tick)` -- the start tick `_build_sequences`
computed, before any edit. An entry may also carry the user's edits:

    before_s          whole seconds recorded before the first kept event
    after_s           whole seconds recorded after the last kept event
    excluded_events   `event_key`s of the events the user took out

A clip with no edit field records exactly as `_build_sequences` built it. A
clip whose every event is excluded is not recorded. Clips that the edits make
overlap in one demo are joined into one recording: filming the same seconds
twice is never what a longer handle meant.

The renderer mirrors this arithmetic to draw the edited clip
(electron/renderer/src/tabs/editing/clipEdits.ts) and must follow it if it
changes. Pure: no engine state, no I/O -- tests/test_clip_edits.py.
"""

EDIT_FIELDS = ("before_s", "after_s", "excluded_events")


def event_key(event):
    """A stable name for one event of a sequence: tick, type and victim.

    Built from what the preview and the run both compute the same way, never
    from a position in a list: the renderer hands it back opaque.
    """
    return f"{int(event.get('tick', 0))}:{event.get('type', 'kill')}:{event.get('victim_sid') or ''}"


def _whole_seconds(entry, field):
    value = entry.get(field)
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0 \
            or int(value) != value:
        raise ValueError(f"selected_clips: `{field}` must be a whole number of seconds >= 0, got {value!r}")
    return int(value)


def normalize_clip_selection(selected_clips):
    """Check GENERATE's selection once, before the run starts. Fail fast.

    None stays None (no selection: every clip is recorded). Returns a list of
    entries with `demo_path`, `start_tick` and only the edit fields present.
    """
    if selected_clips is None:
        return None
    if not isinstance(selected_clips, list):
        raise ValueError("selected_clips must be a list")
    out = []
    for entry in selected_clips:
        if not isinstance(entry, dict) or "demo_path" not in entry or "start_tick" not in entry:
            raise ValueError(f"selected_clips: every entry needs demo_path and start_tick, got {entry!r}")
        clean = {"demo_path": str(entry["demo_path"]), "start_tick": int(entry["start_tick"])}
        for field in ("before_s", "after_s"):
            seconds = _whole_seconds(entry, field)
            if seconds is not None:
                clean[field] = seconds
        excluded = entry.get("excluded_events")
        if excluded:
            if not isinstance(excluded, list):
                raise ValueError("selected_clips: `excluded_events` must be a list of event keys")
            clean["excluded_events"] = [str(k) for k in excluded]
        out.append(clean)
    return out


def _edited(seq, entry, tickrate):
    """One sequence with its entry's edits applied; None when nothing is left."""
    events = seq["events"]
    excluded = set(entry.get("excluded_events") or ())
    kept = [e for e in events if event_key(e) not in excluded]
    if not kept:
        return None
    if not any(f in entry for f in EDIT_FIELDS):
        return seq
    # Unedited sides keep the lead / tail the engine gave the clip, measured
    # from its first / last event -- so excluding the first event moves the
    # start with it, exactly as if the event had never been found.
    first, last = events[0]["tick"], events[-1]["tick"]
    lead = entry["before_s"] * tickrate if "before_s" in entry else first - seq["start_tick"]
    tail = entry["after_s"] * tickrate if "after_s" in entry else seq["end_tick"] - last
    start = max(0, int(kept[0]["tick"] - lead))
    end = max(start + 1, int(kept[-1]["tick"] + tail))
    out = {**seq, "start_tick": start, "end_tick": end, "events": kept}
    types = sorted({e.get("type", "kill") for e in kept})
    out["event_type"] = kept[0].get("type", seq.get("event_type", "kill"))
    if len(types) > 1:
        out["event_types"] = types
    else:
        out.pop("event_types", None)
    return out


def apply_clip_edits(seqs, demo_path, selected_clips, tickrate):
    """The sequences of one demo that a run records, after the user's edits.

    seqs: this demo's sequences as `_build_sequences` returned them.
    selected_clips: the normalized selection (`normalize_clip_selection`);
        None records every sequence untouched.
    """
    if selected_clips is None:
        return seqs
    by_start = {e["start_tick"]: e for e in selected_clips if e["demo_path"] == demo_path}
    edited = []
    for seq in seqs:
        entry = by_start.get(seq["start_tick"])
        if entry is None:
            continue
        clip = _edited(seq, entry, tickrate)
        if clip is not None:
            edited.append(clip)
    edited.sort(key=lambda s: s["start_tick"])
    merged = []
    for clip in edited:
        prev = merged[-1] if merged else None
        if prev is not None and clip["start_tick"] < prev["end_tick"]:
            events = sorted(prev["events"] + clip["events"], key=lambda e: e.get("tick", 0))
            types = sorted({e.get("type", "kill") for e in events})
            merged[-1] = {**prev, "end_tick": max(prev["end_tick"], clip["end_tick"]), "events": events}
            if len(types) > 1:
                merged[-1]["event_types"] = types
        else:
            merged.append(clip)
    return merged
