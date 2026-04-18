import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConfirmDialogProvider } from './confirm/ConfirmDialogContext'
import { SelectionStateProvider } from './selection/SelectionStateContext'
import { App } from './App'
import './App.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfirmDialogProvider>
      <SelectionStateProvider>
        <App />
      </SelectionStateProvider>
    </ConfirmDialogProvider>
  </React.StrictMode>
)
