'use client'

import { motion } from 'framer-motion'
import React from 'react'
import { useSnapshot } from 'valtio'

import Image from '@/components/Image'
import Progress from '@/components/Progress'
import { videoProxy } from '../-state'

function Compressing() {
  const {
    state: {
      isCompressing,
      videDurationRaw,
      thumbnailPath,
      config,
      compressionProgress,
    },
  } = useSnapshot(videoProxy)
  const { convertToExtension, shouldDisableCompression } = config

  return isCompressing ? (
    <motion.div
      className="w-full flex flex-col justify-center items-center flex-shrink-0"
      initial={{ scale: 0.9 }}
      animate={{ scale: 1 }}
      transition={{ type: 'spring', duration: 0.6 }}
    >
      <div className="relative">
        <Progress
          {...(videDurationRaw == null
            ? { isIndeterminate: true }
            : { value: compressionProgress })}
          classNames={{
            base: 'absolute top-[50%] left-[50%] translate-x-[-50%] translate-y-[-50%]',
            svg: 'w-[480px] h-[480px] hlg:w-[540px] hlg:h-[540px] drop-shadow-md',
            indicator: 'stroke-primary stroke-1',
            track: 'stroke-transparent stroke-1',
            value: 'text-3xl font-semibold text-primary',
          }}
          strokeWidth={2}
          aria-label={`Progress-${compressionProgress}%`}
        />
        <Image
          alt="video to compress"
          src={thumbnailPath as string}
          className="z-0 w-[400px] h-[400px] min-w-[400px] min-h-[400px] hlg:w-[450px] hlg:h-[450px] hlg:min-w-[450px] hlg:min-h-[450px] object-cover rounded-full flex-shrink-0"
        />
        <div className="blur-2xl  z-[10] absolute top-0 right-0 bottom-0 left-0 rounded-full" />
      </div>
      <p className="italic text-sm mt-10 text-gray-600 dark:text-gray-400 text-center animate-pulse">
        {!shouldDisableCompression ? 'Compressing' : 'Converting'}
        ...
        {convertToExtension === 'webm' ? (
          <span className="block">
            webm conversion takes longer than the other formats.
          </span>
        ) : null}
      </p>
      <p
        className={`not-italic text-2xl text-center font-bold text-primary my-4 opacity-${
          compressionProgress && compressionProgress > 0 ? 1 : 0
        }`}
      >
        {compressionProgress?.toFixed(2)}%
      </p>
    </motion.div>
  ) : null
}

export default React.memo(Compressing)
