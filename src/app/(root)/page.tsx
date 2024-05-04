"use client";
import React from "react";
import dynamic from "next/dynamic";
import { core } from "@tauri-apps/api";
import { toast } from "sonner";
import { SelectItem } from "@nextui-org/select";

import Button from "@/components/Button";
import Select from "@/components/Select";
import Code from "@/components/Code";
import Spinner from "@/components/Spinner";
import Divider from "@/components/Divider";
import Image from "@/components/Image";
import ThemeSwitcher from "@/components/ThemeSwitcher";
import VideoPicker, { extensions } from "@/tauri/components/VideoPicker";
import { mergeClasses } from "@/utils/tailwind";
import Icon from "@/components/Icon";
import { FileResponse } from "@tauri-apps/plugin-dialog";
import { formatBytes } from "@/utils/fs";
import { compressVideo, generateVideoThumbnail } from "@/tauri/commands/ffmpeg";
import { getFileMetadata, getImageDimension } from "@/tauri/commands/fs";
import IconButton from "@/components/IconButton";

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
  thumbnailDimension?: [number, number] | null;
  isThumbnailGenerating?: boolean;
  extension?: null | string;
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
  thumbnailDimension: null,
  isThumbnailGenerating: false,
  extension: null,
};

function Root() {
  const [video, setVideo] = React.useState<Video>(initialState);

  const handleSuccess = async ({ file }: { file: FileResponse }) => {
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

      // Generate a thumbnail before processing
      const thumbnail = await generateVideoThumbnail(file?.path);
      setVideo((previousState) => ({
        ...previousState,
        thumbnailPathRaw: thumbnail,
        thumbnailPath: core.convertFileSrc(thumbnail),
        isThumbnailGenerating: false,
      }));

      if (thumbnail) {
        const thumbnailDimension = await getImageDimension(thumbnail);
        if (
          Array.isArray(thumbnailDimension) &&
          thumbnailDimension?.length === 2
        ) {
          setVideo((previousState) => ({
            ...previousState,
            thumbnailDimension,
          }));
        }
      }

      // const result = await compressVideo(file?.path);
      // console.log("--Result", result);
    } catch (error) {
      setVideo(initialState);
      toast.error(
        "Conversion failed. File seems to be corrupted. Maybe try again with a different preset?"
      );
    }
  };

  return (
    <div>
      <div className="absolute bottom-4 left-4 z-10">
        <ThemeSwitcher />
      </div>
      {video?.isFileSelected ? (
        <div className="h-[100vh] w-full flex flex-col justify-center items-center ">
          {!video?.isThumbnailGenerating ? (
            <div className="flex flex-col justify-center items-center">
              {video?.fileName ? (
                <div className="flex justify-center items-center mb-2 gap-1">
                  <Code className="ml-auto mr-auto text-center rounded-lg clamp-1 max-w-[20vw]">
                    {video?.fileName}
                  </Code>
                  <IconButton
                    iconProps={{ name: "cross", size: 20 }}
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
              <Image
                alt="video to compress"
                src={video?.thumbnailPath as string}
                className="max-w-[60vw] max-h-[40vh] object-contain border-8 rounded-3xl border-primary"
              />
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
                  defaultSelectedKeys={["einstein"]}
                  radius="lg"
                  selectionMode="single"
                  disallowEmptySelection
                >
                  {["einstein", "newton"].map((val) => (
                    // Right now if we use SelectItem it breaks the code so opting for SelectItem from NextUI directly
                    <SelectItem
                      key={val}
                      value={val}
                      className="flex justify-center items-center"
                      endContent={
                        val === "einstein" ? (
                          <Icon
                            name="star"
                            className="inline-block ml-1 text-yellow-500"
                          />
                        ) : null
                      }
                    >
                      {val}
                    </SelectItem>
                  ))}
                </Select>
                <Divider orientation="vertical" className="h-10" />
                <Select
                  label="convert to"
                  className="w-[300px] flex-shrink-0 rounded-2xl"
                  size="sm"
                  defaultSelectedKeys={
                    extensions.includes(video?.extension as string)
                      ? [video?.extension as string]
                      : []
                  }
                  radius="lg"
                  selectionMode="single"
                  disallowEmptySelection
                >
                  {extensions.map((val) => (
                    // Right now if we use SelectItem it breaks the code so opting for SelectItem from NextUI directly
                    <SelectItem
                      key={val}
                      value={val}
                      className="flex justify-center items-center"
                    >
                      {val}
                    </SelectItem>
                  ))}
                </Select>
              </section>
              <Button size="lg" color="primary">
                Compress 🤏
              </Button>
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
                className={mergeClasses(["text-black1 dark:text-gray1"])}
                size={70}
              />
              <p className="italic text-sm mt-4">
                Click anywhere to select a video
              </p>
            </div>
          )}
        </VideoPicker>
      )}
    </div>
  );
}

export default dynamic(() => Promise.resolve(Root), { ssr: false });
