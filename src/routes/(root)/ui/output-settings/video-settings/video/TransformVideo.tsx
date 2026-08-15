import { core } from '@tauri-apps/api'
import { useSnapshot } from 'valtio'

import Button from '@/components/Button'
import Icon from '@/components/Icon'
import Switch from '@/components/Switch'
import { appProxy } from '../../../../-state'

type TransformVideoProps = {
  mediaIndex: number
}

function TransformVideo({ mediaIndex }: TransformVideoProps) {
  if (mediaIndex < 0) return

  const {
    state: { media, isCompressing, isProcessCompleted, isLoadingMediaFiles },
  } = useSnapshot(appProxy)
  const video =
    media.length > 0 && media[mediaIndex].type === 'video'
      ? media[mediaIndex]
      : null
  const { config } = video ?? {}
  const { shouldTransformVideo, isVideoTransformEditMode } = config ?? {}

  const shouldDisableInput =
    media.length === 0 ||
    isCompressing ||
    isProcessCompleted ||
    isLoadingMediaFiles

  return (
    <div className="w-full flex">
      <Switch
        isSelected={shouldTransformVideo}
        onValueChange={() => {
          if (
            appProxy.state.media[mediaIndex].type === 'video' &&
            appProxy.state.media[mediaIndex]?.config
          ) {
            appProxy.state.media[mediaIndex].config.shouldTransformVideo =
              !shouldTransformVideo
            appProxy.state.media[mediaIndex].config.isVideoTransformEditMode =
              !shouldTransformVideo
            appProxy.state.media[mediaIndex].config.isVideoTrimEditMode = false
            appProxy.state.media[mediaIndex].isConfigDirty = true

            if (shouldTransformVideo) {
              appProxy.state.media[mediaIndex].config.transformVideoConfig =
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
      {shouldTransformVideo ? (
        isVideoTransformEditMode ? (
          <Button
            size="sm"
            color="success"
            onPress={() => {
              if (appProxy.state.media[mediaIndex].type === 'video') {
                appProxy.state.media[
                  mediaIndex
                ].config.isVideoTransformEditMode = false
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
              if (appProxy.state.media[mediaIndex].type === 'video') {
                appProxy.state.media[
                  mediaIndex
                ].config.isVideoTransformEditMode = true
                appProxy.state.media[mediaIndex].config.isVideoTrimEditMode =
                  false
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

export default TransformVideo
