/**
 * Minimal stand-in for the `electron` module in integration tests (aliased in vitest.config.ts).
 * Tests never touch the real userData directory: `app.getPath` throws so any accidental use is loud.
 */
export const app = {
  getPath(name: string): string {
    throw new Error(`electron stub: app.getPath('${name}') is not available in tests`)
  }
}

export class Notification {
  static isSupported(): boolean {
    return false
  }
  constructor(_opts: { title: string; body: string }) {}
  show(): void {}
}

export type BrowserWindow = {
  isDestroyed(): boolean
  webContents: { send(channel: string, ...args: unknown[]): void }
}
