import { createContext, useContext, useState, useEffect } from 'react'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('auth_token'))
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  // Check if token is valid on mount
  useEffect(() => {
    const checkAuth = async () => {
      if (!token) {
        setIsLoading(false)
        return
      }
      try {
        const res = await fetch('/api/auth/check', {
          headers: { 'X-Auth-Token': token }
        })
        const data = await res.json()
        setIsAuthenticated(data.authenticated)
        if (!data.authenticated) {
          localStorage.removeItem('auth_token')
          setToken(null)
        }
      } catch (err) {
        console.error('Auth check failed:', err)
        setIsAuthenticated(false)
      } finally {
        setIsLoading(false)
      }
    }
    checkAuth()
  }, [token])

  const login = async (password) => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      })
      const data = await res.json()
      if (data.success && data.token) {
        localStorage.setItem('auth_token', data.token)
        setToken(data.token)
        setIsAuthenticated(true)
        return { success: true }
      }
      return { success: false, error: data.error || 'Login failed' }
    } catch (err) {
      return { success: false, error: err.message }
    }
  }

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'X-Auth-Token': token }
      })
    } catch (err) {
      console.error('Logout error:', err)
    }
    localStorage.removeItem('auth_token')
    setToken(null)
    setIsAuthenticated(false)
  }

  const changePassword = async (currentPassword, newPassword) => {
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Auth-Token': token
        },
        body: JSON.stringify({ currentPassword, newPassword })
      })
      const data = await res.json()
      if (data.success) {
        return { success: true }
      }
      return { success: false, error: data.error || 'Failed to change password' }
    } catch (err) {
      return { success: false, error: err.message }
    }
  }

  // Helper to make authenticated fetch requests
  const authFetch = async (url, options = {}) => {
    const headers = {
      ...options.headers,
      'X-Auth-Token': token
    }
    return fetch(url, { ...options, headers })
  }

  return (
    <AuthContext.Provider value={{
      token,
      isAuthenticated,
      isLoading,
      login,
      logout,
      changePassword,
      authFetch
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
