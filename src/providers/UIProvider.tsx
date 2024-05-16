import React from "react";
import { NextUIProvider } from "@nextui-org/system";

function UIProvider({ children }: { children: React.ReactNode }) {
  return (
    // vaul-drawer-wrapper="" is required here for scaling effect for drawer effect. See @/components/Drawer
    <NextUIProvider vaul-drawer-wrapper="" className="w-full h-full">
      {children}
    </NextUIProvider>
  );
}

export default UIProvider;
