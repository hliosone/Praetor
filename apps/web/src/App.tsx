import { useEffect, useState, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { I18nProvider } from './i18n/index.js';
import { AppLayout } from './components/Layout.js';
import { api, type Me } from './lib/api.js';
import { Landing } from './pages/Landing.js';
import { Onboarding } from './pages/Onboarding.js';
import { Home } from './pages/Home.js';
import { Approve } from './pages/Approve.js';
import { Mandate } from './pages/Mandate.js';
import { Payments } from './pages/Payments.js';
import { Agent } from './pages/Agent.js';
import { Audit } from './pages/Audit.js';
import { Settings } from './pages/Settings.js';
import { Console } from './pages/Console.js';
import { Recover } from './pages/Recover.js';

/** Signed-in pages: without a session, back to the landing page. */
function RequireSession({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null | undefined>();
  useEffect(() => { api<Me>('GET', '/me').then(setMe, () => setMe(null)); }, []);
  if (me === undefined) return null;
  return me ? <>{children}</> : <Navigate to="/" replace />;
}

export function App() {
  return (
    <I18nProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/start" element={<Onboarding />} />
          <Route path="/console/*" element={<Console />} />
          <Route path="/recover" element={<Recover />} />
          <Route element={<RequireSession><AppLayout /></RequireSession>}>
            <Route path="/home" element={<Home />} />
            <Route path="/approve/:id" element={<Approve />} />
            <Route path="/mandate" element={<Mandate />} />
            <Route path="/payments" element={<Payments />} />
            <Route path="/agent" element={<Agent />} />
            <Route path="/audit" element={<Audit />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </I18nProvider>
  );
}
