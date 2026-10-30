import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext.jsx';
import AppLayout from './layouts/AppLayout.jsx';
import AcceptInvitationPage from './pages/AcceptInvitationPage.jsx';
import AccountPage from './pages/AccountPage.jsx';
import ActivityPage from './pages/ActivityPage.jsx';
import ForgotPasswordPage from './pages/ForgotPasswordPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import OverviewPage from './pages/OverviewPage.jsx';
import PlatformAuditPage from './pages/PlatformAuditPage.jsx';
import PlatformDashboardPage from './pages/PlatformDashboardPage.jsx';
import PlatformPlansPage from './pages/PlatformPlansPage.jsx';
import PlatformSocietiesPage from './pages/PlatformSocietiesPage.jsx';
import PlatformSocietyDetailPage from './pages/PlatformSocietyDetailPage.jsx';
import PlatformSupportPage from './pages/PlatformSupportPage.jsx';
import SocietyRegistrationPage from './pages/SocietyRegistrationPage.jsx';
import ResetPasswordPage from './pages/ResetPasswordPage.jsx';
import VerifyEmailPage from './pages/VerifyEmailPage.jsx';

function AppRoutes() {
  const { isAuthenticated, loading, user } = useAuth();

  if (loading) {
    return (
      <main className="auth-page">
        <p aria-live="polite" role="status">
          Checking your session…
        </p>
      </main>
    );
  }

  return (
    <Routes>
      <Route path="login" element={<LoginPage />} />
      <Route path="forgot-password" element={<ForgotPasswordPage />} />
      <Route path="reset-password" element={<ResetPasswordPage />} />
      <Route path="accept-invitation" element={<AcceptInvitationPage />} />
      <Route path="verify-email" element={<VerifyEmailPage />} />
      <Route path="register-society" element={<SocietyRegistrationPage />} />
      {isAuthenticated ? (
        <Route element={<AppLayout />}>
          {user?.platformRole === 'super_admin' ? (
            <>
              <Route index element={<PlatformDashboardPage />} />
              <Route path="platform/societies" element={<PlatformSocietiesPage />} />
              <Route path="platform/societies/:societyId" element={<PlatformSocietyDetailPage />} />
              <Route path="platform/plans" element={<PlatformPlansPage />} />
              <Route path="platform/support" element={<PlatformSupportPage />} />
              <Route path="platform/audit" element={<PlatformAuditPage />} />
            </>
          ) : (
            <>
              <Route index element={<OverviewPage />} />
              <Route path="activity" element={<ActivityPage />} />
              <Route path="account" element={<AccountPage />} />
            </>
          )}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      ) : (
        <Route path="*" element={<Navigate to="/login" replace />} />
      )}
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
