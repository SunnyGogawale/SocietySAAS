import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';

const navigation = [
  { label: 'Overview', path: '/' },
  { label: 'Activity', path: '/activity' },
  { label: 'Account', path: '/account' },
];

export default function AppLayout() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="app-shell">
      <aside className={`sidebar${menuOpen ? ' sidebar--open' : ''}`}>
        <a className="brand" href="/" aria-label="SocietySAAS home">
          <span className="brand__mark" aria-hidden="true">
            S
          </span>
          <span className="brand__name">SocietySAAS</span>
        </a>
        <p className="sidebar__caption">WORKSPACE</p>
        <nav className="sidebar__nav" aria-label="Main navigation">
          {navigation.map((item) => (
            <NavLink
              className={({ isActive }) => `nav-link${isActive ? ' nav-link--active' : ''}`}
              end={item.path === '/'}
              key={item.path}
              onClick={() => setMenuOpen(false)}
              to={item.path}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar__footer">
          <span className="status-dot" aria-hidden="true" />
          Application foundation
        </div>
      </aside>

      {menuOpen && (
        <button
          className="sidebar-backdrop"
          type="button"
          aria-label="Close navigation"
          onClick={() => setMenuOpen(false)}
        />
      )}

      <div className="app-main">
        <header className="topbar">
          <button
            aria-expanded={menuOpen}
            aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
            className="menu-toggle"
            onClick={() => setMenuOpen((open) => !open)}
            type="button"
          >
            <span aria-hidden="true">{menuOpen ? '×' : '☰'}</span>
          </button>
          <div className="topbar__context">
            <span className="topbar__eyebrow">Society management</span>
            <span className="status-badge status-badge--neutral">Setup</span>
          </div>
          <div className="topbar__user" aria-label="Application preview">
            <span className="avatar" aria-hidden="true">
              S
            </span>
            <span className="topbar__user-label">Preview</span>
          </div>
        </header>
        <main className="page-content" id="main-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
