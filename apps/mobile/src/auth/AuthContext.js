import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const TOKEN_KEY = 'societysaas.session';
const AuthContext = createContext(null);
const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api/v1';

async function apiRequest(path, { method = 'GET', body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  if (method !== 'GET' && method !== 'HEAD') headers['x-session-transport'] = 'bearer';

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('The server returned an invalid response.');
  }
  if (!response.ok || payload.success !== true) {
    const error = new Error(payload.error?.message ?? 'The request could not be completed.');
    error.status = response.status;
    error.code = payload.error?.code;
    throw error;
  }
  return payload.data;
}

export function AuthProvider({ children }) {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [societies, setSocieties] = useState([]);
  const [activeSociety, setActiveSociety] = useState(null);
  const [loading, setLoading] = useState(true);

  const applyIdentity = useCallback((data) => {
    setUser(data.user);
    setSocieties(data.societies ?? []);
    setActiveSociety(data.activeSociety ?? null);
  }, []);

  const refresh = useCallback(
    async (sessionToken = token) => {
      if (!sessionToken) {
        setLoading(false);
        return;
      }
      try {
        applyIdentity(await apiRequest('/auth/me', { token: sessionToken }));
      } catch (error) {
        if (error.status !== 401) throw error;
        await SecureStore.deleteItemAsync(TOKEN_KEY);
        setToken(null);
        setUser(null);
        setSocieties([]);
        setActiveSociety(null);
      } finally {
        setLoading(false);
      }
    },
    [applyIdentity, token],
  );

  useEffect(() => {
    SecureStore.getItemAsync(TOKEN_KEY)
      .then(async (storedToken) => {
        if (storedToken) {
          setToken(storedToken);
          await refresh(storedToken);
        } else {
          setLoading(false);
        }
      })
      .catch(() => setLoading(false));
  }, [refresh]);

  const login = useCallback(
    async (credentials) => {
      const data = await apiRequest('/auth/login', {
        method: 'POST',
        body: credentials,
      });
      await SecureStore.setItemAsync(TOKEN_KEY, data.sessionToken);
      setToken(data.sessionToken);
      applyIdentity(data);
    },
    [applyIdentity],
  );

  const logout = useCallback(async () => {
    try {
      if (token) await apiRequest('/auth/logout', { method: 'POST', body: {}, token });
    } finally {
      await SecureStore.deleteItemAsync(TOKEN_KEY);
      setToken(null);
      setUser(null);
      setSocieties([]);
      setActiveSociety(null);
    }
  }, [token]);

  const selectSociety = useCallback(
    async (societyId) => {
      const data = await apiRequest(`/auth/societies/${encodeURIComponent(societyId)}/select`, {
        method: 'POST',
        body: {},
        token,
      });
      setActiveSociety(data.activeSociety);
    },
    [token],
  );

  const updateProfile = useCallback(
    async (profile) => {
      const data = await apiRequest('/auth/profile', {
        method: 'PATCH',
        body: profile,
        token,
      });
      setUser(data.user);
      return data.user;
    },
    [token],
  );

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
      request: apiRequest,
      token,
    }),
    [
      user,
      societies,
      activeSociety,
      loading,
      login,
      logout,
      refresh,
      selectSociety,
      updateProfile,
      token,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
