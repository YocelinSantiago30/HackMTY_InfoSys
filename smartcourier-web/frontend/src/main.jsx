import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { SimulationProvider } from './contexts/SimulationContext';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')).render(<BrowserRouter><AuthProvider><SimulationProvider><App /></SimulationProvider></AuthProvider></BrowserRouter>);
