import React from "react";
import type { Metadata } from "next";
import { Toaster } from "sonner";

import "./globals.css";
import UIProvider from "../providers/UIProvider";
import ThemeProvider from "../providers/ThemeProvider";
import { combinedFonts } from "@/assets/fonts";
import Head from "./head";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <Head />
      <body className={combinedFonts}>
        <ThemeProvider>
          <UIProvider>
            {children}
            <Toaster />
          </UIProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

export const metadata: Metadata = {
  title: "CompressO",
  description: "Compress your video to smallest size possible.",
};
