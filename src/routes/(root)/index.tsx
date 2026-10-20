import { createFileRoute } from '@tanstack/react-router'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { useSnapshot } from 'valtio'

import Icon from '@/components/Icon'
import Layout from '@/components/Layout'
import Spinner from '@/components/Spinner'
import { cn } from '@/utils/tailwind'
import { useCompressionStatusSync } from './-compression-status'
import { addMedia, openExternalMedia, pickMediaToAdd } from './-media'
import { appProxy } from './-state'
import Setting, { SettingsDialogHost } from './ui/app-settings/Setting'
import DragAndDropFiles from './ui/DragAndDropFiles'
import MediaConfig from './ui/MediaConfig'
import OpenWithApp from './ui/OpenWithApp'
import ReadFilesFromClipboard from './ui/ReadFilesFromClipboard'

export const Route = createFileRoute('/(root)/')({
  component: Root,
})

function Root() {
  const { t } = useTranslation()
  const { state } = useSnapshot(appProxy)
  useCompressionStatusSync()

  const {
    media,
    isLoadingMediaFiles,
    totalSelectedMediaCount,
    isCompressing,
    isProcessCompleted,
    isAppendingMedia,
  } = state

  const screen = isLoadingMediaFiles ? (
    // Spinner until a fresh multi-media selection has more than one media (to not flash the single
    // media view); when adding to an existing selection, the current view stays visible
    !media.length ||
    (!isAppendingMedia && totalSelectedMediaCount > 1 && media.length === 1) ? (
      <div className="w-full h-full flex justify-center items-center">
        <Spinner />
      </div>
    ) : (
      <MediaConfig />
    )
  ) : media.length ? (
    <MediaConfig />
  ) : (
    <Layout
      containerProps={{ className: 'relative' }}
      childrenProps={{ className: 'm-auto' }}
    >
      <motion.div
        role="button"
        tabIndex={0}
        className="h-full w-full flex flex-col justify-center items-center z-0"
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{
          scale: 1,
          opacity: 1,
          transition: {
            duration: 0.6,
            bounce: 0.3,
            type: 'spring',
          },
        }}
        onClick={pickMediaToAdd}
        onKeyDown={(evt) => {
          if (evt?.key === 'Enter') {
            pickMediaToAdd()
          }
        }}
      >
        <div
          className={cn(
            'flex flex-col justify-center items-center py-16 px-20 border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-3xl',
          )}
        >
          <Icon name="addMedia" className="text-primary" size={60} />
          <p className="text-sm mt-4 text-gray-600 dark:text-gray-400 text-center">
            {t('home.dragAndDrop')}
            <span className="block text-xs">{t('home.or')}</span>
            {t('home.clickToSelect')}
          </p>
        </div>
      </motion.div>
      <Setting />
    </Layout>
  )

  return (
    <>
      {screen}
      {/* Available on every screen, so media can also be added to an existing selection */}
      <DragAndDropFiles
        multiple
        disable={isCompressing || isProcessCompleted}
        onFile={addMedia}
      />
      <OpenWithApp onFiles={openExternalMedia} />
      <ReadFilesFromClipboard onFiles={addMedia} />
      <SettingsDialogHost />
    </>
  )
}

export default Root
