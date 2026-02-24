import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ClerkProvider } from '@clerk/clerk-react'
import './index.css'
import App from './App.tsx'

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY ?? ""

if (!PUBLISHABLE_KEY) {
  document.getElementById('root')!.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#080808;font-family:monospace">
      <div style="background:#111;border:1px solid rgba(255,85,85,0.4);border-radius:12px;padding:36px 44px;text-align:center;max-width:480px">
        <div style="font-size:2rem;margin-bottom:12px">⚙️</div>
        <h2 style="color:#ff5555;margin:0 0 12px;font-size:1rem">VITE_CLERK_PUBLISHABLE_KEY not set</h2>
        <p style="color:rgba(216,216,216,0.6);font-size:0.8rem;line-height:1.7;margin:0">
          Start the app with the <code style="color:#60A5FA">-ClerkPublishableKey</code> flag:<br/>
          <code style="color:#4ADE80;font-size:0.75rem">./run_local.ps1 -ClerkPublishableKey "pk_test_..."</code><br/><br/>
          Or create <code style="color:#60A5FA">frontend/.env</code> containing:<br/>
          <code style="color:#4ADE80;font-size:0.75rem">VITE_CLERK_PUBLISHABLE_KEY=pk_test_...</code>
        </p>
      </div>
    </div>`
} else {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ClerkProvider publishableKey={PUBLISHABLE_KEY}>
        <App />
      </ClerkProvider>
    </StrictMode>,
  )
}
