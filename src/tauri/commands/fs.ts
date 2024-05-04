import { FileMetadata } from "@/types/fs";
import { core } from "@tauri-apps/api";

export function getFileMetadata(filePath: string): Promise<FileMetadata> {
  return core.invoke("get_file_metadata", { filePath });
}

export function getImageDimension(
  imagePath: string
): Promise<[number, number]> {
  return core.invoke("get_image_dimension", { imagePath });
}
