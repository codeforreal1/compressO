import { PopoverContent, PopoverTrigger } from '@heroui/react'
import {
  Timeline,
  TimelineEditor,
  TimelineState,
} from '@xzdarcy/react-timeline-editor'
import {
  TimelineAction,
  TimelineEffect,
  TimelineRow,
} from '@xzdarcy/timeline-engine'
import { cloneDeep } from 'lodash'
import {
  FC,
  ForwardedRef,
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useState,
} from 'react'

import { BoundaryRowActionRender, ScaleRender } from '@/components/Timeline'
import Button from '../../components/Button'
import Code from '../../components/Code'
import Icon from '../../components/Icon'
import Popover from '../../components/Popover'
import { TimelineScales } from '../../components/Timeline/useTimelineEngine'

export const rowIds = {
  videoBoundary: 'video-boundary',
  videoTrim: 'video-trim',
} as const

const effects = {
  effectVideoBoundary: {
    id: rowIds.videoBoundary,
  },
  effectVideoTrim: {
    id: rowIds.videoTrim,
  },
} satisfies Record<string, TimelineEffect>

const generateActionId = () =>
  `trim_action_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`

/**
 * Updates the minStart and maxEnd constraints for all trim actions to prevent overlaps while allowing movement within available left/right space
 */
const updateActionConstraints = (
  actions: TimelineAction[],
  videoDuration: number,
): TimelineAction[] => {
  const sortedActions = [...actions].sort((a, b) => a.start - b.start)

  return sortedActions.map((action, index) => {
    const leftNeighbor = index > 0 ? sortedActions[index - 1] : null
    const rightNeighbor =
      index < sortedActions.length - 1 ? sortedActions[index + 1] : null

    const minStart = leftNeighbor ? leftNeighbor.end : 0
    const maxEnd = rightNeighbor ? rightNeighbor.start : videoDuration

    return {
      ...action,
      minStart,
      maxEnd,
    }
  })
}

const getDefaultEditorData = ({
  duration,
  trimActions,
}: {
  duration: number
  trimActions?: TimelineAction[]
}): TimelineRow[] => {
  const defaultTrimActions =
    trimActions && trimActions.length > 0
      ? cloneDeep(trimActions)
      : [
          {
            id: generateActionId(),
            start: 0,
            minStart: 0,
            end: duration,
            maxEnd: duration,
            effectId: effects.effectVideoTrim.id,
            movable: true,
          },
        ]
  return [
    {
      id: rowIds.videoBoundary,
      rowHeight: 25,
      actions: [
        {
          id: 'action0',
          start: 0,
          minStart: 0,
          end: duration,
          maxEnd: duration,
          effectId: effects.effectVideoBoundary.id,
          movable: false,
          disable: true,
          flexible: false,
        },
      ],
    },
    {
      id: rowIds.videoTrim,
      actions: defaultTrimActions,
    },
  ]
}

export const scales: TimelineScales = {
  scale: 1,
  scaleWidth: 80,
  startLeft: 20,
} as const

export const TrimRowActionRenderer: FC<{
  action: TimelineAction
  row: TimelineRow
  onSplit?: (actionId: string, splitTime: number) => void
  onClick?: (actionId: string) => void
  isSelected?: boolean
}> = ({ action, onSplit, onClick, isSelected = false }) => {
  const handleSplitClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (e.detail === 1) {
      onClick?.(action.id)
    } else if (e.detail === 2) {
      const rect = e.currentTarget.getBoundingClientRect()
      const clickX = e.clientX - rect.left
      const clickRatio = clickX / rect.width
      const splitTime = action.start + (action.end - action.start) * clickRatio
      onSplit?.(action.id, splitTime)
    }
  }

  return (
    <div
      className={`flex justify-center items-center h-8 rounded-lg cursor-pointer group relative bg-primary`}
      onClick={handleSplitClick}
    >
      <div className="text-center text-white1">{`${(
        action.end - action.start
      ).toFixed(2)}s`}</div>
      <div className="absolute inset-0 border-2 border-white/30 opacity-0 group-hover:opacity-100 rounded-lg pointer-events-none" />
      {isSelected ? (
        <>
          <div className="absolute inset-0 bg-black/20 dark:bg-white/20 rounded-lg pointer-events-none border-2 border-black1 dark:border-white1" />
        </>
      ) : null}
    </div>
  )
}

export interface VideoTrimmerTimelineProps
  extends Omit<TimelineEditor, 'editorData' | 'effects'> {
  id: string
  duration: number
  initialTrimActions?: TimelineAction[]
  onChange?: (data: TimelineRow[]) => void
  onEditorDataChange?: (data: TimelineRow[]) => void
}

export interface VideoTrimmerTimelineRef extends TimelineState {}

const TRIM_INSTRUCTIONS_HIDDEN_KEY = 'video-trimmer-instructions-hidden'

const VideoTrimmerTimeline = forwardRef(
  (
    {
      id,
      duration,
      initialTrimActions,
      style,
      onChange,
      onEditorDataChange,
      ...props
    }: VideoTrimmerTimelineProps,
    forwardedRef: ForwardedRef<VideoTrimmerTimelineRef>,
  ) => {
    const [editorData, setEditorData] = useState<TimelineRow[]>(() =>
      getDefaultEditorData({ duration, trimActions: initialTrimActions }),
    )
    const [selectedActionId, setSelectedActionId] = useState<string | null>(
      null,
    )
    const [areInstructionsHidden, setAreInstructionsHidden] = useState(() => {
      if (typeof window !== 'undefined') {
        return localStorage.getItem(TRIM_INSTRUCTIONS_HIDDEN_KEY) === 'true'
      }
      return false
    })

    const updateEditorDataWithConstraints = useCallback(
      (newData: TimelineRow[] | ((prev: TimelineRow[]) => TimelineRow[])) => {
        setEditorData((prevData) => {
          const updatedData =
            typeof newData === 'function' ? newData(prevData) : newData

          return updatedData.map((row) => {
            if (row.id === rowIds.videoTrim) {
              return {
                ...row,
                actions: updateActionConstraints(row.actions, duration),
              }
            }
            return row
          })
        })
      },
      [duration],
    )

    const handleSplitAction = useCallback(
      (actionId: string, splitTime: number) => {
        updateEditorDataWithConstraints((prevData) =>
          prevData.map((row) => {
            if (row.id === rowIds.videoTrim) {
              const actionToSplit = row.actions.find((a) => a.id === actionId)
              if (!actionToSplit) return row

              const minSplitSize = 0.5
              if (
                splitTime - actionToSplit.start < minSplitSize ||
                actionToSplit.end - splitTime < minSplitSize
              ) {
                return row
              }

              const leftAction: TimelineAction = {
                ...actionToSplit,
                id: generateActionId(),
                end: splitTime,
              }
              const rightAction: TimelineAction = {
                ...actionToSplit,
                id: generateActionId(),
                start: splitTime,
              }

              const newActions = row.actions.flatMap((action) =>
                action.id === actionId ? [leftAction, rightAction] : [action],
              )

              setSelectedActionId(null)

              return { ...row, actions: newActions }
            }
            return row
          }),
        )
      },
      [updateEditorDataWithConstraints],
    )

    const handleDeleteAction = useCallback(
      (actionId: string) => {
        if (!actionId) return

        const trimRow = editorData.find((row) => row.id === rowIds.videoTrim)
        const canDelete = trimRow && trimRow.actions.length > 1

        if (!canDelete) {
          return
        }

        updateEditorDataWithConstraints((prevData) =>
          prevData.map((row) => {
            if (row.id === rowIds.videoTrim) {
              if (row.actions.length > 1) {
                const newActions = row.actions.filter(
                  (action) => action.id !== actionId,
                )

                setSelectedActionId(null)

                return { ...row, actions: newActions }
              }
            }
            return row
          }),
        )
      },
      [editorData, updateEditorDataWithConstraints],
    )

    const handleInsertNewAction = useCallback(
      (row: TimelineRow, time: number) => {
        if (row.id !== rowIds.videoTrim) return

        const clickedAction = row.actions.find(
          (action) => time >= action.start && time <= action.end,
        )
        if (clickedAction) {
          return
        }

        const sortedActions = [...row.actions].sort((a, b) => a.start - b.start)

        let leftBoundary = 0
        let rightBoundary = duration

        for (const action of sortedActions) {
          if (action.end <= time) {
            leftBoundary = action.end
          } else if (action.start >= time) {
            rightBoundary = action.start
            break
          }
        }

        const defaultActionDuration = 0.3

        const availableSpace = rightBoundary - leftBoundary
        if (availableSpace < defaultActionDuration) {
          return
        }

        let newActionStart = time - defaultActionDuration / 2
        let newActionEnd = newActionStart + defaultActionDuration

        if (newActionEnd > rightBoundary) {
          newActionEnd = rightBoundary
          newActionStart = rightBoundary - defaultActionDuration
        }

        if (newActionStart < leftBoundary) {
          newActionStart = leftBoundary
          newActionEnd = leftBoundary + defaultActionDuration
        }
        updateEditorDataWithConstraints((prevData) =>
          prevData.map((r) => {
            if (r.id === rowIds.videoTrim) {
              const newAction: TimelineAction = {
                id: generateActionId(),
                start: newActionStart,
                end: newActionEnd,
                effectId: effects.effectVideoTrim.id,
                movable: true,
              }
              return { ...r, actions: [...r.actions, newAction] }
            }
            return r
          }),
        )
      },
      [duration, updateEditorDataWithConstraints],
    )

    useEffect(() => {
      function handleKeyDown(evt: KeyboardEvent) {
        if (evt.key == 'Backspace' || evt.key == 'Delete') {
          handleDeleteAction?.(selectedActionId!)
        }
      }
      if (selectedActionId) {
        window.addEventListener('keydown', handleKeyDown)
      } else {
        window.removeEventListener('keydown', handleKeyDown)
      }
      return () => {
        window.removeEventListener('keydown', handleKeyDown)
      }
    }, [handleDeleteAction, selectedActionId])

    useEffect(() => {
      onEditorDataChange?.(editorData)
    }, [editorData, onEditorDataChange])

    return (
      <div className="w-full space-y-2">
        <Timeline
          key={id}
          ref={forwardedRef}
          editorData={editorData}
          effects={effects}
          autoScroll
          scaleWidth={scales.scaleWidth}
          scale={scales.scale}
          startLeft={scales.startLeft}
          style={{
            width: '100%',
            height: '115px',
            borderRadius: '10px',
            ...(style ?? {}),
          }}
          getActionRender={(action, row) => {
            if (action.effectId === effects.effectVideoBoundary.id) {
              return <BoundaryRowActionRender action={action} row={row} />
            } else if (action.effectId === effects.effectVideoTrim.id) {
              return (
                <TrimRowActionRenderer
                  action={action}
                  row={row}
                  onSplit={handleSplitAction}
                  onClick={setSelectedActionId}
                  isSelected={selectedActionId === action.id}
                />
              )
            }
          }}
          getScaleRender={(scale) => <ScaleRender scale={scale} />}
          {...props}
          onDoubleClickRow={(_, { row, time }) =>
            handleInsertNewAction(row, time)
          }
          onChange={(data) => {
            onChange?.(data)
            updateEditorDataWithConstraints(data)
          }}
        />
        {!areInstructionsHidden ? (
          <div className="w-fit mx-auto">
            <Popover showArrow backdrop="opaque" offset={10} placement="top">
              <PopoverTrigger>
                <Button size="sm">
                  操作说明
                  <Icon name="info" />
                </Button>
              </PopoverTrigger>
              <PopoverContent>
                <div className="p-2">
                  <p className="text-md mb-1">时间轴操作：</p>
                  <p className="text-xs">- 点击选择片段</p>
                  <p className="text-xs">- 双击片段进行分割</p>
                  <p className="text-xs">- 双击空白区域添加新片段</p>
                  <p className="text-xs">
                    - 选择片段并按下{' '}
                    <Code size="sm" className="text-xs py-0 px-1">
                      Delete
                    </Code>{' '}
                    以删除片段
                  </p>
                  <Button
                    size="sm"
                    fullWidth
                    variant="flat"
                    color="danger"
                    className="mt-2"
                    onClick={() => {
                      setAreInstructionsHidden(true)
                      localStorage.setItem(TRIM_INSTRUCTIONS_HIDDEN_KEY, 'true')
                    }}
                  >
                    隐藏操作说明
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        ) : null}
      </div>
    )
  },
)

export default memo(VideoTrimmerTimeline)
