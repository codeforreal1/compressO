import React from 'react'
import { ButtonProps } from '@nextui-org/button'
import { UseDisclosureProps } from '@nextui-org/modal'

import Modal, {
  ModalHeader,
  ModalBody,
  ModalContent,
  ModalFooter,
} from '@/components/Modal'
import Button from '@/components/Button'
import Icon from '@/components/Icon'
import Divider from '@/components/Divider'

type renderFooterArgs = { closeModal: () => void }

type AlertTypes = 'warning' | 'error'

type AlertDialogProps = {
  alertType?: AlertTypes
  title: React.ReactNode
  description: React.ReactNode
  discloser: UseDisclosureProps
  renderFooter?: (_: renderFooterArgs) => React.ReactNode
  renderIcon?: () => React.ReactNode
}

const iconMapping: Record<AlertTypes, React.JSX.Element> = {
  warning: <Icon name="warning" size={70} className="text-yellow-300 mb-4" />,
  error: <Icon name="error" size={70} className="text-red-500 mb-4" />,
}

function AlertDialog({
  alertType = 'warning',
  discloser,
  title,
  description,
  renderFooter,
  renderIcon,
}: AlertDialogProps) {
  return (
    <Modal
      isOpen={discloser?.isOpen}
      onOpenChange={discloser?.onChange}
      onClose={discloser?.onClose}
    >
      <ModalContent className="max-w-[25rem] pb-2 rounded-2xl shadow-inner bg-zinc-100 dark:bg-zinc-900">
        {(closeModal) => (
          <>
            <ModalHeader className="flex flex-col justify-center items-center pt-1 pb-1 mt-4">
              {renderIcon?.() ?? iconMapping?.[alertType] ?? null}
              {typeof title === 'string' ? (
                <p className="text-xl text-center">{title}</p>
              ) : (
                title
              )}
            </ModalHeader>
            <ModalBody className="gap-0 px-0">
              {typeof description === 'string' ? (
                <p className="mb-2 px-6 text-sm text-center text-zinc-700 dark:text-zinc-400">
                  {description}
                </p>
              ) : (
                description
              )}
              <Divider className="my-4" />
              <ModalFooter className="px-6 py-1 pb-2">
                {renderFooter?.({ closeModal })}
              </ModalFooter>
            </ModalBody>
          </>
        )}
      </ModalContent>
    </Modal>
  )
}

export function AlertDialogButton(props: ButtonProps) {
  return <Button variant="solid" fullWidth {...props} />
}

export default AlertDialog
