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
} from '@heroui/react'
import React, { forwardRef } from 'react'
import { useSnapshot } from 'valtio'

import { isWindowTintSupported } from '@/hooks/useWindowTint'
import { settingsStore } from '@/stores/settingsStore'
import { BackdropBlurContent } from '@/ui/BackdropBlur'
import { cn } from '@/utils/tailwind'
import modalAnimationVariants from './modal.animation'

interface ModalProps extends NextUIModalProps {
  motionVariant?: keyof typeof modalAnimationVariants
}
const Modal = forwardRef<HTMLDivElement, ModalProps>(
  ({ motionVariant, ...props }, ref) => {
    return (
      <NextUIModal
        ref={ref}
        hideCloseButton
        motionProps={{
          variants: modalAnimationVariants?.[motionVariant ?? 'zoomIn'],
        }}
        {...props}
      />
    )
  },
)

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
  // Translucent (blurred) with the tinted window (General -> Tinted window), otherwise opaque
  const { tintedWindow } = useSnapshot(settingsStore)
  const isTranslucent = isWindowTintSupported && tintedWindow

  return (
    <NextUIModalContent
      {...props}
      className={cn([
        isTranslucent
          ? 'relative bg-transparent'
          : 'bg-zinc-100 dark:bg-zinc-900',
        props?.className,
      ])}
    >
      {props?.children}
      {isTranslucent ? <BackdropBlurContent /> : null}
    </NextUIModalContent>
  )
}

interface ModalFooterProps extends NextUIModalFooterProps {}
export function ModalFooter(props: ModalFooterProps) {
  return <NextUIModalFooter {...props} />
}

export default Modal
