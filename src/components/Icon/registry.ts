import React from 'react'

import AddMedia from '@/assets/icons/add-media.svg?react'
import Audio from '@/assets/icons/audio.svg?react'
import AudioMuted from '@/assets/icons/audio-muted.svg?react'
import Back from '@/assets/icons/back.svg?react'
import Caret from '@/assets/icons/caret.svg?react'
import Chevron from '@/assets/icons/chevron.svg?react'
import Compare from '@/assets/icons/compare.svg?react'
import Copy from '@/assets/icons/copy.svg?react'
import Cross from '@/assets/icons/cross.svg?react'
import CurvedArrow from '@/assets/icons/curved-arrow.svg?react'
import Download from '@/assets/icons/download.svg?react'
import DragAndDrop from '@/assets/icons/drag-and-drop.svg?react'
import Error from '@/assets/icons/error.svg?react'
import Expand from '@/assets/icons/expand.svg?react'
import FileExplorer from '@/assets/icons/file-explorer.svg?react'
import FlipHorizontal from '@/assets/icons/flip-horizontal.svg?react'
import FlipVertical from '@/assets/icons/flip-vertical.svg?react'
import Github from '@/assets/icons/github.svg?react'
import Image from '@/assets/icons/image.svg?react'
import Info from '@/assets/icons/info.svg?react'
import LowResHeart from '@/assets/icons/low-res-heart.svg?react'
import Moon from '@/assets/icons/moon.svg?react'
import Music from '@/assets/icons/music.svg?react'
import Pause from '@/assets/icons/pause.svg?react'
import Pencil from '@/assets/icons/pencil.svg?react'
import Play from '@/assets/icons/play.svg?react'
import Question from '@/assets/icons/question.svg?react'
import Redo from '@/assets/icons/redo.svg?react'
import RotateLeft from '@/assets/icons/rotate-left.svg?react'
import Setting from '@/assets/icons/setting.svg?react'
import Star from '@/assets/icons/star.svg?react'
import Sun from '@/assets/icons/sun.svg?react'
import Tick from '@/assets/icons/tick.svg?react'
import Trash from '@/assets/icons/trash.svg?react'
import Video from '@/assets/icons/video.svg?react'
import Warning from '@/assets/icons/warning.svg?react'
import Zoom from '@/assets/icons/zoom.svg?react'

type SVGAsComponent = React.FunctionComponent<React.SVGProps<SVGSVGElement>>

function asRegistry<T extends string>(
  arg: Record<T, SVGAsComponent>,
): Record<T, SVGAsComponent> {
  return arg
}

const registry = asRegistry({
  moon: Moon,
  sun: Sun,
  video: Video,
  star: Star,
  copy: Copy,
  cross: Cross,
  curvedArrow: CurvedArrow,
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
  zoom: Zoom,
  pencil: Pencil,
  back: Back,
  pause: Pause,
  image: Image,
  audioMuted: AudioMuted,
  audio: Audio,
  download: Download,
  chevron: Chevron,
  addMedia: AddMedia,
  caret: Caret,
  compare: Compare,
  music: Music,
})

export default registry
