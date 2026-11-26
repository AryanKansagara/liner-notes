import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { App } from './App.tsx'
import { loadProjects, onSaveError } from './store.ts'
import { initSync } from './sync.ts'
import { toast } from './ui.tsx'

onSaveError(p => toast(`${p.name} could not be saved: this browser refused to store it, so the change is lost when you close the page. Free up disk space or site data.`, { tone: 'error', ttl: 12_000 }))
void loadProjects().then(() => initSync())
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
