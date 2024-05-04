"use client";

import React from "react";
import { ClassValue } from "clsx";

import { mergeClasses } from "@/utils/tailwind";
import Header from "./Header";
import Footer from "./Footer";

interface LayoutProps {
  children: React.ReactNode;
  containerClassName?: ClassValue;
  className?: ClassValue;
  // handleDarkModeByDefault?: boolean
}

export const LayoutContext = React.createContext<{
  isValid: boolean;
}>({
  isValid: false,
});
LayoutContext.displayName = "LayoutContext";

const Layout = function (props: LayoutProps) {
  const { children, containerClassName, className } = props;

  const main: React.ReactNode[] = [];
  const header: React.ReactNode[] = [];
  const footer: React.ReactNode[] = [];

  (function () {
    React.Children.forEach(children, function (child) {
      const _child = child as React.ReactNode & Record<"type", React.ReactNode>;

      switch (_child.type) {
        case Header: {
          header.push(child);
          break;
        }
        case Footer: {
          footer.push(child);
          break;
        }
        default: {
          main.push(child);
        }
      }
    });
  })();

  return (
    <LayoutContext.Provider value={{ isValid: true }}>
      <section className={mergeClasses(["w-full", containerClassName])}>
        {header}
        <div className={mergeClasses(["max-w-2xl mx-auto", className])}>
          {main}
        </div>
        {footer}
      </section>
    </LayoutContext.Provider>
  );
};

Layout.Header = Header;
Layout.Footer = Footer;

export default Layout;
