import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { captureReferral } from './referral.js'
import './index.css'

/* Before React renders, so the code is banked even if the visitor leaves. */
captureReferral()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
