"use client";

import React from "react";

import "./globals.css";
import UIProvider from "../providers/UIProvider";
import ThemeProvider from "../providers/ThemeProvider";
import { combinedFonts } from "@/assets/fonts";
import Head from "./head";
import Toaster from "@/components/Toast/Toaster";

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
          <UIProvider>{children}</UIProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
