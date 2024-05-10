import type { Config } from "tailwindcss";
import { nextui } from "@nextui-org/theme";

const WIDTHS = Object.freeze({
  xs: "320px",
  sm: "576px",
  md: "768px",
  lg: "992px",
  xl: "1280px",
  "2xl": "1440px",
  "3xl": "1660px",
});

const config: Config = {
  darkMode: "class",
  plugins: [
    nextui({
      addCommonColors: true,
    }),
  ],
  content: [
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
    // NextUI Components
    "./node_modules/@nextui-org/theme/dist/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "gradient-conic":
          "conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))",
      },
      colors: {
        primary: "#7f46e2",
        secondary: "#ff6ae7",
        black1: "#000000",
        gray1: "#c2c2c2",
        white1: "#ffffff",
      },
      fontFamily: {
        poppins: ["var(--font-poppins)"],
      },
      screens: WIDTHS,
      maxWidth: WIDTHS,
      animation: {
        "meteor-effect": "meteor 5s linear infinite",
      },
      keyframes: {
        meteor: {
          "0%": { transform: "rotate(215deg) translateX(0)", opacity: "1" },
          "70%": { opacity: "1" },
          "100%": {
            transform: "rotate(215deg) translateX(-500px)",
            opacity: "0",
          },
        },
      },
    },
  },
};
export default config;
