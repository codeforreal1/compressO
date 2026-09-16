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
                aria-label="媒体筛选"
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
                <Tab key="all" value="all" title="全部" />
                <Tab key="videos" value="videos" title="视频" />
                <Tab key="images" value="images" title="图片" />
              </Tabs>
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
                  ? '输出设置'
                  : '批量设置'
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
