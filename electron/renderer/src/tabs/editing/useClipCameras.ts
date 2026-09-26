/**
 * Who the camera follows in one EDITING clip, as the run will record it.
 *
 * An unedited clip shows the spans its preview planned. Once edited (an event
 * taken out, a handle moved) the engine plans them again for the edited clip
 * (`clip_cameras` -> `edited_clip_cameras`, core.py) with the calls the run
 * makes -- one source, never re-derived here. Until the answer arrives, or if
 * the engine cannot plan them (its failure is narrated in the console), the
 * preview's spans stay on screen.
 */
import { useEffect, useState } from "react";

import { runCommand } from "../../bridge";
import { cameraSegment, type CameraSegment, type PreviewClip } from "../../motion/useEngineState";
import { clipPayload } from "./clipEdits";

export function useClipCameras(clip: PreviewClip): CameraSegment[] {
  const request = clip.edit === undefined ? null : JSON.stringify(clipPayload(clip));
  const [planned, setPlanned] = useState<{ request: string; cameras: CameraSegment[] } | null>(null);

  useEffect(() => {
    if (request === null) return;
    let stale = false;
    runCommand("clip_cameras", { clip: JSON.parse(request) as Record<string, unknown> })
      .then((result) => {
        if (stale) return;
        const raw = (result.cameras as Array<Record<string, unknown>> | null | undefined) ?? [];
        setPlanned({ request, cameras: raw.map(cameraSegment) });
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [request]);

  if (request !== null && planned?.request === request) return planned.cameras;
  return clip.cameras;
}
