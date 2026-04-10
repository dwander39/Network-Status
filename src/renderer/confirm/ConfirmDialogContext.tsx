import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { createPortal } from 'react-dom'

/**
 * In-app confirmations replace native `window.confirm()`, which breaks keyboard/focus in this
 * Electron app after destructive flows. Use `useConfirmAction()` and `await confirmAction({...})`.
 *
 * Future destructive actions: import `useConfirmAction`, never call `window.confirm()`.
 */
export type ConfirmActionOptions = {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  /** Uses danger button styling for the confirm action. */
  destructive?: boolean
  /** Smaller secondary copy under the main message. */
  detail?: string
}

type OpenDialogState = ConfirmActionOptions & { open: true }

type DialogState = { open: false } | OpenDialogState

type ConfirmContextValue = {
  confirmAction: (options: ConfirmActionOptions) => Promise<boolean>
}

const ConfirmDialogContext = createContext<ConfirmContextValue | null>(null)

export function useConfirmAction(): ConfirmContextValue {
  const ctx = useContext(ConfirmDialogContext)
  if (!ctx) {
    throw new Error('useConfirmAction must be used within ConfirmDialogProvider')
  }
  return ctx
}

export function ConfirmDialogProvider({ children }: { children: ReactNode }): JSX.Element {
  const [dialog, setDialog] = useState<DialogState>({ open: false })
  const resolverRef = useRef<((value: boolean) => void) | null>(null)
  const cancelButtonRef = useRef<HTMLButtonElement>(null)

  const close = useCallback((result: boolean) => {
    const r = resolverRef.current
    resolverRef.current = null
    setDialog({ open: false })
    r?.(result)
  }, [])

  const confirmAction = useCallback((options: ConfirmActionOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      if (resolverRef.current) {
        resolverRef.current(false)
        resolverRef.current = null
      }
      resolverRef.current = resolve
      setDialog({ open: true, ...options })
    })
  }, [])

  useEffect(() => {
    return () => {
      if (resolverRef.current) {
        resolverRef.current(false)
        resolverRef.current = null
      }
    }
  }, [])

  useLayoutEffect(() => {
    if (dialog.open) {
      cancelButtonRef.current?.focus()
    }
  }, [dialog])

  useEffect(() => {
    if (!dialog.open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close(false)
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [dialog.open, close])

  const overlay =
    dialog.open ? (
      <div
        className="confirm-dialog-backdrop"
        role="presentation"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) close(false)
        }}
      >
        <div
          className={`modal confirm-dialog${dialog.destructive ? ' confirm-dialog--destructive' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
          aria-describedby="confirm-dialog-desc"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <h3 id="confirm-dialog-title" className="confirm-dialog__title">
            {dialog.title}
          </h3>
          <p id="confirm-dialog-desc" className="confirm-dialog__message">
            {dialog.message}
          </p>
          {dialog.detail ? (
            <p className="confirm-dialog__detail muted" id="confirm-dialog-detail">
              {dialog.detail}
            </p>
          ) : null}
          <div className="confirm-dialog__actions">
            <button
              ref={cancelButtonRef}
              type="button"
              className="secondary"
              onClick={() => close(false)}
            >
              {dialog.cancelLabel ?? 'Cancel'}
            </button>
            <button
              type="button"
              className={dialog.destructive ? 'danger' : undefined}
              onClick={() => close(true)}
            >
              {dialog.confirmLabel ?? 'OK'}
            </button>
          </div>
        </div>
      </div>
    ) : null

  return (
    <ConfirmDialogContext.Provider value={{ confirmAction }}>
      {children}
      {typeof document !== 'undefined' && overlay ? createPortal(overlay, document.body) : null}
    </ConfirmDialogContext.Provider>
  )
}
