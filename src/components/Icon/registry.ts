import React from "react";

import Moon from "@/assets/icons/moon.svg";
import Sun from "@/assets/icons/sun.svg";
import VideoFile from "@/assets/icons/video-file.svg";

type SVGAsComponent = React.FC<React.SVGProps<SVGElement>>;

function asRegistry<T extends string>(
  arg: Record<T, SVGAsComponent>
): Record<T, SVGAsComponent> {
  return arg;
}

const registry = asRegistry({
  moon: Moon,
  sun: Sun,
  videoFile: VideoFile,
});

export default registry;
