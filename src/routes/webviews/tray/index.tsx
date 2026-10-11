import { createFileRoute } from '@tanstack/react-router'

import Button from '@/components/Button'
import Image from '@/components/Image'
import { toast } from '@/components/Toast'
import {
  closeTrayPopover,
  focusMainWindow,
  quitApp,
} from '@/tauri/commands/tray'

export const Route = createFileRoute('/webviews/tray/')({
  component: TrayWindow,
})

function TrayWindow() {
  const handleOpenMainWindow = async () => {
    try {
      await focusMainWindow()
      await closeTrayPopover()
    } catch {
      toast.error('CompressO could not be opened.')
    }
  }

  const handleQuitApp = async () => {
    try {
      await quitApp()
    } catch {
      toast.error('CompressO could not be quit.')
    }
  }

  return (
    <div className="w-screen h-screen overflow-auto p-4 flex flex-col">
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <Image
          disableAnimation
          src="/logo.png"
          alt="logo"
          width={64}
          height={64}
        />
        <div className="text-center">
          <h2 className="text-lg font-bold text-primary">CompressO</h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Version {window.__appVersion}
          </p>
        </div>
        <Button size="sm" className="mt-2" onPress={handleOpenMainWindow}>
          Open CompressO
        </Button>
      </div>
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="light"
          color="danger"
          onPress={handleQuitApp}
        >
          Quit CompressO
        </Button>
      </div>
    </div>
  )
}
