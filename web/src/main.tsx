import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import './index.css';
import Landing from './pages/Landing';
import SellerHome from './pages/SellerHome';
import SellerConsole from './pages/SellerConsole';
import SellerLogin from './pages/SellerLogin';
import Shop from './pages/Shop';
import Pricing from './pages/Pricing';
import Impact from './pages/Impact';
import Legal from './pages/Legal';
import Room from './pages/Room';
import MyOrders from './pages/MyOrders';
import Business from './pages/Business';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Toaster } from 'sonner';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
    <Toaster position="bottom-center" offset="calc(124px + env(safe-area-inset-bottom))" visibleToasts={2} duration={2800}
      toastOptions={{ className: 'claimit-toast', style: { fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 600, borderRadius: 999 } }} />
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/sell" element={<SellerHome />} />
        <Route path="/sell/login" element={<SellerLogin />} />
        <Route path="/sell/:dropId" element={<SellerConsole />} />
        <Route path="/d/:dropId" element={<Room />} />
        <Route path="/demo" element={<Navigate to="/d/demo" replace />} />
        <Route path="/s/:sellerId" element={<Shop />} />
        <Route path="/orders" element={<MyOrders />} />
        <Route path="/business" element={<Business />} />
        <Route path="/pricing" element={<Pricing />} />
        <Route path="/impact" element={<Impact />} />
        <Route path="/privacy" element={<Legal page="privacy" />} />
        <Route path="/terms" element={<Legal page="terms" />} />
        <Route path="*" element={<Landing />} />
      </Routes>
    </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);
