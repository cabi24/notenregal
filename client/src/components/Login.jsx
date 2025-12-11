import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'

function Login() {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [checkingStatus, setCheckingStatus] = useState(true)
  const [needsSetup, setNeedsSetup] = useState(false)
  const { login } = useAuth()

  // Check if password has been set up
  useEffect(() => {
    const checkStatus = async () => {
      try {
        const res = await fetch('/api/auth/status')
        const data = await res.json()
        setNeedsSetup(!data.passwordSet)
      } catch (err) {
        console.error('Failed to check auth status:', err)
      } finally {
        setCheckingStatus(false)
      }
    }
    checkStatus()
  }, [])

  const handleLogin = async (e) => {
    e.preventDefault()
    if (!password.trim()) {
      setError('Please enter a password')
      return
    }
    setLoading(true)
    setError('')
    const result = await login(password)
    if (!result.success) {
      setError(result.error)
    }
    setLoading(false)
  }

  const handleSetup = async (e) => {
    e.preventDefault()
    if (!password.trim()) {
      setError('Please enter a password')
      return
    }
    if (password.length < 4) {
      setError('Password must be at least 4 characters')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      })
      const data = await res.json()
      if (data.success) {
        // Password set, reload to show login
        window.location.reload()
      } else {
        setError(data.error || 'Failed to set password')
      }
    } catch (err) {
      setError(err.message)
    }
    setLoading(false)
  }

  if (checkingStatus) {
    return (
      <div className="login-page">
        <div className="app-loading-spinner"></div>
      </div>
    )
  }

  // Setup mode - no password set yet
  if (needsSetup) {
    return (
      <div className="login-page">
        <div className="login-container">
          <div className="login-header">
            <h1>Notenregal</h1>
            <p>Sheet Music Library</p>
          </div>
          <div className="setup-message">
            <p>Welcome! Please set a password to protect your library.</p>
          </div>
          <form onSubmit={handleSetup} className="login-form">
            <div className="login-field">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Choose a password"
                className="login-input"
                autoFocus
                disabled={loading}
              />
            </div>
            <div className="login-field">
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm password"
                className="login-input"
                disabled={loading}
              />
            </div>
            {error && <div className="login-error">{error}</div>}
            <button type="submit" className="login-button" disabled={loading}>
              {loading ? 'Setting up...' : 'Set Password'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  // Login mode - password already set
  return (
    <div className="login-page">
      <div className="login-container">
        <div className="login-header">
          <h1>Notenregal</h1>
          <p>Sheet Music Library</p>
        </div>
        <form onSubmit={handleLogin} className="login-form">
          <div className="login-field">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              className="login-input"
              autoFocus
              disabled={loading}
            />
          </div>
          {error && <div className="login-error">{error}</div>}
          <button type="submit" className="login-button" disabled={loading}>
            {loading ? 'Signing in...' : 'Enter Library'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default Login
