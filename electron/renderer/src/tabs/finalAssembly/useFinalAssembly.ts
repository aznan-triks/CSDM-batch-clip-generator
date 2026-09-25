/**
 * The Final Assembly card's ONE data model: its four keys, their words and
 * tooltips, and the sentence that says what the batch will do at its end.
 */
import { useBool, useText, type BoolSetting, type TextSetting } from "../videoKit/settings";

export interface FinalAssemblyModel {
  assemble: BoolSetting;
  concat: BoolSetting;
  deleteSources: BoolSetting;
  output: TextSetting;
  /** The file name the assembled video gets (the placeholder while the box is blank). */
  fileName: string;
  summary: string;
}

export const TIPS = {
  assemble: "Concatenates all captured clips into a single video file upon job completion",
  deleteSources: "Deletes the original per-clip files once the assembled video is created. Requires assembly enabled",
  concat: "Combines clips from the same play/sequence into one before final assembly",
  output: "Name of the final assembled video file (e.g. assembled.mp4)",
} as const;

const PLACEHOLDER = "assembled.mp4";

export function assemblySummary(assemble: boolean, concat: boolean, deleteSources: boolean, fileName: string): string {
  const joined = concat ? "Clips of one sequence are joined first" : "Each clip stays its own file";
  if (!assemble) return `${joined}; no final video is made.`;
  const then = deleteSources ? "then the source clips are deleted" : "the source clips are kept";
  return `${joined}, then everything is joined into ${fileName}; ${then}.`;
}

export function useFinalAssembly(): FinalAssemblyModel {
  const assemble = useBool("assemble_after", "Assemble at the end", TIPS.assemble);
  const concat = useBool("concatenate_sequences", "Join sequences", TIPS.concat);
  const deleteSources = useBool("delete_after_assemble", "Delete sources", TIPS.deleteSources);
  const output = useText("assemble_output", "Output filename", TIPS.output, PLACEHOLDER);
  const fileName = output.value.trim() || PLACEHOLDER;
  return {
    assemble,
    concat,
    deleteSources,
    output,
    fileName,
    summary: assemblySummary(assemble.on, concat.on, deleteSources.on, fileName),
  };
}
