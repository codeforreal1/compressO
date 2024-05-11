import React from "react";
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
} from "@nextui-org/modal";

interface ModalProps extends NextUIModalProps {}

function Modal(props: ModalProps) {
  return (
    <NextUIModal
      motionProps={{
        initial: {
          rotate: -3,
          scale: 0.9,
        },
        animate: {
          scale: 1,
          opacity: 1,
          rotate: 0,
          transition: {
            type: "spring",
            duration: 0.5,
            bounce: 0.3,
          },
        },
        exit: {
          scale: 0.9,
          opacity: 0,
          rotate: 3,
          transition: {
            type: "spring",
            duration: 0.5,
            bounce: 0.3,
          },
        },
      }}
      {...props}
    />
  );
}

interface ModalHeaderProps extends NextUIModalHeaderProps {}

export function ModalHeader(props: ModalHeaderProps) {
  return <NextUIModalHeader {...props} />;
}

interface ModalBodyProps extends NextUIModalBodyProps {}

export function ModalBody(props: ModalBodyProps) {
  return <NextUIModalBody {...props} />;
}

interface ModalContentProps extends NextUIModalContentProps {}

export function ModalContent(props: ModalContentProps) {
  return <NextUIModalContent {...props} />;
}

interface ModalFooterProps extends NextUIModalFooterProps {}

export function ModalFooter(props: ModalFooterProps) {
  return <NextUIModalFooter {...props} />;
}

export default Modal;
