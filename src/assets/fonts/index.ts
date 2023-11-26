import { Poppins as GooglePoppins } from 'next/font/google'

const Poppins = GooglePoppins({
  weight: ['400', '500'],
  variable: '--font-Poppins',
  subsets: ['latin'],
})

const fonts = [Poppins]

export const combinedFonts = fonts
  .map((font) => `${font.className} ${font.variable}`)
  .join(' ')
