import { BrowserRouter } from 'react-router-dom';
import AppProviders from './providers/AppProviders';
import AppRouter from './router/AppRouter';

/**
 * Root App component composing providers and router
 */
export default function App() {
  return (
    <AppProviders>
      <BrowserRouter>
        <AppRouter />
      </BrowserRouter>
    </AppProviders>
  );
}
