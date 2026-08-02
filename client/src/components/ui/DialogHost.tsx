import { useEffect, useState } from 'react'
import { AlertDialog, Button } from '@heroui/react'
import { useI18n } from '../../i18n'
import { head, settleHead, subscribe, type DialogRequest } from './dialog'

/** Renders the imperative confirm/alert queue. Mount once at the app root. */
export function DialogHost() {
  const { t } = useI18n()
  const [request, setRequest] = useState<DialogRequest | null>(head)

  useEffect(() => subscribe(() => setRequest(head())), [])

  const isConfirm = request?.kind === 'confirm'

  return (
    <AlertDialog.Backdrop
      isDismissable={!isConfirm}
      isOpen={request !== null}
      // Only fires for backdrop/ESC dismissal — the buttons settle explicitly.
      onOpenChange={(open) => {
        if (!open) settleHead(false)
      }}
    >
      <AlertDialog.Container>
        <AlertDialog.Dialog className="sm:max-w-[420px]">
          <AlertDialog.Header>
            <AlertDialog.Icon status={request?.status ?? 'default'} />
            <AlertDialog.Heading>{request?.title}</AlertDialog.Heading>
          </AlertDialog.Header>
          {request?.content ? (
            <AlertDialog.Body>
              <p className="whitespace-pre-wrap">{request.content}</p>
            </AlertDialog.Body>
          ) : null}
          <AlertDialog.Footer>
            {isConfirm ? (
              <Button variant="tertiary" onPress={() => settleHead(false)}>
                {request?.cancelText ?? t('common.cancel')}
              </Button>
            ) : null}
            <Button
              variant={request?.status === 'danger' ? 'danger' : 'primary'}
              onPress={() => settleHead(true)}
            >
              {request?.okText ?? t('common.ok')}
            </Button>
          </AlertDialog.Footer>
        </AlertDialog.Dialog>
      </AlertDialog.Container>
    </AlertDialog.Backdrop>
  )
}
