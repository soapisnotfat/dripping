import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { bootstrapSharedMemory } from './lib/browser-bootstrap';

void bootstrapSharedMemory().then((reloading) => {
  if (!reloading) createRoot(document.getElementById('root')!).render(<App />);
});
