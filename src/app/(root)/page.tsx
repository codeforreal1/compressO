"use client";
import React from "react";
import dynamic from "next/dynamic";
import { invoke } from "@tauri-apps/api";
import { toast } from "sonner";

import ThemeSwitcher from "@/components/ThemeSwitcher";
import VideoPicker from "@/tauri/VideoPicker";
import { mergeClasses } from "@/utils/tailwind";
import Icon from "@/components/Icon";

function Root() {
  const handleSuccess = async ({ path }: { path: string }) => {
    try {
      console.log(path);
      throw new Error();
      // const result = await invoke("compress", { path });
      // console.log("--Result", result);
    } catch (error) {
      toast.error("Something went wrong...");
    }
  };
  return (
    <div>
      <div className="absolute bottom-4 left-4 z-10">
        <ThemeSwitcher />
      </div>
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
    </div>
  );
}

export default dynamic(() => Promise.resolve(Root), { ssr: false });
