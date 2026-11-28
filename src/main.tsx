import { Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { startPhoneTables } from './lib/phoneTables';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import './index.css';
import './themes.css';
import { applyUiTheme } from './lib/uiTheme';

const normalizedPath = window.location.pathname.replace(/\/+$/, '') || '/';
const isCustomersRoute =
  normalizedPath === '/customers' || normalizedPath.startsWith('/customers/');

const isFeedbackRoute = new URLSearchParams(window.location.search).has('feedback');
const FeedbackPage = lazy(() => import('./customers/FeedbackPage'));
const CustomersPortalPage = lazy(() => import('./customers/CustomersPortalPage'));
const App = lazy(() => import('./App.tsx'));

function NeutralLoader() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex items-center justify-center p-6">
      <div
        role="status"
        aria-label="Loading"
        className="w-9 h-9 rounded-full border-[3px] border-slate-200 border-t-slate-600 animate-spin"
      />
      <span className="sr-only">Loading</span>
    </div>
  );
}

if (isFeedbackRoute) {
  document.title = 'Your trip feedback · Bahaar Journeys';
  document.documentElement.classList.remove('dark');
  createRoot(document.getElementById('root')!).render(
    <ErrorBoundary fallbackTitle="Unable to load page" fallbackMessage="Please refresh the page and try again.">
      <Suspense fallback={<NeutralLoader />}>
        <FeedbackPage />
      </Suspense>
    </ErrorBoundary>,
  );
} else if (isCustomersRoute) {
  document.title = 'Loading...';
  document.documentElement.classList.remove('dark');

  createRoot(document.getElementById('root')!).render(
    <ErrorBoundary
      fallbackTitle="Unable to load page"
      fallbackMessage="Please refresh the page and try again."
    >
      <Suspense fallback={<NeutralLoader />}>
        <CustomersPortalPage />
      </Suspense>
    </ErrorBoundary>
  );
} else {
  applyUiTheme();
  createRoot(document.getElementById('root')!).render(
    <ErrorBoundary>
      <Suspense fallback={null}>
        <App />
      </Suspense>
    </ErrorBoundary>
  );

  void import('./lib/faceScan').then((m) => m.preloadFaceEngine());
}

startPhoneTables();
