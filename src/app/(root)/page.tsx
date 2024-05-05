"use client";
import React from "react";
import dynamic from "next/dynamic";
import { core } from "@tauri-apps/api";
import { toast } from "sonner";
import { SelectItem } from "@nextui-org/select";
import { FileResponse, save } from "@tauri-apps/plugin-dialog";
import { useDisclosure } from "@nextui-org/modal";

import Modal, {
  ModalHeader,
  ModalBody,
  ModalContent,
  ModalFooter,
} from "@/components/Modal";
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
  compressedVideo?: {
    pathRaw?: string | null;
    path?: string | null;
    fileName?: string | null;
    mimeType?: string | null;
    sizeInBytes?: number | null;
    size?: string | null;
    extension?: null | string;
  } | null;
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
  compressedVideo: null,
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
//     "asset://localhost/%2Fhome%2Fniraj%2F.local%2Fshare%2Fcom.compressO.dev%2Fassets%2FTwCAOvBGdHUzAnwPernMm.jpg",

//   thumbnailPathRaw:
//     "/home/niraj/.local/share/com.compressO.dev/assets/TwCAOvBGdHUzAnwPernMm.jpg",
//   isCompressing: false,
//   isCompressionSuccessful: true,
//   compressedVideo: {
//     fileName: "7d4SufnlvuCxSm77Agic7.webm",

//     mimeType: "video/webm",

//     path: "asset://localhost/%2Fhome%2Fniraj%2F.local%2Fshare%2Fcom.compressO.dev%2Fassets%2F7d4SufnlvuCxSm77Agic7.webm",

//     pathRaw:
//       "/home/niraj/.local/share/com.compressO.dev/assets/7d4SufnlvuCxSm77Agic7.webm",

//     size: "172 kB",
//     sizeInBytes: 172,
//     extension: "webm",
//   },
// };

const videoExtensions = Object.keys(extensions?.video);
const presets = Object.keys(compressionPresets);

function Root() {
  const [video, setVideo] = React.useState<Video>(initialState);
  const [convertToExtension, setConvertToExtension] =
    React.useState<keyof typeof extensions.video>("mp4");
  const [presetName, setPresetName] =
    React.useState<keyof typeof compressionPresets>("ironclad");
  const [isDismissModalVisible, setIsDismissModalVisible] =
    React.useState<boolean>(false);

  const { isOpen, onOpenChange, onOpen } = useDisclosure();

  const handleSuccess = async ({ file }: { file: FileResponse }) => {
    if (video?.isCompressing) return;
    try {
      if (!file) {
        toast.error("Invalid file selected.");
        return;
      }

      const fileMetadata = await getFileMetadata(file?.path);

      if (
        !fileMetadata ||
        (typeof fileMetadata?.size === "number" && fileMetadata?.size <= 1000)
      ) {
        toast.error("Invalid file.");
        return;
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
    } catch (error) {
      setVideo(initialState);
      toast.error("Conversion failed. File seems to be corrupted.");
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
      if (!result) {
        throw new Error();
      }
      const compressedVideoMetadata = await getFileMetadata(result?.filePath);
      if (!compressedVideoMetadata) {
        throw new Error();
      }
      setVideo((previousState) => ({
        ...previousState,
        isCompressing: false,
        isCompressionSuccessful: true,
        compressedVideo: {
          fileName: compressedVideoMetadata?.fileName,
          pathRaw: compressedVideoMetadata?.path,
          path: core.convertFileSrc(compressedVideoMetadata?.path ?? ""),
          mimeType: compressedVideoMetadata?.mimeType,
          sizeInBytes: compressedVideoMetadata?.size,
          size: formatBytes(compressedVideoMetadata?.size ?? 0),
          extension: compressedVideoMetadata?.extension,
        },
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

  const reset = () => {
    setVideo(initialState);
  };

  const sizeDiff: number = React.useMemo(
    () =>
      typeof video?.compressedVideo?.sizeInBytes === "number" &&
      typeof video?.sizeInBytes === "number"
        ? (((video?.sizeInBytes ?? 0) -
            (video?.compressedVideo?.sizeInBytes ?? 0)) *
            100) /
          video?.sizeInBytes
        : 0,
    [video]
  );

  const fileNameDisplay =
    (video?.isCompressionSuccessful
      ? `${video?.fileName?.slice(0, -((video?.extension?.length ?? 0) + 1))}.${
          video?.compressedVideo?.extension
        }`
      : video?.fileName) ?? "";

  const handleCompressedVideoSave = async () => {
    try {
      const pathToSave = await save({
        title: "Choose location to save the compressed video.",
        defaultPath: `compressO-${fileNameDisplay}`,
      });
      if (pathToSave) {
        console.log("--", pathToSave);
      }
    } catch (error) {
      console.log(error);
    }
  };

  return (
    <div>
      <div className="absolute top-4 left-4 z-10 flex justify-center items-center">
        <h1 className="mr-2 font-bold bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
          compressO
        </h1>
        <Image src="/logo.png" alt="logo" width={30} />
      </div>
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
                    {fileNameDisplay?.length > 50
                      ? `${fileNameDisplay?.slice(
                          0,
                          20
                        )}...${fileNameDisplay?.slice(-10)}`
                      : fileNameDisplay}
                  </Code>
                  <IconButton
                    iconProps={{ name: "cross", size: 22 }}
                    buttonProps={{
                      disableAnimation: true,
                      size: "sm",
                      onClick: () => {
                        if (video?.isCompressionSuccessful) {
                          onOpen();
                        } else {
                          reset();
                        }
                      },
                    }}
                  />
                </div>
              ) : null}
              {video?.isCompressing ? (
                <div className="relative flex-shrink-0 w-[550px] h-[550px]">
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
                video?.isCompressionSuccessful ? (
                  <section className="animate-appearance-in">
                    <div className="flex justify-center items-center mt-6">
                      <p className="text-4xl font-bold mx-4">{video?.size}</p>
                      <Icon
                        name="curvedArrow"
                        className="text-white rotate-[-65deg] translate-y-[-8px]"
                        size={100}
                      />
                      <p className="text-4xl font-bold mx-4 text-primary">
                        {video?.compressedVideo?.size}
                      </p>
                    </div>
                    {!(sizeDiff <= 0) ? (
                      <p className="block text-7xl text-center text-green-500 mt-5">
                        {sizeDiff.toFixed(2)?.endsWith(".00")
                          ? sizeDiff.toFixed(2)?.slice(0, -3)
                          : sizeDiff.toFixed(2)}
                        %<span className="text-large block">smaller</span>
                      </p>
                    ) : null}
                    <div className="flex justify-center mt-10">
                      <Button
                        className="flex justify-center items-center"
                        color="success"
                        onClick={handleCompressedVideoSave}
                      >
                        save video
                        <Icon name="save" className="text-green-300" />
                      </Button>
                    </div>
                  </section>
                ) : (
                  <>
                    <section className="my-6 flex items-center space-x-4 justify-center gap-4">
                      <div>
                        <p className="italic text-sm text-gray-500">size</p>
                        <h1 className="text-4xl font-black">{video?.size}</h1>
                      </div>
                      <Divider orientation="vertical" className="h-10" />
                      <div>
                        <p className="italic text-sm text-gray-500">
                          extension
                        </p>
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
                            evt?.target
                              ?.value as keyof typeof compressionPresets
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
                    <Button
                      size="lg"
                      color="primary"
                      onClick={handleCompression}
                    >
                      Compress 🤏
                    </Button>
                  </>
                )
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
                "h-[100vh] w-full flex justify-center items-center z-0 flex-col animate-appearance-in",
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
      <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
        <ModalContent className="max-w-[500px]">
          {(closeModal) => (
            <>
              <ModalHeader>Video not saved.</ModalHeader>
              <ModalBody className="gap-0">
                <div className="mb-4">
                  Your compressed video is not saved yet.
                  <span className="block">
                    Are you sure you want to discard it?
                  </span>
                </div>
                <ModalFooter>
                  <Button onClick={closeModal}>Go Back</Button>
                  <Button
                    color="danger"
                    onClick={() => {
                      closeModal();
                      reset();
                    }}
                  >
                    Yes
                  </Button>
                </ModalFooter>
              </ModalBody>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}

export default dynamic(() => Promise.resolve(Root), { ssr: false });
