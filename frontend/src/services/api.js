const API_URL = import.meta.env.VITE_API_URL || '';

/**
 * Base API client with JWT auth support.
 */
async function request(endpoint, options = {}) {
  const token = localStorage.getItem('token');
  const headers = {
    'Content-Type': 'application/json',
    ...(token && { Authorization: `Bearer ${token}` }),
    ...options.headers,
  };

  const res = await fetch(`${API_URL}${endpoint}`, { ...options, headers });
  const data = await res.json();

  if (!res.ok) {
    throw { status: res.status, message: data.message || 'Something went wrong' };
  }

  return data;
}

// ── Auth ────────────────────────────────────────────
export const authAPI = {
  login: (email, password) => request('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  me: () => request('/api/auth/me'),
};

// ── Departments ─────────────────────────────────────
export const departmentsAPI = {
  list: (status) => request(`/api/departments${status ? `?status=${status}` : ''}`),
  get: (id) => request(`/api/departments/${id}`),
  create: (data) => request('/api/departments', { method: 'POST', body: JSON.stringify(data) }),
  update: (id, data) => request(`/api/departments/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
};

// ── Doctors ─────────────────────────────────────────
export const doctorsAPI = {
  list: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/api/doctors${qs ? `?${qs}` : ''}`);
  },
  get: (id) => request(`/api/doctors/${id}`),
  create: (data) => request('/api/doctors', { method: 'POST', body: JSON.stringify(data) }),
  update: (id, data) => request(`/api/doctors/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  updateStatus: (id, status) => request(`/api/doctors/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  getTodayAvailability: () => request('/api/doctors/availability/today'),
  getSchedule: (id) => request(`/api/doctors/${id}/schedule`),
  updateSchedule: (id, schedule) => request(`/api/doctors/${id}/schedule`, { method: 'PUT', body: JSON.stringify({ schedule }) }),
  getLeaves: (id) => request(`/api/doctors/${id}/leaves`),
  addLeave: (id, data) => request(`/api/doctors/${id}/leave`, { method: 'POST', body: JSON.stringify(data) }),
  deleteLeave: (id, leaveId) => request(`/api/doctors/${id}/leave/${leaveId}`, { method: 'DELETE' }),
};

// ── Patients ────────────────────────────────────────
export const patientsAPI = {
  list: (search) => request(`/api/patients${search ? `?search=${encodeURIComponent(search)}` : ''}`),
  get: (id) => request(`/api/patients/${id}`),
  create: (data) => request('/api/patients', { method: 'POST', body: JSON.stringify(data) }),
};

// ── Queue ───────────────────────────────────────────
export const queueAPI = {
  generateToken: (data) => request('/api/queue/token', { method: 'POST', body: JSON.stringify(data) }),
  list: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/api/queue${qs ? `?${qs}` : ''}`);
  },
  doctorQueue: (doctorId) => request(`/api/queue/doctor/${doctorId}`),
  departmentQueue: (departmentId) => request(`/api/queue/department/${departmentId}`),
  stats: () => request('/api/queue/stats'),
  getByAccessToken: (accessToken) => request(`/api/queue/access/${encodeURIComponent(accessToken)}`),
  getPredictionByAccessToken: (accessToken) => request(`/api/queue/access/${encodeURIComponent(accessToken)}/prediction`),
  getPrediction: (id) => request(`/api/queue/${id}/prediction`),
  predictionMetrics: () => request('/api/queue/admin/prediction-metrics'),
  call: (id) => request(`/api/queue/${id}/call`, { method: 'POST' }),
  missed: (id) => request(`/api/queue/${id}/missed`, { method: 'POST' }),
  start: (id) => request(`/api/queue/${id}/start`, { method: 'POST' }),
  complete: (id) => request(`/api/queue/${id}/complete`, { method: 'POST' }),
  noShow: (id) => request(`/api/queue/${id}/no-show`, { method: 'POST' }),
  cancel: (id) => request(`/api/queue/${id}/cancel`, { method: 'POST' }),

  // Patient Self-Service Controls (Public token-authenticated)
  patientCancel: (accessToken, reason) =>
    request('/api/queue/patient/cancel', { method: 'POST', body: JSON.stringify({ accessToken, reason }) }),
  patientRejoin: (accessToken) =>
    request('/api/queue/patient/rejoin', { method: 'POST', body: JSON.stringify({ accessToken }) }),
  patientRescheduleOptions: (accessToken) =>
    request(`/api/queue/patient/reschedule-options?accessToken=${encodeURIComponent(accessToken)}`),
  patientReschedule: (accessToken, newDoctorId) =>
    request('/api/queue/patient/reschedule', { method: 'POST', body: JSON.stringify({ accessToken, newDoctorId }) }),

  // Operational Queue Actions
  transfer: (data) => request('/api/queue/transfer', { method: 'POST', body: JSON.stringify(data) }),
  pauseDoctorQueue: (doctorId, reason) =>
    request(`/api/queue/doctor/${doctorId}/pause`, { method: 'POST', body: JSON.stringify({ reason }) }),
  resumeDoctorQueue: (doctorId) =>
    request(`/api/queue/doctor/${doctorId}/resume`, { method: 'POST' }),

  // Configuration and Auditing
  getSettings: () => request('/api/queue/settings'),
  updateSettings: (settings) =>
    request('/api/queue/settings', { method: 'PUT', body: JSON.stringify({ settings }) }),
  getEvents: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/api/queue/events${qs ? `?${qs}` : ''}`);
  },
};

// ── Users ───────────────────────────────────────────
export const usersAPI = {
  list: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/api/users${qs ? `?${qs}` : ''}`);
  },
  create: (data) => request('/api/users', { method: 'POST', body: JSON.stringify(data) }),
  update: (id, data) => request(`/api/users/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
};

// ── Analytics (Phase 4) ─────────────────────────────
export const analyticsAPI = {
  liveStatus: () => request('/api/analytics/live-status'),
  overview: () => request('/api/analytics/overview'),
};


