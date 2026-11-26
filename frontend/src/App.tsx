import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './auth'
import Layout from './components/Layout'
import Login from './pages/Login'
import Register from './pages/Register'
import Dashboard from './pages/Dashboard'
import DoctorPatients from './pages/DoctorPatients'
import Analytics from './pages/Analytics'
import Chat from './pages/Chat'
import DoctorPatient from './pages/DoctorPatient'
import NewMeasurement from './pages/NewMeasurement'
import Result from './pages/Result'

import Profile from './pages/Profile'
import MedCard from './pages/MedCard'

function RequireAuth({ children }: { children: React.ReactElement }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center">
        <div className="text-sm text-ink-soft" role="status">Загрузка…</div>
      </div>
    )
  }
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />
  return children
}

function RequireDoctor({ children }: { children: React.ReactElement }) {
  const { user } = useAuth()
  if (user?.role !== 'doctor') return <Navigate to="/" replace />
  return children
}

// Главная: пациенту — дашборд, врачу — список пациентов
function Home() {
  const { user } = useAuth()
  return user?.role === 'doctor' ? <Navigate to="/patients" replace /> : <Dashboard />
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/" element={<RequireAuth><Layout /></RequireAuth>}>
        <Route index element={<Home />} />
        <Route path="new" element={<NewMeasurement />} />
        <Route path="result/:id" element={<Result />} />
        <Route path="history" element={<Navigate to="/medcard?tab=meas" replace />} />
        <Route path="medcard" element={<MedCard />} />
        <Route path="chat" element={<Chat />} />
        <Route path="profile" element={<Profile />} />
        <Route path="patients" element={<RequireDoctor><DoctorPatients /></RequireDoctor>} />
        <Route path="analytics" element={<RequireDoctor><Analytics /></RequireDoctor>} />
        <Route path="patients/:id" element={<RequireDoctor><DoctorPatient /></RequireDoctor>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
