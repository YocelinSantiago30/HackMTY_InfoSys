import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { setAuthToken } from "../api/client";
import { loginRequest, meRequest, registerRequest } from "../api/auth.api";
import { getToken, removeToken, saveToken } from "../services/secureStorage";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    restoreSession();
  }, []);

  // Pase lo que pase (sin token, token vencido, almacenamiento o red con
  // error), la pantalla de carga debe terminar y mostrar login o la app.
  async function restoreSession() {
    try {
      const storedToken = await getToken();
      if (!storedToken) return;

      setAuthToken(storedToken);
      const { user: restoredUser } = await meRequest();
      setUser(restoredUser);
      setToken(storedToken);
    } catch (error) {
      setAuthToken(null);
      await removeToken().catch(() => {});
    } finally {
      setIsLoading(false);
    }
  }

  async function login(email, password) {
    const { user: loggedInUser, token: newToken } = await loginRequest(email, password);
    await saveToken(newToken);
    setAuthToken(newToken);
    setUser(loggedInUser);
    setToken(newToken);
  }

  async function register(name, email, password) {
    const { user: newUser, token: newToken } = await registerRequest(name, email, password);
    await saveToken(newToken);
    setAuthToken(newToken);
    setUser(newUser);
    setToken(newToken);
  }

  async function logout() {
    await removeToken();
    setAuthToken(null);
    setUser(null);
    setToken(null);
  }

  function updateUserLocal(partialUser) {
    setUser((prev) => (prev ? { ...prev, ...partialUser } : prev));
  }

  const value = useMemo(
    () => ({ user, token, isLoading, login, register, logout, updateUserLocal }),
    [user, token, isLoading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth debe usarse dentro de un AuthProvider");
  }

  return context;
}
