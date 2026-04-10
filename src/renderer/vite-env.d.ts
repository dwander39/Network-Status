/// <reference types="vite/client" />

import type { SystemStatusApi } from '../preload/index'

export {}

declare global {
  interface Window {
    ssApi: SystemStatusApi
  }
}
