import * as Dialog from '@radix-ui/react-dialog';
import clsx from 'clsx';
import { createContext, Fragment, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { Button, IconButton } from './ui';

interface ModalProps {
  title: string;
  subtitle?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}

export function Modal({ title, subtitle, size = 'md', onClose, footer, children }: ModalProps) {
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content className={clsx('modal', `modal-${size}`)} aria-describedby={undefined}>
          <div className="modal-head">
            <Dialog.Title className="modal-title">{title}</Dialog.Title>
            {subtitle && <div className="modal-sub">{subtitle}</div>}
            <Dialog.Close asChild>
              <IconButton icon="close" label="Close" className="modal-x" />
            </Dialog.Close>
          </div>
          <div className="modal-body">{children}</div>
          {footer && <div className="modal-foot">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ---------- modal host: open dialogs from anywhere ----------
type Render = (close: () => void) => ReactNode;

interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  /** Require typing this text before the confirm button enables. */
  requireText?: string;
}

interface ModalApi {
  open: (render: Render) => () => void;
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
}

const ModalContext = createContext<ModalApi | null>(null);
let counter = 0;

export function ModalHost({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<{ id: number; render: Render }[]>([]);

  const open = useCallback((render: Render) => {
    const id = ++counter;
    setStack((s) => [...s, { id, render }]);
    return () => setStack((s) => s.filter((m) => m.id !== id));
  }, []);

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        open((close) => (
          <ConfirmDialog
            {...opts}
            onResult={(r) => {
              resolve(r);
              close();
            }}
          />
        ));
      }),
    [open],
  );

  const api = useMemo(() => ({ open, confirm }), [open, confirm]);
  return (
    <ModalContext.Provider value={api}>
      {children}
      {stack.map((m) => (
        <Fragment key={m.id}>{m.render(() => setStack((s) => s.filter((x) => x.id !== m.id)))}</Fragment>
      ))}
    </ModalContext.Provider>
  );
}

export function useModals(): ModalApi {
  const api = useContext(ModalContext);
  if (!api) throw new Error('useModals must be used inside <ModalHost>');
  return api;
}

function ConfirmDialog({ title, message, confirmLabel = 'Confirm', danger, requireText, onResult }: ConfirmOptions & { onResult: (ok: boolean) => void }) {
  const [typed, setTyped] = useState('');
  const ok = !requireText || typed.trim() === requireText;
  return (
    <Modal
      title={title}
      size="sm"
      onClose={() => onResult(false)}
      footer={
        <>
          <span className="spacer" />
          <Button kind="ghost" onClick={() => onResult(false)}>
            Cancel
          </Button>
          <Button kind={danger ? 'danger' : 'primary'} disabled={!ok} onClick={() => onResult(true)} autoFocus={!requireText}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {message && <p className="confirm-msg">{message}</p>}
      {requireText && (
        <label className="field">
          <span className="field-label">Type {requireText} to confirm</span>
          <input className="input" id="confirm-typed" autoComplete="off" autoFocus value={typed} placeholder={requireText} onChange={(e) => setTyped(e.target.value)} />
        </label>
      )}
    </Modal>
  );
}
