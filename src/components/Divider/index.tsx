import React from 'react'
import {
  Divider as NextUIDivider,
  type DividerProps as NextUIDividerProps,
} from '@nextui-org/divider'

interface DividerProps extends NextUIDividerProps {}

function Divider(props: DividerProps) {
  return <NextUIDivider {...props} />
}

export default Divider
