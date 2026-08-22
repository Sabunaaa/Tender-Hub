import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Force light UI — leftover theme toggles / OS dark mode must not apply
document.documentElement.classList.remove('dark')
document.documentElement.style.colorScheme = 'light'

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
