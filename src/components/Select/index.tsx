import React from "react";
import {
  Select as NextUISelect,
  SelectItem as NextUISelectItem,
  type SelectProps as NextUISelectProps,
  type SelectItemProps as NextUISelectItemProps,
} from "@nextui-org/select";

interface SelectProps extends NextUISelectProps {}

function Select(props: SelectProps) {
  return <NextUISelect {...props} />;
}

interface SelectItemProps extends NextUISelectItemProps {}

export function SelectItem(props: SelectItemProps) {
  return <NextUISelectItem {...props} />;
}

export default Select;
