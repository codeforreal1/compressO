import { CompressionResult } from "@/types/compression";
import { FileMetadata } from "@/types/fs";
import { core } from "@tauri-apps/api";

export function compressVideo({
  videoPath,
  convertToExtension,
  presetName,
}: {
  videoPath: string;
  convertToExtension?: string;
  presetName?: string;
}): Promise<CompressionResult> {
  return core.invoke("compress_video", {
    videoPath,
    convertToExtension: convertToExtension ?? "mp4",
    presetName: presetName ?? "ironclad",
  });
}

export function generateVideoThumbnail(videoPath: string): Promise<string> {
  return core.invoke("generate_video_thumbnail", { videoPath });
}

export function getFileMetadata(filePath: string): Promise<FileMetadata> {
  return core.invoke("get_file_metadata", { filePath });
}
