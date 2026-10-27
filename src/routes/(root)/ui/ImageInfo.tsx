import { Tab } from '@heroui/react'
import { motion } from 'framer-motion'
import { startCase } from 'lodash'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSnapshot } from 'valtio'

import Code from '@/components/Code'
import Divider from '@/components/Divider'
import ScrollShadow from '@/components/ScrollShadow'
import Spinner from '@/components/Spinner'
import Tabs from '@/components/Tabs'
import {
  getExifInfo,
  getImageBasicInfo,
  getImageColorInfo,
  getImageDimensions,
} from '@/tauri/commands/image'
import {
  ExifInfo,
  ImageBasicInfo,
  ImageColorInfo,
  ImageDimensions,
} from '@/types/compression'
import { formatBytes } from '@/utils/fs'
import { appProxy } from '../-state'

type ImageInfoProps = {
  mediaIndex: number
  onClose?: () => void
}

/** Titled with `mediaInfo.tabs.<id>` */
const TABS = {
  container: { id: 'container' },
  color: { id: 'color' },
  exif: { id: 'exif' },
} as const

function ImageInfo({ mediaIndex, onClose }: ImageInfoProps) {
  const { t } = useTranslation()
  if (mediaIndex < 0) return null

  const {
    state: { media },
  } = useSnapshot(appProxy)

  const image =
    media.length && mediaIndex >= 0 && media[mediaIndex].type === 'image'
      ? media[mediaIndex]
      : null
  const { pathRaw: imagePathRaw, imageInfoRaw } = image ?? {}
  if (!image) return null

  const [tab, setTab] = useState<keyof typeof TABS>('container')
  const [loading, setLoading] = useState(false)

  const fetchTabData = useCallback(
    async (tabKey: keyof typeof TABS) => {
      const image = appProxy.state.media[mediaIndex]

      if (!imagePathRaw || !image || image.type !== 'image') {
        return
      }

      if (!image.imageInfoRaw) {
        image.imageInfoRaw = {}
      }

      setLoading(true)
      try {
        switch (tabKey) {
          case 'container': {
            if (!image?.imageInfoRaw?.basicInfo) {
              const data = await getImageBasicInfo(imagePathRaw)
              if (data) {
                image.imageInfoRaw.basicInfo = data
              }
            }
            if (!image?.imageInfoRaw?.dimensions) {
              const data = await getImageDimensions(imagePathRaw)
              if (data) {
                image.imageInfoRaw.dimensions = data
              }
            }
            break
          }
          case 'color': {
            if (!image?.imageInfoRaw?.colorInfo) {
              const data = await getImageColorInfo(imagePathRaw)
              if (data) {
                image.imageInfoRaw.colorInfo = data
              }
            }
            break
          }
          case 'exif': {
            if (!image?.imageInfoRaw?.exifInfo) {
              const data = await getExifInfo(imagePathRaw)
              if (data) {
                image.imageInfoRaw.exifInfo = data
              }
            }
            break
          }
        }
      } catch {
        //
      } finally {
        setLoading(false)
      }
    },
    [imagePathRaw, mediaIndex],
  )

  useEffect(() => {
    fetchTabData(tab)
  }, [tab, fetchTabData])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose?.()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  return (
    <section
      data-tint-transparent=""
      className="w-full h-full bg-white1 dark:bg-black1 p-6"
    >
      <div className="w-full flex justify-center">
        <Tabs
          aria-label={t('mediaInfo.imageInformation')}
          size="sm"
          selectedKey={tab}
          onSelectionChange={(key) => setTab(key as keyof typeof TABS)}
          classNames={{
            tabContent: 'text-[11px]',
            tab: 'h-6',
          }}
        >
          {Object.values(TABS).map((item) => (
            <Tab
              key={item.id}
              value={item.id}
              title={t(`mediaInfo.tabs.${item.id}`)}
            />
          ))}
        </Tabs>
      </div>

      <ScrollShadow
        className="mt-6 overflow-y-auto max-h-[calc(100vh-200px)] pb-10"
        hideScrollBar
      >
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Spinner size="sm" />
          </div>
        ) : null}

        {!loading &&
        tab === 'container' &&
        (imageInfoRaw?.basicInfo || imageInfoRaw?.dimensions) ? (
          <BasicInfoDisplay
            info={imageInfoRaw.basicInfo as any}
            dimensions={imageInfoRaw.dimensions as any}
            imagePathRaw={imagePathRaw}
          />
        ) : null}

        {!loading && tab === 'color' && imageInfoRaw?.colorInfo ? (
          <ColorInfoDisplay info={imageInfoRaw.colorInfo as any} />
        ) : null}

        {!loading && tab === 'exif' && imageInfoRaw?.exifInfo ? (
          <ExifDisplay exif={imageInfoRaw.exifInfo as any} />
        ) : null}
      </ScrollShadow>
    </section>
  )
}

function BasicInfoDisplay({
  info,
  dimensions,
  imagePathRaw,
}: {
  info: ImageBasicInfo
  dimensions?: ImageDimensions
  imagePathRaw?: string | null
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-4">
      {imagePathRaw ? (
        <>
          <InfoItem
            label={t('mediaInfo.fullPath')}
            value={
              <Code size="sm" className="text-xs max-w-[100%] truncate">
                {imagePathRaw}
              </Code>
            }
          />
          <Divider className="my-1" />
        </>
      ) : null}

      {info.filename ? (
        <>
          <InfoItem label={t('mediaInfo.fileName')} value={info.filename} />
          <Divider className="my-1" />
        </>
      ) : null}

      {info.format ? (
        <>
          <InfoItem label={t('mediaInfo.format')} value={info.format} />
          <Divider className="my-1" />
        </>
      ) : null}

      {info.mimeType ? (
        <>
          <InfoItem label={t('mediaInfo.mimeType')} value={info.mimeType} />
          <Divider className="my-1" />
        </>
      ) : null}

      {info.size > 0 ? (
        <>
          <InfoItem
            label={t('mediaInfo.size')}
            value={formatBytes(info.size)}
          />
          <Divider className="my-1" />
        </>
      ) : null}

      {dimensions && (
        <>
          <div className="grid grid-cols-2 gap-4 mt-4">
            <div>
              <InfoItem
                label={t('mediaInfo.width')}
                value={`${dimensions.width}px`}
              />
              <Divider className="!my-2" />
            </div>
            <div>
              <InfoItem
                label={t('mediaInfo.height')}
                value={`${dimensions.height}px`}
              />
              <Divider className="!my-2" />
            </div>
          </div>

          {dimensions.aspectRatio ? (
            <>
              <InfoItem
                label={t('mediaInfo.aspectRatio')}
                value={dimensions.aspectRatio}
              />
              <Divider className="!my-2" />
            </>
          ) : null}

          {dimensions.orientation ? (
            <>
              <InfoItem
                label={t('mediaInfo.orientation')}
                value={`${dimensions.orientation}°`}
              />
              <Divider className="!my-2" />
            </>
          ) : null}

          {dimensions.dpi ? (
            <>
              <InfoItem
                label={t('mediaInfo.dpi')}
                value={`${dimensions.dpi[0]} × ${dimensions.dpi[1]}`}
              />
              <Divider className="!my-2" />
            </>
          ) : null}

          <InfoItem
            label={t('mediaInfo.megapixels')}
            value={`${dimensions.megapixels.toFixed(2)} MP`}
          />
          <Divider className="!my-2" />
        </>
      )}
    </div>
  )
}

function ColorInfoDisplay({ info }: { info: ImageColorInfo }) {
  const { t } = useTranslation()
  return (
    <div className="space-y-4">
      {info.colorType ? (
        <>
          <InfoItem label={t('mediaInfo.colorType')} value={info.colorType} />
          <Divider className="!my-2" />
        </>
      ) : null}

      {info.bitDepth ? (
        <>
          <InfoItem
            label={t('mediaInfo.bitDepth')}
            value={`${info.bitDepth}-bit`}
          />
          <Divider className="!my-2" />
        </>
      ) : null}

      <InfoItem
        label={t('mediaInfo.alphaChannel')}
        value={info.hasAlpha ? 'Yes' : 'No'}
      />
      <Divider className="!my-2" />

      {info.colorSpace ? (
        <>
          <InfoItem label={t('mediaInfo.colorSpace')} value={info.colorSpace} />
          <Divider className="!my-2" />
        </>
      ) : null}

      {info.pixelFormat ? (
        <>
          <InfoItem
            label={t('mediaInfo.pixelFormat')}
            value={info.pixelFormat}
          />
          <Divider className="!my-2" />
        </>
      ) : null}
    </div>
  )
}

function ExifDisplay({ exif }: { exif: ExifInfo }) {
  const { t } = useTranslation()
  const hasCameraInfo =
    exif.make || exif.model || exif.lensModel || exif.software
  const hasShootingInfo =
    exif.iso ||
    exif.exposureTime ||
    exif.fNumber ||
    exif.focalLength ||
    exif.flash
  const hasDateInfo = exif.dateTimeOriginal || exif.dateTimeDigitized
  const hasCopyrightInfo = exif.copyright || exif.artist
  const hasGpsInfo = exif.gpsCoordinates

  if (
    !hasCameraInfo &&
    !hasShootingInfo &&
    !hasDateInfo &&
    !hasCopyrightInfo &&
    !hasGpsInfo &&
    (!exif.tags || exif.tags.length === 0)
  ) {
    return (
      <p className="text-center text-zinc-500 py-8 select-text">
        {t('mediaInfo.noExif')}
      </p>
    )
  }

  return (
    <div className="space-y-6">
      {hasCameraInfo ? (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          <h3 className="text-lg font-semibold text-primary select-text">
            {t('mediaInfo.cameraInformation')}
          </h3>

          {exif.make ? (
            <>
              <InfoItem label={t('mediaInfo.make')} value={exif.make} />
              <Divider className="!my-2" />
            </>
          ) : null}

          {exif.model ? (
            <>
              <InfoItem label={t('mediaInfo.model')} value={exif.model} />
              <Divider className="!my-2" />
            </>
          ) : null}

          {exif.lensModel ? (
            <>
              <InfoItem
                label={t('mediaInfo.lensModel')}
                value={exif.lensModel}
              />
              <Divider className="!my-2" />
            </>
          ) : null}

          {exif.software ? (
            <>
              <InfoItem label={t('mediaInfo.software')} value={exif.software} />
              <Divider className="!my-2" />
            </>
          ) : null}
        </motion.div>
      ) : null}

      {hasShootingInfo ? (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="space-y-4"
        >
          <h3 className="text-lg font-semibold text-primary select-text">
            {t('mediaInfo.shootingInformation')}
          </h3>

          {exif.iso ? (
            <>
              <InfoItem label={t('mediaInfo.iso')} value={`ISO ${exif.iso}`} />
              <Divider className="!my-1" />
            </>
          ) : null}

          {exif.exposureTime ? (
            <>
              <InfoItem
                label={t('mediaInfo.exposureTime')}
                value={exif.exposureTime}
              />
              <Divider className="!my-1" />
            </>
          ) : null}

          {exif.fNumber ? (
            <>
              <InfoItem
                label={t('mediaInfo.aperture')}
                value={`f/${exif.fNumber}`}
              />
              <Divider className="!my-1" />
            </>
          ) : null}

          {exif.focalLength ? (
            <>
              <InfoItem
                label={t('mediaInfo.focalLength')}
                value={exif.focalLength}
              />
              <Divider className="!my-1" />
            </>
          ) : null}

          {exif.flash ? (
            <>
              <InfoItem label={t('mediaInfo.flash')} value={exif.flash} />
              <Divider className="!my-1" />
            </>
          ) : null}
        </motion.div>
      ) : null}

      {hasDateInfo ? (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="space-y-4"
        >
          <h3 className="text-lg font-semibold text-primary select-text">
            {t('mediaInfo.dateInformation')}
          </h3>

          {exif.dateTimeOriginal ? (
            <>
              <InfoItem
                label={t('mediaInfo.dateTaken')}
                value={exif.dateTimeOriginal}
              />
              <Divider className="!my-2" />
            </>
          ) : null}

          {exif.dateTimeDigitized ? (
            <>
              <InfoItem
                label={t('mediaInfo.dateDigitized')}
                value={exif.dateTimeDigitized}
              />
              <Divider className="!my-2" />
            </>
          ) : null}
        </motion.div>
      ) : null}

      {hasCopyrightInfo ? (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="space-y-4"
        >
          <h3 className="text-lg font-semibold text-primary select-text">
            {t('mediaInfo.copyrightInformation')}
          </h3>

          {exif.artist ? (
            <>
              <InfoItem label={t('mediaInfo.artist')} value={exif.artist} />
              <Divider className="!my-2" />
            </>
          ) : null}

          {exif.copyright ? (
            <>
              <InfoItem
                label={t('mediaInfo.copyright')}
                value={exif.copyright}
              />
              <Divider className="!my-2" />
            </>
          ) : null}
        </motion.div>
      ) : null}

      {hasGpsInfo ? (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="space-y-4"
        >
          <h3 className="text-lg font-semibold text-primary select-text">
            {t('mediaInfo.gpsInformation')}
          </h3>

          {exif.gpsCoordinates ? (
            <>
              <InfoItem
                label={t('mediaInfo.coordinates')}
                value={`${exif.gpsCoordinates[0].toFixed(6)}°, ${exif.gpsCoordinates[1].toFixed(6)}°`}
              />
              <Divider className="!my-2" />
            </>
          ) : null}
        </motion.div>
      ) : null}

      {exif.tags && exif.tags.length > 0 ? (
        <>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-primary select-text">
                {t('mediaInfo.allTags')}
              </h3>
              {exif.tags.map((tag, index) => (
                <div key={index}>
                  <InfoItem label={startCase(tag.key)} value={tag.value} />
                  <Divider className="my-2" />
                </div>
              ))}
            </div>
          </motion.div>
        </>
      ) : null}
    </div>
  )
}

function InfoItem({ label, value }: { label: string; value: React.ReactNode }) {
  const { t } = useTranslation()
  return (
    <div className="flex items-baseline justify-between select-text">
      <span className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
        {label}:
      </span>
      <span className="text-[13px] text-zinc-800 dark:text-zinc-200 ml-2 max-w-[75%] text-end">
        {value || t('mediaInfo.notAvailable')}
      </span>
    </div>
  )
}

export default ImageInfo
