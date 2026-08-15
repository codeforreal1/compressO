import { core } from '@tauri-apps/api'
import { useSnapshot } from 'valtio'

import Button from '@/components/Button'
import Icon from '@/components/Icon'
import Switch from '@/components/Switch'
import { appProxy } from '@/routes/(root)/-state'

type TransformProps = {
  mediaIndex: number
}

function Transform({ mediaIndex }: TransformProps) {
  if (mediaIndex < 0) return

  const {
    state: { media, isCompressing, isProcessCompleted, isLoadingMediaFiles },
  } = useSnapshot(appProxy)
  const image =
    media.length > 0 && media[mediaIndex].type === 'image'
      ? media[mediaIndex]
      : null
  const { config } = image ?? {}
  const { shouldTransformImage, isImageTransformEditMode } = config ?? {}

  const shouldDisableInput =
    media.length === 0 ||
    isCompressing ||
    isProcessCompleted ||
    isLoadingMediaFiles

  return (
    <div className="w-full flex">
      <Switch
        isSelected={shouldTransformImage}
        onValueChange={() => {
          if (
            appProxy.state.media[mediaIndex].type === 'image' &&
            appProxy.state.media[mediaIndex]?.config
          ) {
            appProxy.state.media[mediaIndex].config.shouldTransformImage =
              !shouldTransformImage
            appProxy.state.media[mediaIndex].config.isImageTransformEditMode =
              !shouldTransformImage
            appProxy.state.media[mediaIndex].isConfigDirty = true

            if (shouldTransformImage) {
              appProxy.state.media[mediaIndex].config.transformImageConfig =
                undefined
              appProxy.state.media[mediaIndex].thumbnailPath =
                core.convertFileSrc(
                  appProxy.state.media[mediaIndex].thumbnailPathRaw!,
                )
            }
          }
        }}
        isDisabled={shouldDisableInput}
      >
        <p className="text-gray-600 dark:text-gray-400 text-sm mr-2 w-full">
          变换
        </p>
      </Switch>
      {shouldTransformImage ? (
        isImageTransformEditMode ? (
          <Button
            size="sm"
            color="success"
            onPress={() => {
              if (appProxy.state.media[mediaIndex].type === 'image') {
                appProxy.state.media[
                  mediaIndex
                ].config.isImageTransformEditMode = false
              }
            }}
            className="h-[unset] py-1 ml-auto"
            isDisabled={shouldDisableInput}
          >
            保存
          </Button>
        ) : (
          <Button
            size="sm"
            onPress={() => {
              if (appProxy.state.media[mediaIndex].type === 'image') {
                appProxy.state.media[
                  mediaIndex
                ].config.isImageTransformEditMode = true
              }
            }}
            className="h-[unset] py-1 ml-auto"
            isDisabled={shouldDisableInput}
          >
            <Icon name="pencil" size={16} /> 编辑
          </Button>
        )
      ) : null}
    </div>
  )
}

export default Transform
