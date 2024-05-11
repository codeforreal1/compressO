import React from "react";
import {
  Tooltip as NextUITooltip,
  type TooltipProps as NextUITooltipProps,
} from "@nextui-org/tooltip";

interface TooltipProps extends NextUITooltipProps {}

function Tooltip(props: TooltipProps) {
  return (
    <NextUITooltip delay={1000} showArrow size="sm" {...props}>
      <span>{props?.children}</span>
    </NextUITooltip>
  );
}

export default Tooltip;
