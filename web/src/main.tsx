import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import './index.css';
import Landing from './pages/Landing';
import SellerHome from './pages/SellerHome';
import SellerConsole from './pages/SellerConsole';
import SellerLogin from './pages/SellerLogin';
import Room from './pages/Room';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Toaster } from 'sonner';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
    <Toaster position="top-center" offset="max(12px, env(safe-area-inset-top))" visibleToasts={2} duration={2800}
      toastOptions={{ className: 'claimit-toast', style: { fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 600, borderRadius: 999 } }} />
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/sell" element={<SellerHome />} />
        <Route path="/sell/login" element={<SellerLogin />} />
        <Route path="/sell/:dropId" element={<SellerConsole />} />
        <Route path="/d/:dropId" element={<Room />} />
        <Route path="*" element={<Landing />} />
      </Routes>
    </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);
