// main.tsx — React application entry point.
//
// Mounts the root React component with React Router so every view
// can use <Link> and useNavigate without a full page reload.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './styles/global.css';
import './utils/demoModeStorage.ts';
import App from './App.tsx';
import { resolveStoredTheme } from './store/settingsStore.ts';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element #root not found — check index.html');
}

document.documentElement.setAttribute('data-theme', resolveStoredTheme());

// Match the original ToolBox relay contract: the bookmarklet finds the app by
// calling window.open('', 'toolbox') after activation.
window.name = 'toolbox';

createRoot(rootElement).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
