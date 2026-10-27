import { AccordionItem } from '@heroui/react'
import { memo, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
  const {
    state: { activeTab, media, selectedMediaIndexForCustomization },
  } = useSnapshot(appProxy)

  useEffect(() => {
    if (media.length === 1) {
      appProxy.state.activeTab = 'all'
    }
  }, [media.length])

  const customizedMedia =
    selectedMediaIndexForCustomization !== -1
      ? media[selectedMediaIndexForCustomization]
      : null
  const singleMedia = customizedMedia ?? (media.length === 1 ? media[0] : null)

  // A single media (or one being customized in a batch) shows its own settings
  if (singleMedia) {
    return singleMedia.type === 'image' ? (
      <ImageSettings mediaIndex={mediaIndex} />
    ) : (
      <VideoSettings mediaIndex={mediaIndex} />
    )
  }

  // A batch: the settings of the kind of media shown, or of every kind (whatever it holds)
  const sections = [
    (activeTab === 'videos' || activeTab === 'all') && {
      key: 'video',
      title: t('outputSettings.video'),
      icon: 'video' as const,
      content: <VideoSettings mediaIndex={mediaIndex} />,
    },
    (activeTab === 'images' || activeTab === 'all') && {
      key: 'image',
      title: t('outputSettings.image'),
      icon: 'image' as const,
      content: <ImageSettings mediaIndex={mediaIndex} />,
    },
    (activeTab === 'audio' || activeTab === 'all') && {
      key: 'audio',
      title: t('outputSettings.audio'),
      icon: 'music' as const,
      content: (
        <VideoSettings
          mediaIndex={mediaIndex}
          batchConfigKey="audioFileConfig"
        />
      ),
    },
  ].filter((section) => !!section)

  if (sections.length === 1) {
    return <div>{sections[0].content}</div>
  }

  return (
    <div className="mx-[-6px]">
      <Accordion isCompact keepContentMounted variant="splitted">
        {sections.map((section) => (
          <AccordionItem
            key={section.key}
            aria-label={section.title}
            title={
              <Title title={section.title} className="text-md text-left" />
            }
            startContent={<Icon name={section.icon} size={25} />}
            classNames={{
              // Without the splitted variant's shadow, which spread into a grey band behind the
              // items in light mode; the border sets them apart
              base: 'bg-transparent shadow-none border-1 border-zinc-200 dark:border-zinc-900 px-2',
            }}
            indicator={({ isOpen }) => (
              <Icon name="caret" className={isOpen ? '-rotate-90' : ''} />
            )}
          >
            {section.content}
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  )
}

export default memo(OutputSettings)
