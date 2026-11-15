import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import './index.css';
import Landing from './pages/Landing';
import SellerHome from './pages/SellerHome';
import SellerConsole from './pages/SellerConsole';
import Room from './pages/Room';
import { ErrorBoundary } from './components/ErrorBoundary';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/sell" element={<SellerHome />} />
        <Route path="/sell/:dropId" element={<SellerConsole />} />
        <Route path="/d/:dropId" element={<Room />} />
        <Route path="*" element={<Landing />} />
      </Routes>
    </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);
