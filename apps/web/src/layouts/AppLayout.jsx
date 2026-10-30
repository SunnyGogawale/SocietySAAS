import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { Alert } from '../components/ui/Alert.jsx';

const navigation = [
  { label: 'Overview', path: '/' },
  { label: 'Activity', path: '/activity' },
  { label: 'Account', path: '/account' },
];

export default function AppLayout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const { activeSociety, isAuthenticated, logout, selectSociety, societies, user } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    setFeedback('');
    try {
      await logout();
      navigate('/login', { replace: true });
    } catch (error) {
      setFeedback(error.message);
    }
  }

  async function handleSocietyChange(event) {
    setFeedback('');
    try {
      await selectSociety(event.target.value);
    } catch (error) {
      setFeedback(error.message);
    }
  }

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
            {societies.length > 1 ? (
              <label className="society-select-label">
                <span className="sr-only">Active society</span>
                <select
                  aria-label="Active society"
                  className="society-select"
                  onChange={handleSocietyChange}
                  value={activeSociety?.id ?? ''}
                >
                  <option value="">Select society</option>
                  {societies.map((society) => (
                    <option key={society.id} value={society.id}>
                      {society.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : activeSociety ? (
              <span className="status-badge status-badge--neutral">{activeSociety.name}</span>
            ) : (
              <span className="status-badge status-badge--neutral">
                {user?.platformRole === 'super_admin' ? 'Platform' : 'Setup'}
              </span>
            )}
          </div>
          <div className="topbar__user">
            <span className="avatar" aria-hidden="true">
              {user?.displayName?.[0]?.toUpperCase() ?? 'U'}
            </span>
            <span className="topbar__user-label">{user?.displayName ?? 'Account'}</span>
            {isAuthenticated && (
              <button
                className="button button--secondary logout-button"
                onClick={handleLogout}
                type="button"
              >
                Sign out
              </button>
            )}
          </div>
        </header>
        <main className="page-content" id="main-content">
          {feedback && <Alert tone="danger">{feedback}</Alert>}
          <Outlet />
        </main>
      </div>
    </div>
  );
}
