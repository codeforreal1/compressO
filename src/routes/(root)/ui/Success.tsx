'use client'

import React from 'react'
import { useSnapshot } from 'valtio'

import Icon from '@/components/Icon'
import { videoProxy } from '../-state'

function Success() {
  const {
    state: { sizeInBytes, compressedVideo, size: videoSize },
  } = useSnapshot(videoProxy)

  const sizeDiff: number = React.useMemo(
    () =>
      typeof compressedVideo?.sizeInBytes === 'number' &&
      typeof sizeInBytes === 'number' &&
      !Number.isNaN(sizeInBytes)
        ? (((sizeInBytes ?? 0) - (compressedVideo?.sizeInBytes ?? 0)) * 100) /
          sizeInBytes
        : 0,
    [compressedVideo?.sizeInBytes, sizeInBytes],
  )

  return (
    <section className="animate-appearance-in">
      <div className="flex justify-center items-center mt-3 hslg:mt-6">
        <p className="text-2xl hslg:text-4xl font-bold mx-4">{videoSize}</p>
        <Icon
          name="curvedArrow"
          className="text-black dark:text-white rotate-[-65deg] translate-y-[-8px]"
          size={100}
        />
        <p className="text-3xl hslg:text-4xl font-bold mx-4 text-primary">
          {compressedVideo?.size}
        </p>
      </div>
      {!(sizeDiff <= 0) ? (
        <p className="block text-5xl hslg:text-7xl text-center text-green-500 hslg:mt-5">
          {sizeDiff.toFixed(2)?.endsWith('.00')
            ? sizeDiff.toFixed(2)?.slice(0, -3)
            : sizeDiff.toFixed(2)}
          %<span className="text-large block">smaller</span>
        </p>
      ) : null}
    </section>
  )
}

export default React.memo(Success)
