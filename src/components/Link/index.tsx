import React from 'react'
import { Link as NextLink, LinkProps as NextLinkProps } from '@nextui-org/link'

interface LinkProps {}

function Link(props: LinkProps & NextLinkProps) {
  const { ...nextLinkProps } = props
  return <NextLink {...nextLinkProps} />
}

export default Link
