import React from 'react'

import Cross from '@/assets/icons/cross.svg?react'
import CurvedArrow from '@/assets/icons/curved-arrow.svg?react'
import DragAndDrop from '@/assets/icons/drag-and-drop.svg?react'
import Error from '@/assets/icons/error.svg?react'
import Expand from '@/assets/icons/expand.svg?react'
import FileExplorer from '@/assets/icons/file-explorer.svg?react'
import FlipHorizontal from '@/assets/icons/flip-horizontal.svg?react'
import FlipVertical from '@/assets/icons/flip-vertical.svg?react'
import Github from '@/assets/icons/github.svg?react'
import Info from '@/assets/icons/info.svg?react'
import Logo from '@/assets/icons/logo.svg?react'
import LowResHeart from '@/assets/icons/low-res-heart.svg?react'
import Moon from '@/assets/icons/moon.svg?react'
import Play from '@/assets/icons/play.svg?react'
import Question from '@/assets/icons/question.svg?react'
import Redo from '@/assets/icons/redo.svg?react'
import ResetZoom from '@/assets/icons/reset-zoom.svg?react'
import RotateLeft from '@/assets/icons/rotate-left.svg?react'
import Save from '@/assets/icons/save.svg?react'
import Setting from '@/assets/icons/setting.svg?react'
import Star from '@/assets/icons/star.svg?react'
import Sun from '@/assets/icons/sun.svg?react'
import Tick from '@/assets/icons/tick.svg?react'
import Trash from '@/assets/icons/trash.svg?react'
import VideoFile from '@/assets/icons/video-file.svg?react'
import Warning from '@/assets/icons/warning.svg?react'

type SVGAsComponent = React.FunctionComponent<React.SVGProps<SVGSVGElement>>

function asRegistry<T extends string>(
  arg: Record<T, SVGAsComponent>,
): Record<T, SVGAsComponent> {
  return arg
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
  info: Info,
  lowResHeart: LowResHeart,
  github: Github,
  question: Question,
  setting: Setting,
  trash: Trash,
  dragAndDrop: DragAndDrop,
  warning: Warning,
  error: Error,
  redo: Redo,
  rotateLeft: RotateLeft,
  flipVertical: FlipVertical,
  flipHorizontal: FlipHorizontal,
  expand: Expand,
  resetZoom: ResetZoom,
})

export default registry
