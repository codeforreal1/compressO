import {
  Tab as NextUITab,
  type TabItemProps as NextUITabProps,
  Tabs as NextUITabs,
  type TabsProps as NextUITabsProps,
} from '@heroui/react'

import { glassSurface, glassTrack, mergeClassNames } from '@/utils/glass'
import { cn } from '@/utils/tailwind'

interface TabsProps extends NextUITabsProps {}

/** The chosen tab is a frosted glass surface on a faint track (see `utils/glass.ts`) */
function Tabs(props: TabsProps) {
  return (
    <NextUITabs
      {...props}
      classNames={mergeClassNames(
        {
          tabList: glassTrack,
          cursor: cn(glassSurface, 'bg-transparent dark:bg-transparent'),
        },
        props.classNames,
      )}
    />
  )
}

interface TabProps extends NextUITabProps {}

export function Tab(props: TabProps) {
  return <NextUITab {...props} />
}

export default Tabs
