import React from "react";
import {
  CircularProgress as NextUICircularProgress,
  type CircularProgressProps as NextUICircularProgressProps,
} from "@nextui-org/progress";

interface CircularProgressProps extends NextUICircularProgressProps {}

function CircularProgress(props: CircularProgressProps) {
  return <NextUICircularProgress {...props} />;
}

export default CircularProgress;
