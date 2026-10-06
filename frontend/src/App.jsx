import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import './App.css';

// Pages
import Login from './pages/auth/Login';
import DashboardLayout from './layouts/DashboardLayout';
import AdminDashboard from './pages/admin/Dashboard';
import ReceptionistDashboard from './pages/receptionist/Dashboard';
import DoctorDashboard from './pages/doctor/Dashboard';

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      
      {/* Protected Routes */}
      <Route element={<DashboardLayout allowedRoles={[]} />}>
        {/* If user hits /, they are redirected by layout to their specific dashboard based on role */}
        <Route path="/" element={<div />} />
      </Route>

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
      <Router>
        <AppRoutes />
      </Router>
    </AuthProvider>
  );
}
