import {
  Code as NextUICode,
  type CodeProps as NextUICodeProps,
} from '@heroui/code'

interface CodeProps extends NextUICodeProps {}

function Code(props: CodeProps) {
  return <NextUICode {...props} />
}

export default Code
