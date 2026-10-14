import { ScrollShadow, Tab } from '@heroui/react'
import { AnimatePresence, motion } from 'framer-motion'
import React from 'react'
import { useSnapshot } from 'valtio'

import Layout from '@/components/Layout'
import Tabs from '@/components/Tabs'
import Title from '@/components/Title'
import { zoomInTransition } from '@/utils/animation'
import { cn } from '@/utils/tailwind'
import CompressionActions from './CompressionActions'
import CompressionProgress from './CompressionProgress'
import CustomizeMediaOnBatchActions from './CustomizeMediaOnBatchActions'
import ExitMedia from './ExitMedia'
import OutputSettings from './output-settings/-index'
import PreviewBatchMedia from './PreviewBatchMedia'
import PreviewSingleVideo from './PreviewSingleMedia'
import StartCompression from './StartCompression'
import styles from './styles.module.css'
import { appProxy } from '../-state'

function MediaConfig() {
  const {
    state: {
      activeTab,
      media,
      isCompressing,
      isLoadingMediaFiles,
      selectedMediaIndexForCustomization,
    },
  } = useSnapshot(appProxy)

  return (
    <Layout
      containerProps={{ className: 'relative' }}
      childrenProps={{
        className: 'h-full',
      }}
    >
      <div className={cn(['h-full p-6', styles.videoConfigContainer])}>
        <section
          className={cn(
            'relative w-full h-full px-4 py-6 rounded-xl border-2 border-zinc-200 dark:border-zinc-800',
          )}
        >
          {media.length > 1 && selectedMediaIndexForCustomization === -1 ? (
            <motion.div
              className="flex justify-center absolute left-1/2 top-[-16px]"
              {...zoomInTransition}
            >
              <Tabs
                aria-label="Media Filter"
                size="sm"
                selectedKey={activeTab}
                onSelectionChange={(t) => {
                  appProxy.state.activeTab = t as 'all' | 'videos' | 'images'
                }}
                className="mb-4"
                classNames={{
                  tabContent: 'text-[11px]',
                  tab: 'h-5',
                }}
              >
                <Tab key="all" value="all" title="All" />
                <Tab key="videos" value="videos" title="Videos" />
                <Tab key="images" value="images" title="Images" />
              </Tabs>
            </motion.div>
          ) : null}
          {/* A single media has its exit in the preview's header */}
          {media.length > 1 &&
          selectedMediaIndexForCustomization === -1 &&
          !isCompressing &&
          !isLoadingMediaFiles ? (
            <motion.div
              className="absolute left-4 top-[-16px] z-[1] rounded-full bg-white1 dark:bg-black1"
              {...zoomInTransition}
            >
              <ExitMedia />
            </motion.div>
          ) : null}
          <AnimatePresence>
            {media.length > 1 ? (
              <>
                <PreviewBatchMedia />
                {selectedMediaIndexForCustomization > -1 ? (
                  <CustomizeMediaOnBatchActions />
                ) : null}
              </>
            ) : (
              <PreviewSingleVideo mediaIndex={0} />
            )}
          </AnimatePresence>
        </section>
        <section className="relative p-4 w-full h-full rounded-xl border-2 border-zinc-200 dark:border-zinc-800">
          <div className="flex items-center justify-between w-full mb-2">
            <Title
              title={
                media.length === 1 || selectedMediaIndexForCustomization > -1
                  ? 'Output Settings'
                  : 'Batch Settings'
              }
              className="text-xl font-bold"
            />
            {!isCompressing ? <CompressionActions /> : null}
          </div>
          <ScrollShadow className="h-[78vh] hxl:h-[82vh] pb-10" hideScrollBar>
            <OutputSettings
              mediaIndex={
                media.length === 1 ? 0 : selectedMediaIndexForCustomization
              }
            />
          </ScrollShadow>
          <div className="absolute bottom-4 left-4 right-4">
            <StartCompression />
          </div>
        </section>
      </div>
      {isCompressing ? <CompressionProgress /> : null}
    </Layout>
  )
}

export default React.memo(MediaConfig)
