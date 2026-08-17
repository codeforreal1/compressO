import { Divider, Tab } from '@heroui/react'
import { useState } from 'react'
import { useSnapshot } from 'valtio'

import Tabs from '@/components/Tabs'
import { appProxy } from '@/routes/(root)/-state'
import { ImageExtension as ImageExtensionType } from '@/types/compression'
import AutoSaveSettings from '../AutoSaveSettings'
import CompressionQuality from './image/CompressionQuality'
import ImageDimensions from './image/Dimensions'
import ImageExtension from './image/Extension'
import SvgConfig from './image/SvgConfig'
import SvgScaleFactor from './image/SvgScaleFactor'
import TransformImage from './image/TransformImage'
import Others from './others/-index'

type ImageSettingsProps = {
  mediaIndex: number
}

const TABS = {
  image: {
    id: 'image',
    title: 'Image',
  },
  others: {
    id: 'others',
    title: 'Others',
  },
} as const

function ImageSettings({ mediaIndex }: ImageSettingsProps) {
  const {
    state: { media, commonConfigForBatchCompression },
  } = useSnapshot(appProxy)
  const image =
    media.length > 0 && mediaIndex >= 0 && media[mediaIndex].type == 'image'
      ? media[mediaIndex]
      : null
  const { config, extension: imageExtension } = image ?? {}
  const { convertToExtension } =
    config ?? commonConfigForBatchCompression.imageConfig ?? {}

  const [tab, setTab] = useState<keyof typeof TABS>('image')

  return (
    <>
      <section>
        <AutoSaveSettings />
        <Tabs
          aria-label="Compression Settings"
          size="sm"
          selectedKey={tab}
          onSelectionChange={(t) => setTab(t as keyof typeof TABS)}
          className="w-full"
          fullWidth
          classNames={{
            tab: 'h-6',
            tabContent: 'text-[11px]',
          }}
        >
          {Object.values(TABS).map((t) => (
            <Tab key={t.id} value={t.id} title={t.title} />
          ))}
        </Tabs>
        <div className="my-4">
          {tab === 'image' ? (
            <div>
              <div>
                <CompressionQuality mediaIndex={mediaIndex} />
                <Divider className="my-3" />
              </div>

              {(['svg'] as ImageExtensionType[]).includes(
                image?.extension as ImageExtensionType,
              ) &&
              (['png', 'jpg', 'jpeg', 'webp'] as ImageExtensionType[]).includes(
                convertToExtension as ImageExtensionType,
              ) ? (
                <div>
                  <SvgScaleFactor mediaIndex={mediaIndex} />
                  <Divider className="my-3 !mt-6" />
                </div>
              ) : null}

              {(
                ['png', 'jpg', 'jpeg', 'webp', 'gif'] as ImageExtensionType[]
              ).includes(imageExtension as ImageExtensionType) &&
              !(['svg'] as ImageExtensionType[]).includes(
                convertToExtension as ImageExtensionType,
              ) ? (
                <>
                  <div>
                    <ImageDimensions mediaIndex={mediaIndex} />
                    <Divider className="my-3" />
                  </div>
                  <div>
                    <TransformImage mediaIndex={mediaIndex} />
                    <Divider className="my-3" />
                  </div>
                </>
              ) : null}

              {convertToExtension === 'svg' ? (
                <div>
                  <SvgConfig mediaIndex={mediaIndex} />
                  <Divider className="my-3" />
                </div>
              ) : null}

              <div className="!mt-8">
                <ImageExtension mediaIndex={mediaIndex} />
              </div>
            </div>
          ) : null}
          {tab === 'others' ? (
            <div>
              <Others mediaIndex={mediaIndex} />
            </div>
          ) : null}
        </div>
      </section>
    </>
  )
}

export default ImageSettings
