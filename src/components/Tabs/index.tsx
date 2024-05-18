import React from 'react'
import {
  Tabs as NextUITabs,
  Tab as NextUITab,
  type TabsProps as NextUITabsProps,
  type TabItemProps as NextUITabProps,
} from '@nextui-org/tabs'

interface TabsProps extends NextUITabsProps {}

function Tabs(props: TabsProps) {
  return <NextUITabs {...props} />
}

interface TabProps extends NextUITabProps {}

export function Tab(props: TabProps) {
  return <NextUITab {...props} />
}

export default Tabs
