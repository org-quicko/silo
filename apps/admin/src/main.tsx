import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './styles/global.css'
import './styles/forms.css'
import './styles/layout.css'
import './styles/feedback.css'
import './styles/utilities.css'
import { ThemeManager } from './utils/theme-manager'
import App from './App.tsx'

ThemeManager.init()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
