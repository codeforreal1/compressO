"use client";
import React from "react";
import dynamic from "next/dynamic";
import { core } from "@tauri-apps/api";
import { toast } from "sonner";
import { SelectItem } from "@nextui-org/select";

import Progress from "@/components/Progress";
import Button from "@/components/Button";
import Select from "@/components/Select";
import Code from "@/components/Code";
import Spinner from "@/components/Spinner";
import Divider from "@/components/Divider";
import Image from "@/components/Image";
import ThemeSwitcher from "@/components/ThemeSwitcher";
import VideoPicker from "@/tauri/components/VideoPicker";
import { mergeClasses } from "@/utils/tailwind";
import Icon from "@/components/Icon";
import { FileResponse } from "@tauri-apps/plugin-dialog";
import { formatBytes } from "@/utils/fs";
import { compressVideo, generateVideoThumbnail } from "@/tauri/commands/ffmpeg";
import { getFileMetadata, getImageDimension } from "@/tauri/commands/fs";
import IconButton from "@/components/IconButton";
import { compressionPresets, extensions } from "@/types/compression";

type Video = {
  isFileSelected: boolean;
  pathRaw?: string | null;
  path?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  sizeInBytes?: number | null;
  size?: string | null;
  thumbnailPathRaw?: string | null;
  thumbnailPath?: string | null;
  isThumbnailGenerating?: boolean;
  extension?: null | string;
  isCompressing?: boolean;
  isCompressionSuccessful?: boolean;
};

const initialState: Video = {
  isFileSelected: false,
  pathRaw: null,
  path: null,
  fileName: null,
  mimeType: null,
  sizeInBytes: null,
  size: null,
  thumbnailPathRaw: null,
  thumbnailPath: null,
  isThumbnailGenerating: false,
  extension: null,
  isCompressing: false,
  isCompressionSuccessful: false,
};

// const initialState: Video = {
//   extension: "mov",

//   fileName:
//     "copy_34992E05-461C-4F84-8447-FA4B3F3452DCasasasasasasasasasasasasasaasaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.mov",

//   isFileSelected: true,

//   isThumbnailGenerating: false,

//   mimeType: "video/quicktime",

//   path: "asset://localhost/%2Fhome%2Fniraj%2FDownloads%2Fcopy_34992E05-461C-4F84-8447-FA4B3F3452DC.mov",

//   pathRaw:
//     "/home/niraj/Downloads/copy_34992E05-461C-4F84-8447-FA4B3F3452DC.mov",

//   size: "70.9 MB",

//   sizeInBytes: 70872137,

//   thumbnailPath:
//     "asset://localhost/%2Fhome%2Fniraj%2F.local%2Fshare%2Fcom.compressO.dev%2Fassets%2FCUczX99IBohV54nztIuKC.jpg",

//   thumbnailPathRaw:
//     "/home/niraj/.local/share/com.compressO.dev/assets/CUczX99IBohV54nztIuKC.jpg",
//   isCompressing: true,
// };

const videoExtensions = Object.keys(extensions?.video);
const presets = Object.keys(compressionPresets);

function Root() {
  const [video, setVideo] = React.useState<Video>(initialState);
  const [convertToExtension, setConvertToExtension] =
    React.useState<keyof typeof extensions.video>("mp4");
  const [presetName, setPresetName] =
    React.useState<keyof typeof compressionPresets>("ironclad");

  const handleSuccess = async ({ file }: { file: FileResponse }) => {
    if (video?.isCompressing) return;
    try {
      if (!file) {
        toast.error("Invalid file selected.");
        return;
      }

      const fileMetadata = await getFileMetadata(file?.path);

      if (!fileMetadata) {
        toast.error("Invalid file.");
      }

      setVideo({
        isFileSelected: true,
        pathRaw: file?.path,
        path: core.convertFileSrc(file?.path),
        fileName: fileMetadata?.fileName,
        mimeType: fileMetadata?.mimeType,
        sizeInBytes: fileMetadata?.size,
        size: formatBytes(fileMetadata?.size ?? 0),
        isThumbnailGenerating: true,
        extension: fileMetadata?.extension,
      });
      if (fileMetadata?.extension) {
        setConvertToExtension(
          fileMetadata?.extension as keyof (typeof extensions)["video"]
        );
      }

      // Generate a thumbnail before processing
      const thumbnail = await generateVideoThumbnail(file?.path);
      setVideo((previousState) => ({
        ...previousState,
        thumbnailPathRaw: thumbnail,
        thumbnailPath: core.convertFileSrc(thumbnail),
        isThumbnailGenerating: false,
      }));
    } catch (error) {
      setVideo(initialState);
      toast.error(
        "Conversion failed. File seems to be corrupted. Maybe try again with a different preset?"
      );
    }
  };

  const handleCompression = async () => {
    if (video?.isCompressing) return;
    setVideo((previousState) => ({
      ...previousState,
      isCompressing: true,
    }));
    try {
      const result = await compressVideo({
        videoPath: video?.pathRaw as string,
        convertToExtension: convertToExtension ?? "mp4",
        presetName,
      });
      console.log("--Result", result);
      setVideo((previousState) => ({
        ...previousState,
        isCompressing: false,
        isCompressionSuccessful: true,
      }));
    } catch (error) {
      toast.error("Something went wrong during compression.");
      setVideo((previousState) => ({
        ...previousState,
        isCompressing: false,
        isCompressionSuccessful: false,
      }));
    }
  };

  return (
    <div>
      <div className="absolute bottom-4 left-4 z-10">
        <ThemeSwitcher />
      </div>
      {video?.isFileSelected ? (
        <div className="h-[100vh] w-full flex flex-col justify-center items-center">
          {!video?.isThumbnailGenerating ? (
            <div className="flex flex-col justify-center items-center">
              {video?.fileName && !video?.isCompressing ? (
                <div className={`flex justify-center items-center mb-2 gap-1`}>
                  <Code className="ml-auto mr-auto text-center rounded-lg">
                    {video?.fileName?.length > 50
                      ? `${video?.fileName?.slice(
                          0,
                          20
                        )}...${video?.fileName?.slice(-10)}`
                      : video?.fileName}
                  </Code>
                  <IconButton
                    iconProps={{ name: "cross", size: 22 }}
                    buttonProps={{
                      disableAnimation: true,
                      size: "sm",
                      onClick: () => {
                        setVideo(initialState);
                      },
                    }}
                  />
                </div>
              ) : null}
              {video?.isCompressing ? (
                <div className="relative flex-shrink-0 w-[550px] h-[550px] animate-appearance-in">
                  <Progress
                    isIndeterminate
                    classNames={{
                      base: "absolute top-0 left-0 translate-x-[-25px] translate-y-[-25px]",
                      svg: "w-[550px] h-[550px] drop-shadow-md",
                      indicator: "stroke-primary stroke-1",
                      track: "stroke-transparent stroke-1",
                      value: "text-3xl font-semibold text-primary",
                    }}
                    strokeWidth={2}
                  />
                  <Image
                    alt="video to compress"
                    src={video?.thumbnailPath as string}
                    className="max-w-[60vw] max-h-[40vh] object-cover rounded-3xl animate-pulse"
                    style={{
                      width: "500px",
                      height: "500px",
                      minWidth: "500px",
                      minHeight: "500px",
                      borderRadius: "50%",
                      transform: "scale(0.9)",
                      flexShrink: 0,
                    }}
                  />
                  <p className="italic text-sm mt-4 text-gray-500 text-center animate-pulse">
                    compressing...
                    {convertToExtension === "webm" ? (
                      <span className="block">
                        webm conversion takes longer than the other formats.
                      </span>
                    ) : null}
                  </p>
                </div>
              ) : (
                <Image
                  alt="video to compress"
                  src={video?.thumbnailPath as string}
                  className="max-w-[60vw] max-h-[40vh] object-contain border-8 rounded-3xl border-primary"
                />
              )}
              {!video?.isCompressing ? (
                <>
                  <section className="my-6 flex items-center space-x-4 justify-center gap-4">
                    <div>
                      <p className="italic text-sm text-gray-500">size</p>
                      <h1 className="text-4xl font-black">{video?.size}</h1>
                    </div>
                    <Divider orientation="vertical" className="h-10" />
                    <div>
                      <p className="italic text-sm text-gray-500">extension</p>
                      <h1 className="text-4xl font-black">
                        {video?.extension ?? "-"}
                      </h1>
                    </div>
                  </section>
                  <Divider />
                  <section className="my-8 flex justify-center items-center gap-4">
                    <Select
                      label="compression preset"
                      className="w-[300px] flex-shrink-0 rounded-2xl"
                      size="sm"
                      selectedKeys={[presetName]}
                      onChange={(evt) =>
                        setPresetName(
                          evt?.target?.value as keyof typeof compressionPresets
                        )
                      }
                      radius="lg"
                      selectionMode="single"
                      disallowEmptySelection
                    >
                      {presets?.map((preset) => (
                        // Right now if we use SelectItem it breaks the code so opting for SelectItem from NextUI directly
                        <SelectItem
                          key={preset}
                          value={preset}
                          className="flex justify-center items-center"
                          endContent={
                            preset === compressionPresets.ironclad ? (
                              <Icon
                                name="star"
                                className="inline-block ml-1 text-yellow-500"
                              />
                            ) : null
                          }
                        >
                          {preset}
                        </SelectItem>
                      ))}
                    </Select>
                    <Divider orientation="vertical" className="h-10" />
                    <Select
                      label="convert to"
                      className="w-[300px] flex-shrink-0 rounded-2xl"
                      size="sm"
                      value={convertToExtension}
                      selectedKeys={[convertToExtension]}
                      onChange={(evt) =>
                        setConvertToExtension(
                          evt?.target?.value as keyof typeof extensions.video
                        )
                      }
                      radius="lg"
                      selectionMode="single"
                      disallowEmptySelection
                    >
                      {videoExtensions?.map((ext) => (
                        // Right now if we use SelectItem it breaks the code so opting for SelectItem from NextUI directly
                        <SelectItem
                          key={ext}
                          value={ext}
                          className="flex justify-center items-center"
                        >
                          {ext}
                        </SelectItem>
                      ))}
                    </Select>
                  </section>
                  <Button size="lg" color="primary" onClick={handleCompression}>
                    Compress 🤏
                  </Button>
                </>
              ) : null}
            </div>
          ) : (
            <Spinner size="lg" />
          )}
        </div>
      ) : (
        <VideoPicker onSuccess={handleSuccess}>
          {({ onClick }) => (
            <div
              role="button"
              tabIndex={0}
              className={mergeClasses([
                "h-[100vh] w-full flex justify-center items-center z-0 flex-col",
              ])}
              onClick={onClick}
            >
              <Icon
                name={"videoFile"}
                className={mergeClasses(["text-gray-500 dark:text-gray-500"])}
                size={70}
              />
              <p className="italic text-sm mt-4 text-gray-500 text-center">
                click anywhere to select a video
              </p>
            </div>
          )}
        </VideoPicker>
      )}
    </div>
  );
}

export default dynamic(() => Promise.resolve(Root), { ssr: false });
