import { NavLink, Outlet } from 'react-router-dom';
import { useI18n } from '../i18n/index.js';

export function Mark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2 3 6v6c0 5 3.8 9.4 9 10 5.2-.6 9-5 9-10V6l-9-4Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="m8 12 3 3 5-6" fill="none" stroke="var(--signed)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Topbar({ app }: { app: boolean }) {
  const { t, lang, setLang } = useI18n();
  return (
    <header className="topbar">
      <NavLink to={app ? '/home' : '/'} className="brand"><Mark />Praetor</NavLink>
      {app && (
        <nav className="nav" aria-label="Main">
          {(['home', 'mandate', 'payments', 'agent', 'audit', 'settings'] as const).map((k) => <NavLink key={k} to={`/${k}`}>{t(`nav.${k}`)}</NavLink>)}
        </nav>
      )}
      <span className="spacer" />
      <button className="lang" onClick={() => setLang(lang === 'en' ? 'zh-CN' : 'en')} title="Language / 语言" lang={lang === 'en' ? 'zh-CN' : 'en'}>{t('lang.switch')}</button>
    </header>
  );
}

export function AppLayout() {
  return (
    <>
      <Topbar app />
      <main><Outlet /></main>
    </>
  );
}
