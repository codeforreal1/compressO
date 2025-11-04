import { Link as NextLink, LinkProps as NextLinkProps } from '@heroui/link'

interface LinkProps {}

function Link(props: LinkProps & NextLinkProps) {
  const { ...nextLinkProps } = props
  return <NextLink {...nextLinkProps} />
}

export default Link
