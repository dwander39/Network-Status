import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConfirmDialogProvider } from './confirm/ConfirmDialogContext'
import { App } from './App'
import './App.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfirmDialogProvider>
      <App />
    </ConfirmDialogProvider>
  </React.StrictMode>
)
