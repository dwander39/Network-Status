import { app, Menu, nativeImage, Tray, BrowserWindow } from 'electron'
import { PRODUCT_NAME } from './appIdentity'

/** Minimal 16×16 PNG so Tray works on Windows/macOS without bundling assets yet. */
const PLACEHOLDER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAH0lEQVQ4T2NkoBAwUqifYdQqYKDAhAoHGBgYGACgGAAQ+YkR6wAAAABJRU5ErkJggg==',
  'base64'
)

/**
 * System tray: keep app running when the window is closed; quick Show / Quit.
 * Tooltip shows summary when `getSummary` is provided.
 */
export function createTray(
  mainWindow: BrowserWindow,
  getSummary?: () => string
): Tray {
  const icon = nativeImage.createFromBuffer(PLACEHOLDER_PNG)
  const tray = new Tray(icon)

  const buildMenu = (): Electron.Menu =>
    Menu.buildFromTemplate([
      {
        label: 'Show',
        click: () => {
          mainWindow.show()
          mainWindow.focus()
        }
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          app.quit()
        }
      }
    ])

  tray.setToolTip(getSummary?.() ?? PRODUCT_NAME)
  tray.setContextMenu(buildMenu())

  tray.on('click', () => {
    if (process.platform === 'darwin') return
    if (mainWindow.isVisible()) mainWindow.hide()
    else {
      mainWindow.show()
      mainWindow.focus()
    }
  })

  return tray
}

export function updateTrayTooltip(tray: Tray | null, getSummary?: () => string): void {
  if (!tray) return
  tray.setToolTip(getSummary?.() ?? PRODUCT_NAME)
}
