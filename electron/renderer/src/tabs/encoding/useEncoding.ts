/**
 * The Encoding card's ONE data model: eight keys, their words and tooltips.
 *
 * `videoCodecs` / `audioCodecs` come from `useTables()` (`describe_filters`),
 * never copied here (D20 / R1). `video_preset` and `video_container` have no
 * such table: they are fixed engine enums, declared here like the window's
 * PRESETS_CPU / VIDEO_CONTAINERS.
 */
import { useSetting } from "../../settings/store";
import { useTables } from "../../settings/useTables";
import {
  useChoice,
  useNum,
  useText,
  type ChoiceSetting,
  type NumSetting,
  type TextSetting,
} from "../videoKit/settings";

/** `video_preset` values, exactly as the window's PRESETS_CPU lists them (fastest first). */
export const VIDEO_PRESETS = [
  "ultrafast",
  "superfast",
  "veryfast",
  "faster",
  "fast",
  "medium",
  "slow",
  "slower",
  "veryslow",
] as const;
export type VideoPreset = (typeof VIDEO_PRESETS)[number];

/** `video_container` values, exactly as VIDEO_CONTAINERS lists them. */
export const VIDEO_CONTAINERS = ["mp4", "avi", "mkv", "mov", "webm"] as const;
export type VideoContainer = (typeof VIDEO_CONTAINERS)[number];

export const TIPS = {
  videoCodec: "FFmpeg video encoder (e.g. libx264 = CPU H.264, h264_nvenc = NVIDIA GPU encoder)",
  crf: "Constant Rate Factor: video quality 0-51, lower = better quality & larger file (18 ~ lossless)",
  preset: "FFmpeg encode speed vs. compression: faster presets encode quicker but yield larger files",
  container: "Output video container format (MP4 recommended for broad compatibility)",
  audioCodec: "FFmpeg audio encoder used for the output track (e.g. aac, mp3, copy)",
  audioBitrate: "Audio bitrate in kilobits per second (e.g. 192, 256, 320)",
  ffmpegIn: "Raw FFmpeg flags inserted before the input (-i) file. Advanced/optional",
  ffmpegOut: "Raw FFmpeg flags inserted before the output file. Advanced/optional",
} as const;

/** A codec: free text in the config, offered from the tables' list. */
export interface CodecSetting {
  key: string;
  value: string;
  options: string[];
  label: string;
  tip: string;
  set: (codec: string) => void;
}

export interface EncodingModel {
  videoCodec: CodecSetting;
  crf: NumSetting;
  preset: ChoiceSetting<VideoPreset>;
  container: ChoiceSetting<VideoContainer>;
  audioCodec: CodecSetting;
  audioBitrate: NumSetting;
  ffmpegIn: TextSetting;
  ffmpegOut: TextSetting;
  /** "visually lossless" / "good" / … for the current CRF. */
  crfWords: string;
}

export function crfWords(crf: number): string {
  if (crf <= 0) return "lossless";
  if (crf <= 18) return "visually lossless";
  if (crf <= 23) return "good";
  if (crf <= 28) return "fair";
  return "low";
}

function useCodec(key: string, label: string, tip: string, options: string[]): CodecSetting {
  const [raw, set] = useSetting<string>(key);
  return { key, value: raw ?? "", options, label, tip, set };
}

export function useEncoding(): EncodingModel {
  const { tables } = useTables();
  const crf = useNum("crf", { label: "CRF", min: 0, max: 51, fallback: 18, tip: TIPS.crf });
  return {
    videoCodec: useCodec("video_codec", "Codec", TIPS.videoCodec, tables?.videoCodecs ?? []),
    crf,
    preset: useChoice("video_preset", VIDEO_PRESETS, "medium", "Preset", TIPS.preset),
    container: useChoice("video_container", VIDEO_CONTAINERS, "mp4", "Container", TIPS.container),
    audioCodec: useCodec("audio_codec", "Audio codec", TIPS.audioCodec, tables?.audioCodecs ?? []),
    audioBitrate: useNum("audio_bitrate", { label: "Audio bitrate", unit: " kbps", min: 32, max: 512, step: 16, fallback: 256, tip: TIPS.audioBitrate }),
    ffmpegIn: useText("ffmpeg_input_params", "FFmpeg input params", TIPS.ffmpegIn),
    ffmpegOut: useText("ffmpeg_output_params", "FFmpeg output params", TIPS.ffmpegOut),
    crfWords: crfWords(crf.value),
  };
}
