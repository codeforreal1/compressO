import { AccordionItem } from '@heroui/react'
import { memo, useEffect } from 'react'
import { useSnapshot } from 'valtio'

import Accordion from '@/components/Accordion'
import Icon from '@/components/Icon'
import Title from '@/components/Title'
import ImageSettings from './image-settings/-index'
import VideoSettings from './video-settings/-index'
import { appProxy } from '../../-state'

type OutputSettingsProps = {
  mediaIndex: number
}
function OutputSettings({ mediaIndex }: OutputSettingsProps) {
  const {
    state: { activeTab, media, selectedMediaIndexForCustomization },
  } = useSnapshot(appProxy)

  useEffect(() => {
    if (media.length === 1) {
      appProxy.state.activeTab = 'all'
    }
  }, [media.length])

  return (
    <div>
      {activeTab === 'videos' ||
      (media.length === 1 && media[0].type === 'video') ||
      (selectedMediaIndexForCustomization !== -1 &&
        media[selectedMediaIndexForCustomization]?.type === 'video') ? (
        <VideoSettings mediaIndex={mediaIndex} />
      ) : activeTab === 'images' ||
        (media.length === 1 && media[0].type === 'image') ||
        (selectedMediaIndexForCustomization !== -1 &&
          media[selectedMediaIndexForCustomization]?.type === 'image') ? (
        <ImageSettings mediaIndex={mediaIndex} />
      ) : (
        <div className="mx-[-6px]">
          <Accordion isCompact keepContentMounted variant="splitted">
            <AccordionItem
              key="1"
              aria-label="视频设置"
              title={<Title title="视频设置" className="text-md text-left" />}
              startContent={<Icon name="video" size={25} />}
              classNames={{
                base: 'bg-transparent border-1 border-zinc-200 dark:border-zinc-900 px-2',
              }}
              indicator={({ isOpen }) => (
                <Icon name="caret" className={isOpen ? '-rotate-90' : ''} />
              )}
            >
              <VideoSettings mediaIndex={mediaIndex} />
            </AccordionItem>
            <AccordionItem
              key="2"
              aria-label="图片设置"
              title={<Title title="图片设置" className="text-md text-left" />}
              startContent={<Icon name="image" size={25} />}
              classNames={{
                base: 'bg-transparent border-1 border-zinc-200 dark:border-zinc-900 px-2',
              }}
              indicator={({ isOpen }) => (
                <Icon name="caret" className={isOpen ? '-rotate-90' : ''} />
              )}
            >
              <ImageSettings mediaIndex={mediaIndex} />
            </AccordionItem>
          </Accordion>
        </div>
      )}
    </div>
  )
}

export default memo(OutputSettings)
