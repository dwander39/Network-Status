/**
 * Renderer `window.focus()` plus main-process BrowserWindow/webContents focus so OS keyboard
 * routing matches the web contents (fixes caret-without-typing until alt-tab).
 */

export function activateRendererWindowForKeyboard(): void {
  try {
    window.focus()
  } catch {
    /* ignore */
  }
}

/** `localStorage SS_DELETE_FLOW_DEBUG=1` — see postDeleteFocusRecovery.ts. REMOVE when done. */
export async function prepareAppWindowForKeyboardInput(context: string): Promise<void> {
  let dbg = false
  try {
    dbg = localStorage.getItem('SS_DELETE_FLOW_DEBUG') === '1'
  } catch {
    /* ignore */
  }
  if (dbg) {
    console.info(
      '[SS-DELETE-FLOW]',
      'nativeFocus IPC',
      context,
      'activeElement=',
      document.activeElement?.nodeName ?? 'null'
    )
  }
  try {
    await window.ssApi.focusBrowserWindowForKeyboard(context)
  } catch (e) {
    if (dbg) console.warn('[SS-DELETE-FLOW]', 'nativeFocus IPC failed', context, e)
  }
  activateRendererWindowForKeyboard()
}
