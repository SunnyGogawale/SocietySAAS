import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import { Alert } from '../components/ui/Alert.jsx';

const societyNavigation = [
  { label: 'Overview', path: '/' },
  { label: 'Activity', path: '/activity' },
  { label: 'Account', path: '/account' },
  { label: 'Society settings', path: '/settings' },
  { label: 'Properties and residents', path: '/properties' },
  { label: 'Maintenance billing', path: '/billing' },
];
const platformNavigation = [
  { label: 'Dashboard', path: '/' },
  { label: 'Societies', path: '/platform/societies' },
  { label: 'Subscription plans', path: '/platform/plans' },
  { label: 'Support tickets', path: '/platform/support' },
  { label: 'Platform audit', path: '/platform/audit' },
];

export default function AppLayout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const { activeSociety, isAuthenticated, logout, selectSociety, societies, user } = useAuth();
  const isPlatformAdmin = user?.platformRole === 'super_admin';
  const navigation = isPlatformAdmin
    ? platformNavigation
    : activeSociety?.role === 'society_admin'
      ? societyNavigation
      : societyNavigation.filter((item) =>
          activeSociety?.role === 'society_admin'
            ? true
            : item.path !== '/properties' && item.path !== '/billing',
        );
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
        <p className="sidebar__caption">{isPlatformAdmin ? 'PLATFORM CONSOLE' : 'WORKSPACE'}</p>
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
          {isPlatformAdmin ? 'Platform access' : 'Society workspace'}
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
            <span className="topbar__eyebrow">
              {isPlatformAdmin ? 'Platform administration' : 'Society management'}
            </span>
            {!isPlatformAdmin && societies.length > 1 ? (
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
            ) : !isPlatformAdmin && activeSociety ? (
              <span className="status-badge status-badge--neutral">{activeSociety.name}</span>
            ) : (
              <span className="status-badge status-badge--neutral">
                {isPlatformAdmin ? 'Super Admin' : 'Setup'}
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
