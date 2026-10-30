import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AppProvider } from './state.tsx';
import { App } from './App.tsx';
import { themeCss } from '../../shared/themes.ts';
import '@fontsource-variable/nunito';
import './styles.css';

const themes = document.createElement('style');
themes.textContent = themeCss();
document.head.prepend(themes);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AppProvider>
        <App />
      </AppProvider>
    </BrowserRouter>
  </StrictMode>,
);
