import { prepareAppWindowForKeyboardInput } from './ensureTextFieldFocus'

/**
 * Shared post-delete / post-destructive typing bug (Electron): the control that had focus is
 * removed from the DOM while the OS may not route keyboard input to the webContents until the
 * window is foregrounded again (same as alt-tab “fix”).
 *
 * Enable tracing: `localStorage.setItem('SS_DELETE_FLOW_DEBUG','1'); location.reload()`
 * Disable:       `localStorage.removeItem('SS_DELETE_FLOW_DEBUG'); location.reload()`
 * REMOVE:        flag checks, console branches, and `reportTextEntrySurfaceOpened` calls when stable.
 */
const DELETE_FLOW_DEBUG = 'SS_DELETE_FLOW_DEBUG'

export function deleteFlowDebugEnabled(): boolean {
  try {
    return localStorage.getItem(DELETE_FLOW_DEBUG) === '1'
  } catch {
    return false
  }
}

function describeActive(): string {
  const ae = document.activeElement
  if (!ae) return 'null'
  if (ae.nodeType !== Node.ELEMENT_NODE) return String(ae)
  const el = ae as HTMLElement
  return `${el.tagName} connected=${el.isConnected}`
}

/** Call immediately before `await api.delete*(...)` (after user confirms) to log pre-delete focus. */
export function logDeleteFlowPreDelete(context: string): void {
  if (!deleteFlowDebugEnabled()) return
  console.info('[SS-DELETE-FLOW]', 'preDelete', context, describeActive())
}

/**
 * When Add/Edit (or similar) opens after a bad delete sequence, logs focus + one capture keydown.
 * REMOVE with SS_DELETE_FLOW_DEBUG instrumentation.
 */
export function reportTextEntrySurfaceOpened(context: string): void {
  if (!deleteFlowDebugEnabled()) return
  console.info('[SS-DELETE-FLOW]', 'textSurfaceOpen', context, describeActive())
  const keyHandler = (e: KeyboardEvent) => {
    document.removeEventListener('keydown', keyHandler, true)
    console.info(
      '[SS-DELETE-FLOW]',
      'first keydown after surface open',
      context,
      e.key,
      `target=${(e.target as HTMLElement)?.tagName}`,
      `active=${document.activeElement?.nodeName}`,
      `defaultPrevented=${e.defaultPrevented}`
    )
  }
  document.addEventListener('keydown', keyHandler, true)
}

function installOneShotKeydownAfterRecovery(label: string): void {
  const handler = (e: KeyboardEvent) => {
    document.removeEventListener('keydown', handler, true)
    console.info(
      '[SS-DELETE-FLOW]',
      'first keydown after post-delete recovery',
      label,
      e.key,
      `target=${(e.target as HTMLElement)?.tagName}`,
      `active=${document.activeElement?.nodeName}`,
      `defaultPrevented=${e.defaultPrevented}`
    )
  }
  document.addEventListener('keydown', handler, true)
}

export type PostDeleteFocusOptions = {
  /** Optional: map canvas — clear selection flags after removing a focused node. */
  clearGraphSelection?: () => void
}

/**
 * Run after any successful delete/purge/clear that may have removed the focused control.
 * Detached activeElement → body, optional graph selection clear, native window + renderer focus.
 */
export function recoverKeyboardAfterDestructiveAction(
  label: string,
  options?: PostDeleteFocusOptions
): void {
  const debug = deleteFlowDebugEnabled()
  if (debug) {
    console.info('[SS-DELETE-FLOW]', label, 'enqueue recovery, active=', describeActive())
  }

  const run = async () => {
    const ae = document.activeElement as HTMLElement | null
    if (!ae || !ae.isConnected) {
      try {
        document.body.focus()
      } catch {
        /* ignore */
      }
    }

    options?.clearGraphSelection?.()

    await prepareAppWindowForKeyboardInput(`postDelete:${label}`)

    const after = document.activeElement as HTMLElement | null
    if (after && !after.isConnected) {
      try {
        document.body.focus()
      } catch {
        /* ignore */
      }
    }

    if (debug) {
      console.info('[SS-DELETE-FLOW]', label, 'recovery done, active=', describeActive())
      installOneShotKeydownAfterRecovery(label)
    }
  }

  queueMicrotask(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        void run()
      })
    })
  })
}
