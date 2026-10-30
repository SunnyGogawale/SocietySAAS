import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { apiRequest, updateCsrfToken } from '../api/client.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [societies, setSocieties] = useState([]);
  const [activeSociety, setActiveSociety] = useState(null);
  const [loading, setLoading] = useState(true);

  const applyIdentity = useCallback((data) => {
    setUser(data.user);
    setSocieties(data.societies ?? []);
    setActiveSociety(data.activeSociety ?? null);
    updateCsrfToken(data.csrfToken);
  }, []);

  const refresh = useCallback(async () => {
    try {
      applyIdentity(await apiRequest('/auth/me'));
    } catch (error) {
      if (error.status !== 401) throw error;
      setUser(null);
      setSocieties([]);
      setActiveSociety(null);
      updateCsrfToken(null);
    } finally {
      setLoading(false);
    }
  }, [applyIdentity]);

  useEffect(() => {
    refresh().catch(() => setLoading(false));
  }, [refresh]);

  const login = useCallback(
    async (credentials) => {
      const data = await apiRequest('/auth/login', { method: 'POST', body: credentials });
      applyIdentity(data);
    },
    [applyIdentity],
  );

  const logout = useCallback(async () => {
    try {
      await apiRequest('/auth/logout', { method: 'POST', body: {} });
    } finally {
      setUser(null);
      setSocieties([]);
      setActiveSociety(null);
      updateCsrfToken(null);
    }
  }, []);

  const selectSociety = useCallback(async (societyId) => {
    const data = await apiRequest(`/auth/societies/${encodeURIComponent(societyId)}/select`, {
      method: 'POST',
      body: {},
    });
    setActiveSociety(data.activeSociety);
  }, []);

  const updateProfile = useCallback(async (profile) => {
    const data = await apiRequest('/auth/profile', { method: 'PATCH', body: profile });
    setUser(data.user);
    return data.user;
  }, []);

  const value = useMemo(
    () => ({
      user,
      societies,
      activeSociety,
      loading,
      isAuthenticated: Boolean(user),
      login,
      logout,
      refresh,
      selectSociety,
      updateProfile,
    }),
    [user, societies, activeSociety, loading, login, logout, refresh, selectSociety, updateProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
