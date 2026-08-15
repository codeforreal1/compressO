import { useSnapshot } from 'valtio'

import Button from '@/components/Button'
import Icon from '@/components/Icon'
import Switch from '@/components/Switch'
import { appProxy } from '../../../../-state'

type TrimVideoProps = {
  mediaIndex: number
}

function TrimVideo({ mediaIndex }: TrimVideoProps) {
  if (mediaIndex < 0) return

  const {
    state: { media, isCompressing, isProcessCompleted, isLoadingMediaFiles },
  } = useSnapshot(appProxy)
  const video =
    media.length > 0 && media[mediaIndex].type === 'video'
      ? media[mediaIndex]
      : null
  const { config } = video ?? {}
  const { shouldTrimVideo, isVideoTrimEditMode } = config ?? {}

  const shouldDisableInput =
    media.length === 0 ||
    isCompressing ||
    isProcessCompleted ||
    isLoadingMediaFiles

  return (
    <div className="w-full flex">
      <Switch
        isSelected={shouldTrimVideo}
        onValueChange={() => {
          if (
            appProxy.state.media[mediaIndex].type === 'video' &&
            appProxy.state.media[mediaIndex]?.config
          ) {
            const currentConfig = appProxy.state.media[mediaIndex].config
            const newState = !shouldTrimVideo

            currentConfig.shouldTrimVideo = newState

            if (newState) {
              currentConfig.trimConfig = []
              currentConfig.isVideoTrimEditMode = true
            } else {
              currentConfig.trimConfig = undefined
              currentConfig.isVideoTrimEditMode = false
            }

            currentConfig.isVideoTransformEditMode = false
            appProxy.state.media[mediaIndex].isConfigDirty = true
          }
        }}
        isDisabled={shouldDisableInput}
      >
        <p className="text-gray-600 dark:text-gray-400 text-sm mr-2 w-full">
          裁剪
        </p>
      </Switch>
      {shouldTrimVideo ? (
        isVideoTrimEditMode ? (
          <Button
            size="sm"
            color="success"
            onPress={() => {
              if (appProxy.state.media[mediaIndex].type === 'video') {
                appProxy.state.media[mediaIndex].config.isVideoTrimEditMode =
                  false
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
                appProxy.state.media[mediaIndex].config.isVideoTrimEditMode =
                  true
                appProxy.state.media[
                  mediaIndex
                ].config.isVideoTransformEditMode = false
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

export default TrimVideo
