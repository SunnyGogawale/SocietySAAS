import { Navigate, Route, Routes } from 'react-router-dom';
import AppLayout from './layouts/AppLayout.jsx';
import AccountPage from './pages/AccountPage.jsx';
import ActivityPage from './pages/ActivityPage.jsx';
import OverviewPage from './pages/OverviewPage.jsx';

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<OverviewPage />} />
        <Route path="activity" element={<ActivityPage />} />
        <Route path="account" element={<AccountPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
