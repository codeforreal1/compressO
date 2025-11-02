import {
  Tab as NextUITab,
  type TabItemProps as NextUITabProps,
  Tabs as NextUITabs,
  type TabsProps as NextUITabsProps,
} from '@heroui/tabs'

interface TabsProps extends NextUITabsProps {}

function Tabs(props: TabsProps) {
  return <NextUITabs {...props} />
}

interface TabProps extends NextUITabProps {}

export function Tab(props: TabProps) {
  return <NextUITab {...props} />
}

export default Tabs
