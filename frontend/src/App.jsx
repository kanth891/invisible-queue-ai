import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { NotificationProvider } from './context/NotificationContext';
import './App.css';

// Pages
import Login from './pages/auth/Login';
import PatientQueue from './pages/patient/PatientQueue';
import DashboardLayout from './layouts/DashboardLayout';
import AdminDashboard from './pages/admin/Dashboard';
import ReceptionistDashboard from './pages/receptionist/Dashboard';
import DoctorDashboard from './pages/doctor/Dashboard';

import { useAuth } from './context/AuthContext';

function RoleHome() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  switch (user.role) {
    case 'ADMIN': return <Navigate to="/admin" replace />;
    case 'RECEPTIONIST': return <Navigate to="/receptionist" replace />;
    case 'DOCTOR': return <Navigate to="/doctor" replace />;
    default: return <Navigate to="/login" replace />;
  }
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      
      {/* Public Patient Virtual Queue Tracker (No authentication required) */}
      <Route path="/queue/:accessToken" element={<PatientQueue />} />
      
      {/* Root redirect based on role */}
      <Route path="/" element={<RoleHome />} />

      <Route element={<DashboardLayout allowedRoles={['ADMIN']} />}>
        <Route path="/admin" element={<AdminDashboard />} />
      </Route>
      
      <Route element={<DashboardLayout allowedRoles={['RECEPTIONIST', 'ADMIN']} />}>
        <Route path="/receptionist" element={<ReceptionistDashboard />} />
      </Route>

      <Route element={<DashboardLayout allowedRoles={['DOCTOR']} />}>
        <Route path="/doctor" element={<DoctorDashboard />} />
      </Route>

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <NotificationProvider>
        <Router>
          <AppRoutes />
        </Router>
      </NotificationProvider>
    </AuthProvider>
  );
}
