import { Divider, Tab } from '@heroui/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSnapshot } from 'valtio'

import Tabs from '@/components/Tabs'
import { appProxy } from '@/routes/(root)/-state'
import { ImageExtension as ImageExtensionType } from '@/types/compression'
import CompressionQuality from './image/CompressionQuality'
import ImageDimensions from './image/Dimensions'
import ImageExtension from './image/Extension'
import SvgConfig from './image/SvgConfig'
import SvgScaleFactor from './image/SvgScaleFactor'
import TransformImage from './image/TransformImage'
import Others from './others/-index'
import PresetSelector from '../PresetSelector'

type ImageSettingsProps = {
  mediaIndex: number
}

/** Titled with `outputSettings.tabs.<id>` */
const TABS = {
  image: { id: 'image' },
  others: { id: 'others' },
} as const

function ImageSettings({ mediaIndex }: ImageSettingsProps) {
  const { t } = useTranslation()
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
        <PresetSelector mediaType="image" mediaIndex={mediaIndex} />
        <Tabs
          aria-label={t('outputSettings.compressionSettings')}
          size="sm"
          selectedKey={tab}
          onSelectionChange={(key) => setTab(key as keyof typeof TABS)}
          className="w-full"
          fullWidth
          classNames={{
            tab: 'h-6',
            tabContent: 'text-[11px]',
          }}
        >
          {Object.values(TABS).map((item) => (
            <Tab
              key={item.id}
              value={item.id}
              title={t(`outputSettings.tabs.${item.id}`)}
            />
          ))}
        </Tabs>
        <div className="my-4">
          {tab === 'image' ? (
            <div>
              <div>
                <CompressionQuality mediaIndex={mediaIndex} />
                <Divider className="mb-3" />
              </div>

              {(['svg'] as ImageExtensionType[]).includes(
                image?.extension as ImageExtensionType,
              ) &&
              (
                ['png', 'jpg', 'jpeg', 'webp', 'avif'] as ImageExtensionType[]
              ).includes(convertToExtension as ImageExtensionType) ? (
                <div>
                  <SvgScaleFactor mediaIndex={mediaIndex} />
                  <Divider className="my-3 !mt-8" />
                </div>
              ) : null}

              {[
                'png',
                'jpg',
                'jpeg',
                'webp',
                'gif',
                'avif',
                'bmp',
                'tiff',
                'tif',
              ].includes(imageExtension ?? '') &&
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
                    <Divider className="my-3 mb-2" />
                  </div>
                </>
              ) : null}

              {convertToExtension === 'svg' ? (
                <div>
                  <SvgConfig mediaIndex={mediaIndex} />
                  <Divider className="my-3" />
                </div>
              ) : null}

              <div className="!mt-10">
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
