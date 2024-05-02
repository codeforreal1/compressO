import localFont from "next/font/local";

const kayakRegular = localFont({
  preload: true,
  variable: "--font-poppins",
  src: [
    {
      path: "./poppins/Poppins-Regular.ttf",
      weight: "400",
      style: "normal",
    },
    {
      path: "./poppins/Poppins-Italic.ttf",
      weight: "400",
      style: "italic",
    },
  ],
});

const fonts = [kayakRegular];

export const combinedFonts = fonts
  .map((font) => `${font.className} ${font.variable}`)
  .join(" ");
