import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth'
import Layout from './components/Layout'
import { RealtimeProvider } from './realtime'
import AuthPage from './pages/AuthPage'
import { ForgotPassword, ResetPassword, VerifyEmail } from './pages/EmailPages'
import Feed from './pages/Feed'
import Messages from './pages/Messages'
import Notifications from './pages/Notifications'
import PostPage from './pages/PostPage'
import Profile from './pages/Profile'

function Protected() {
  const { user, loading } = useAuth()
  if (loading) return <p className="muted center" style={{ marginTop: '30vh' }}>Loading…</p>
  if (!user) return <Navigate to="/login" replace />
  return (
    <RealtimeProvider>
      <Layout />
    </RealtimeProvider>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<AuthPage mode="login" />} />
          <Route path="/register" element={<AuthPage mode="register" />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/verify-email" element={<VerifyEmail />} />
          <Route element={<Protected />}>
            <Route path="/" element={<Feed />} />
            <Route path="/u/:username" element={<Profile />} />
            <Route path="/p/:id" element={<PostPage />} />
            <Route path="/notifications" element={<Notifications />} />
            <Route path="/messages" element={<Messages />} />
            <Route path="/messages/:conversationId" element={<Messages />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
