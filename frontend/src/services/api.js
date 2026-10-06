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
  call: (id) => request(`/api/queue/${id}/call`, { method: 'POST' }),
  start: (id) => request(`/api/queue/${id}/start`, { method: 'POST' }),
  complete: (id) => request(`/api/queue/${id}/complete`, { method: 'POST' }),
  noShow: (id) => request(`/api/queue/${id}/no-show`, { method: 'POST' }),
  cancel: (id) => request(`/api/queue/${id}/cancel`, { method: 'POST' }),
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
