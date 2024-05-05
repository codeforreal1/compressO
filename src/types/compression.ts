export type CompressionResult = {
  fileName: string;
  filePath: string;
};

export const extensions = {
  video: { mp4: "mp4", mov: "mov", mkv: "mkv", webm: "webm", avi: "avi" },
} as const;

export const compressionPresets = {
  ironclad: "ironclad",
  thunderbolt: "thunderbolt",
} as const;
