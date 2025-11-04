import {
  Modal as NextUIModal,
  ModalBody as NextUIModalBody,
  type ModalBodyProps as NextUIModalBodyProps,
  ModalContent as NextUIModalContent,
  type ModalContentProps as NextUIModalContentProps,
  ModalFooter as NextUIModalFooter,
  type ModalFooterProps as NextUIModalFooterProps,
  ModalHeader as NextUIModalHeader,
  type ModalHeaderProps as NextUIModalHeaderProps,
  type ModalProps as NextUIModalProps,
} from '@heroui/modal'
import React from 'react'

import { BackdropBlurContent } from '@/ui/BackdropBlur'
import { getPlatform } from '@/utils/fs'
import { cn } from '@/utils/tailwind'
import { bottomToTop, zoomIn } from './modal.animation'

const { isWindows, isMacOS } = getPlatform()

interface ModalProps extends NextUIModalProps {
  motionVariant?: 'zoomIn' | 'bottomToTop'
}
function Modal({ motionVariant, ...props }: ModalProps) {
  return (
    <NextUIModal
      hideCloseButton
      motionProps={{
        variants: { zoomIn, bottomToTop }?.[motionVariant ?? 'zoomIn'],
      }}
      {...props}
    />
  )
}

interface ModalHeaderProps extends NextUIModalHeaderProps {}
export function ModalHeader(props: ModalHeaderProps) {
  return <NextUIModalHeader {...props} />
}

interface ModalBodyProps extends NextUIModalBodyProps {}
export function ModalBody(props: ModalBodyProps) {
  return <NextUIModalBody {...props} />
}

interface ModalContentProps extends NextUIModalContentProps {
  children: React.ReactNode
}
export function ModalContent(props: ModalContentProps) {
  return (
    <NextUIModalContent
      {...props}
      className={cn([
        isMacOS || isWindows ? 'relative bg-transparent' : '',
        props?.className,
      ])}
    >
      {props?.children}
      {isMacOS || isWindows ? <BackdropBlurContent /> : null}
    </NextUIModalContent>
  )
}

interface ModalFooterProps extends NextUIModalFooterProps {}
export function ModalFooter(props: ModalFooterProps) {
  return <NextUIModalFooter {...props} />
}

export default Modal
