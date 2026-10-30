import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext.jsx';
import AppLayout from './layouts/AppLayout.jsx';
import AcceptInvitationPage from './pages/AcceptInvitationPage.jsx';
import AccountPage from './pages/AccountPage.jsx';
import ActivityPage from './pages/ActivityPage.jsx';
import ForgotPasswordPage from './pages/ForgotPasswordPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import OverviewPage from './pages/OverviewPage.jsx';
import ResetPasswordPage from './pages/ResetPasswordPage.jsx';
import VerifyEmailPage from './pages/VerifyEmailPage.jsx';

function AppRoutes() {
  const { isAuthenticated, loading } = useAuth();

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
      {isAuthenticated ? (
        <Route element={<AppLayout />}>
          <Route index element={<OverviewPage />} />
          <Route path="activity" element={<ActivityPage />} />
          <Route path="account" element={<AccountPage />} />
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
