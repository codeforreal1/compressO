import React from "react";
import {
  Code as NextUICode,
  type CodeProps as NextUICodeProps,
} from "@nextui-org/code";

interface CodeProps extends NextUICodeProps {}

function Code(props: CodeProps) {
  return <NextUICode {...props} />;
}

export default Code;
