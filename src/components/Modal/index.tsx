import React from 'react'
import {
  Modal as NextUIModal,
  ModalHeader as NextUIModalHeader,
  ModalBody as NextUIModalBody,
  ModalContent as NextUIModalContent,
  ModalFooter as NextUIModalFooter,
  type ModalProps as NextUIModalProps,
  type ModalHeaderProps as NextUIModalHeaderProps,
  type ModalBodyProps as NextUIModalBodyProps,
  type ModalContentProps as NextUIModalContentProps,
  type ModalFooterProps as NextUIModalFooterProps,
} from '@nextui-org/modal'
import { cn } from '@/utils/tailwind'
import { getPlatform } from '@/utils/fs'
import { BackdropBlurContent } from '@/ui/BackdropBlur'
import { zoomIn, bottomToTop } from './modal.animation'

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
