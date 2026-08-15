import { PopoverContent, PopoverTrigger } from '@heroui/react'
import React, { useCallback } from 'react'
import { RgbColorPicker } from 'react-colorful'

import Button from '@/components/Button'
import Popover from '@/components/Popover'
import { DEFAULT_PRIMARY_COLOR } from '@/hooks/usePrimaryColor'

type RgbColor = { r: number; g: number; b: number }

function rgbStringToObject(rgb: string): RgbColor {
  const [r, g, b] = rgb.split(' ').map(Number)
  return { r, g, b }
}

function rgbObjectToString(rgb: RgbColor): string {
  return `${rgb.r} ${rgb.g} ${rgb.b}`
}

type ColorPickerProps = {
  color: string
  defaultColor?: string
  onChange?: (color: string) => void
}

function ColorPicker({
  color,
  defaultColor = DEFAULT_PRIMARY_COLOR,
  onChange,
}: ColorPickerProps) {
  const rgbColor = React.useMemo(() => rgbStringToObject(color), [color])

  const [inputValue, setInputValue] = React.useState(
    `rgb(${rgbColor.r}, ${rgbColor.g}, ${rgbColor.b})`,
  )

  React.useEffect(() => {
    setInputValue(`rgb(${rgbColor.r}, ${rgbColor.g}, ${rgbColor.b})`)
  }, [rgbColor])

  const handleColorChange = useCallback(
    (newRgb: RgbColor) => {
      const rgbString = rgbObjectToString(newRgb)
      onChange?.(rgbString)
    },
    [onChange],
  )

  const handleInputBlur = useCallback(() => {
    // Parse different RGB formats:
    // - rgb(127, 70, 226)
    // - 127, 70, 226
    // - 127 70 226
    const rgbMatch =
      inputValue.match(/rgb\s*\((\d+),\s*(\d+),\s*(\d+)\)/i) ||
      inputValue.match(/^(\d+)[,\s]+(\d+)[,\s]+(\d+)$/)

    if (rgbMatch) {
      const [, r, g, b] = rgbMatch
      handleColorChange({ r: Number(r), g: Number(g), b: Number(b) })
    } else {
      setInputValue(`rgb(${rgbColor.r}, ${rgbColor.g}, ${rgbColor.b})`)
    }
  }, [inputValue, rgbColor, handleColorChange])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.currentTarget.blur()
      }
    },
    [],
  )

  return (
    <div className="flex items-center gap-2">
      <Popover placement="bottom" showArrow>
        <PopoverTrigger>
          <div
            className="w-8 h-8 rounded-xl cursor-pointer border-2 border-zinc-200 dark:border-zinc-700 shadow-sm"
            style={{ backgroundColor: `rgb(${color})` }}
          />
        </PopoverTrigger>
        <PopoverContent>
          <div className="p-3">
            <RgbColorPicker color={rgbColor} onChange={handleColorChange} />
            <div className="mt-3 text-center">
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onBlur={handleInputBlur}
                onKeyDown={handleKeyDown}
                placeholder="rgb(127, 70, 226)"
                className="w-[200px] px-2 py-1 text-sm text-center border rounded-lg bg-white dark:bg-zinc-800 dark:border-zinc-600 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            {color !== defaultColor ? (
              <Button
                fullWidth
                size="sm"
                className="mt-2"
                color="danger"
                onPress={() => {
                  onChange?.(defaultColor)
                }}
              >
                重置
              </Button>
            ) : null}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}

export default ColorPicker
