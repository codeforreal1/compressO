import { motion } from 'framer-motion'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useSnapshot } from 'valtio'

import AnimatedNumber from '@/components/AnimatedNumber'
import Icon from '@/components/Icon'
import ImpactPop from '@/components/ImpactPop'
import { formatBytes } from '@/utils/fs'
import { appProxy } from '../-state'

type OutputSizeSummaryProps = {
  mediaIndex: number
}

/** How long the result's numbers count (in seconds) before they land */
const RESULT_COUNT_SECONDS = 0.3

/** A percentage as shown, e.g. `99.77` or `50` (without `.00`) */
const formatPercentage = (value: number) => {
  const text = value.toFixed(2)
  return text.endsWith('.00') ? text.slice(0, -3) : text
}

/** The original & output sizes, & how much smaller the output became */
function OutputSizeSummary({ mediaIndex }: OutputSizeSummaryProps) {
  const { t } = useTranslation()
  const {
    state: { media },
  } = useSnapshot(appProxy)
  const mediaFile = media[mediaIndex]
  const { size: mediaSize, sizeInBytes, compressedFile } = mediaFile ?? {}
  const outputSizeInBytes =
    (mediaFile?.type === 'video'
      ? mediaFile.compressedFile?.previewOption?.sizeInBytes
      : null) ?? compressedFile?.sizeInBytes
  const compressedSizeDiff: number = useMemo(
    () =>
      typeof outputSizeInBytes === 'number' &&
      typeof sizeInBytes === 'number' &&
      !Number.isNaN(sizeInBytes)
        ? (((sizeInBytes ?? 0) - (outputSizeInBytes ?? 0)) * 100) / sizeInBytes
        : 0,
    [outputSizeInBytes, sizeInBytes],
  )
  const isSmaller = compressedSizeDiff > 0

  return (
    <>
      <div className="flex justify-center items-center mt-2">
        <p className="text-2xl font-bold mx-4">{mediaSize}</p>
        <motion.div
          initial={isSmaller ? { opacity: 0, x: -12 } : false}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
        >
          <Icon
            name="curvedArrow"
            className="text-black dark:text-white rotate-[-65deg] translate-y-[-8px]"
            size={100}
          />
        </motion.div>
        <p className="text-3xl font-bold mx-4 text-primary">
          <ImpactPop
            trigger={outputSizeInBytes}
            delay={RESULT_COUNT_SECONDS}
            isDisabled={!isSmaller}
          >
            <AnimatedNumber
              value={outputSizeInBytes ?? 0}
              from={sizeInBytes ?? 0}
              format={formatBytes}
              duration={RESULT_COUNT_SECONDS}
              isStatic={!isSmaller}
            />
          </ImpactPop>
        </p>
      </div>
      {isSmaller ? (
        <p className="block text-5xl text-center text-primary">
          <AnimatedNumber
            value={compressedSizeDiff}
            from={0}
            format={formatPercentage}
            duration={RESULT_COUNT_SECONDS}
          />
          %
          <motion.span
            className="text-large block"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.2,
              delay: RESULT_COUNT_SECONDS * 0.75,
              ease: 'easeOut',
            }}
          >
            {t('preview.smaller')}
          </motion.span>
        </p>
      ) : null}
    </>
  )
}

export default OutputSizeSummary
