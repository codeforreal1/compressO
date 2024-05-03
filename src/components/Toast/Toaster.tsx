import React from "react";
import { Toaster as NativeToaster } from "sonner";
import { useTheme } from "next-themes";

function Toaster() {
  const { theme } = useTheme();
  return (
    <NativeToaster richColors theme={theme === "dark" ? "dark" : "light"} />
  );
}

export default Toaster;
