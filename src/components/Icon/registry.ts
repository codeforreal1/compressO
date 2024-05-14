import React from "react";

import Logo from "@/assets/icons/logo.svg";
import Moon from "@/assets/icons/moon.svg";
import Sun from "@/assets/icons/sun.svg";
import VideoFile from "@/assets/icons/video-file.svg";
import Star from "@/assets/icons/star.svg";
import Cross from "@/assets/icons/cross.svg";
import CurvedArrow from "@/assets/icons/curved-arrow.svg";
import Save from "@/assets/icons/save.svg";
import Tick from "@/assets/icons/tick.svg";
import FileExplorer from "@/assets/icons/file-explorer.svg";
import Play from "@/assets/icons/play.svg";

type SVGAsComponent = React.FC<React.SVGProps<SVGElement>>;

function asRegistry<T extends string>(
  arg: Record<T, SVGAsComponent>
): Record<T, SVGAsComponent> {
  return arg;
}

const registry = asRegistry({
  logo: Logo,
  moon: Moon,
  sun: Sun,
  videoFile: VideoFile,
  star: Star,
  cross: Cross,
  curvedArrow: CurvedArrow,
  save: Save,
  tick: Tick,
  fileExplorer: FileExplorer,
  play: Play,
});

export default registry;
