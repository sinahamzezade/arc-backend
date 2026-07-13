import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DashboardApp } from './DashboardApp';
import './dashboard.css';

const el = document.getElementById('admin-dashboard-root');
if (el) {
  createRoot(el).render(
    <StrictMode>
      <DashboardApp />
    </StrictMode>,
  );
}
