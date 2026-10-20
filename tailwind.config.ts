import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { heroui } from '@heroui/react'
import typography from '@tailwindcss/typography'
import type { Config } from 'tailwindcss'

const require = createRequire(import.meta.url)
const herouiThemePath = dirname(
  require.resolve('@heroui/theme', {
    paths: [require.resolve('@heroui/react')],
  }),
).replace(/\\/g, '/')

const WIDTHS = Object.freeze({
  xs: '320px',
  sm: '576px',
  md: '768px',
  slg: '850px',
  lg: '992px',
  xl: '1280px',
  '2xl': '1440px',
  '3xl': '1660px',
})

const CUSTOM_MQ = {
  hxs: { raw: `(min-height: ${WIDTHS.xs})` },
  hsm: { raw: `(min-height: ${WIDTHS.sm})` },
  hmd: { raw: `(min-height: ${WIDTHS.md})` },
  hslg: { raw: `(min-height: ${WIDTHS.slg})` },
  hlg: { raw: `(min-height: ${WIDTHS.lg})` },
  hxl: { raw: `(min-height: ${WIDTHS.xl})` },
  h2xl: { raw: `(min-height: ${WIDTHS['2xl']})` },
  h3xl: { raw: `(min-height: ${WIDTHS['3xl']})` },
}

const config: Config = {
  darkMode: 'class',
  plugins: [
    heroui({
      addCommonColors: true,
    }),
    typography,
  ],
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
    `${herouiThemePath}/**/*.{js,ts,jsx,tsx}`,
  ],
  theme: {
    extend: {
      animation: {
        ripple: 'var(--animate-ripple)',
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic':
          'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
      },
      colors: {
        primary: 'rgb(var(--color-primary) / <alpha-value>)',
        secondary: 'rgb(var(--color-secondary) / <alpha-value>)',
        black1: 'rgb(var(--color-black1) / <alpha-value>)',
        gray1: 'rgb(var(--color-gray1) / <alpha-value>)',
        white1: 'rgb(var(--color-white1) / <alpha-value>)',
      },
      fontFamily: {
        poppins: ['var(--font-poppins)'],
      },
      screens: { ...WIDTHS, ...CUSTOM_MQ },
      maxWidth: WIDTHS,
    },
  },
}
export default config
