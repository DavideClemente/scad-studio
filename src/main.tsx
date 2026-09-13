import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ProjectsProvider } from './projects/ProjectsProvider.tsx'
import { DialogProvider } from './components/DialogProvider.tsx'

createRoot(document.getElementById('root')!).render(
  <DialogProvider>
    <ProjectsProvider>
      <App />
    </ProjectsProvider>
  </DialogProvider>,
)
