import React from 'react'

import Logo from '@/assets/icons/logo.svg'
import Moon from '@/assets/icons/moon.svg'
import Sun from '@/assets/icons/sun.svg'
import VideoFile from '@/assets/icons/video-file.svg'
import Star from '@/assets/icons/star.svg'
import Cross from '@/assets/icons/cross.svg'
import CurvedArrow from '@/assets/icons/curved-arrow.svg'
import Save from '@/assets/icons/save.svg'
import Tick from '@/assets/icons/tick.svg'
import FileExplorer from '@/assets/icons/file-explorer.svg'
import Play from '@/assets/icons/play.svg'
import Info from '@/assets/icons/info.svg'
import LowResHeart from '@/assets/icons/low-res-heart.svg'
import Github from '@/assets/icons/github.svg'
import Question from '@/assets/icons/question.svg'
import Setting from '@/assets/icons/setting.svg'
import Trash from '@/assets/icons/trash.svg'
import DragAndDrop from '@/assets/icons/drag-and-drop.svg'
import Warning from '@/assets/icons/warning.svg'
import Error from '@/assets/icons/error.svg'

type SVGAsComponent = React.FC<React.SVGProps<SVGElement>>

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
})

export default registry
