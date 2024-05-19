import React from 'react'
import { Drawer as NativeDrawer } from 'vaul'

type RenderTriggererArgs = {
  isOpened: boolean
  open: () => void
}

type DrawerProps = {
  children: React.ReactNode
  renderTriggerer: (_: RenderTriggererArgs) => React.ReactNode
}

function Drawer({ children, renderTriggerer }: DrawerProps) {
  const [isOpened, setIsOpened] = React.useState(false)

  const open = () => {
    setIsOpened(true)
  }

  return (
    <NativeDrawer.Root
      shouldScaleBackground
      noBodyStyles
      open={isOpened}
      onClose={() => {
        setIsOpened(false)
      }}
    >
      <NativeDrawer.Trigger asChild>
        {renderTriggerer?.({ isOpened, open })}
      </NativeDrawer.Trigger>
      <NativeDrawer.Portal>
        <NativeDrawer.Overlay
          className="fixed inset-0 bg-black/40"
          onClick={() => {
            setIsOpened(false)
          }}
        />
        <NativeDrawer.Content className="bg-zinc-100 dark:bg-[#191919] flex flex-col rounded-t-[20px] mt-24 fixed bottom-0 left-0 right-0">
          <div className="mx-auto w-12 h-1.5 flex-shrink-0 rounded-full bg-zinc-300 dark:bg-black1 my-2" />
          {children}
        </NativeDrawer.Content>
      </NativeDrawer.Portal>
    </NativeDrawer.Root>
  )
}

export default Drawer
