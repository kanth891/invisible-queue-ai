import { io } from 'socket.io-client';

export const SOCKET_EVENTS = {
  QUEUE_UPDATED: 'queue.updated',
  TOKEN_CALLED: 'queue.token_called',
  CONSULTATION_STARTED: 'queue.consultation_started',
  CONSULTATION_COMPLETED: 'queue.consultation_completed',
  PATIENT_NO_SHOW: 'queue.patient_no_show',
  PATIENT_CANCELLED: 'queue.patient_cancelled',
  WAIT_TIME_UPDATED: 'queue.wait_time_updated',
  PATIENT_APPROACHING: 'queue.patient_approaching',
  PATIENT_TURN: 'queue.patient_turn',
  NOTIFICATION_CREATED: 'notification.created',
};

class SocketService {
  constructor() {
    this.socket = null;
    this.status = 'disconnected'; // 'connecting' | 'connected' | 'disconnected' | 'reconnecting' | 'error'
    this.statusListeners = new Set();
    this.reconnectListeners = new Set();
    this.activeSubscriptions = {
      patientToken: null,
      doctorId: null,
      departmentId: null,
      admin: false,
    };
  }

  getSocket() {
    if (!this.socket) {
      this.connect();
    }
    return this.socket;
  }

  connect() {
    if (this.socket && this.socket.connected) return this.socket;

    const token = localStorage.getItem('token');
    const apiUrl = import.meta.env.VITE_API_URL || (typeof window !== 'undefined' && window.location.hostname === 'localhost' ? 'http://localhost:5000' : '');

    this._setStatus('connecting');

    this.socket = io(apiUrl, {
      auth: token ? { token } : {},
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10000,
      transports: ['websocket', 'polling'],
    });

    this.socket.on('connect', () => {
      this._setStatus('connected');
      this._rejoinRooms();
    });

    this.socket.on('disconnect', (reason) => {
      if (reason === 'io server disconnect') {
        // the server disconnected the socket, manually reconnect
        this.socket.connect();
      }
      this._setStatus('disconnected');
    });

    this.socket.io.on('reconnect_attempt', () => {
      this._setStatus('reconnecting');
    });

    this.socket.io.on('reconnect', () => {
      this._setStatus('connected');
      this._rejoinRooms();
      // Notify components to pull latest authoritative REST state
      this.reconnectListeners.forEach((fn) => {
        try { fn(); } catch (e) { console.error('Reconnect listener error:', e); }
      });
    });

    this.socket.on('connect_error', (err) => {
      console.warn('[Socket] Connection error:', err.message);
      this._setStatus('error');
    });

    return this.socket;
  }

  _setStatus(newStatus) {
    this.status = newStatus;
    this.statusListeners.forEach((fn) => {
      try { fn(newStatus); } catch (e) { console.error('Status listener error:', e); }
    });
  }

  _rejoinRooms() {
    if (!this.socket || !this.socket.connected) return;

    if (this.activeSubscriptions.patientToken) {
      this.socket.emit('join:patient', { accessToken: this.activeSubscriptions.patientToken });
    }
    if (this.activeSubscriptions.doctorId) {
      this.socket.emit('join:doctor', { doctorId: this.activeSubscriptions.doctorId });
    }
    if (this.activeSubscriptions.departmentId) {
      this.socket.emit('join:department', { departmentId: this.activeSubscriptions.departmentId });
    }
    if (this.activeSubscriptions.admin) {
      this.socket.emit('join:admin');
    }
  }

  subscribeStatus(callback) {
    this.statusListeners.add(callback);
    callback(this.status);
    return () => this.statusListeners.delete(callback);
  }

  onReconnect(callback) {
    this.reconnectListeners.add(callback);
    return () => this.reconnectListeners.delete(callback);
  }

  joinPatient(accessToken) {
    this.activeSubscriptions.patientToken = accessToken;
    const s = this.getSocket();
    if (s && s.connected) {
      s.emit('join:patient', { accessToken });
    }
  }

  leavePatient(accessToken) {
    if (this.activeSubscriptions.patientToken === accessToken) {
      this.activeSubscriptions.patientToken = null;
    }
    if (this.socket && this.socket.connected) {
      this.socket.emit('leave:patient', { accessToken });
    }
  }

  joinDoctor(doctorId) {
    this.activeSubscriptions.doctorId = doctorId;
    const s = this.getSocket();
    if (s && s.connected) {
      s.emit('join:doctor', { doctorId });
    }
  }

  joinDepartment(departmentId) {
    this.activeSubscriptions.departmentId = departmentId;
    const s = this.getSocket();
    if (s && s.connected) {
      s.emit('join:department', { departmentId });
    }
  }

  joinAdmin() {
    this.activeSubscriptions.admin = true;
    const s = this.getSocket();
    if (s && s.connected) {
      s.emit('join:admin');
    }
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this._setStatus('disconnected');
    }
  }
}

export const socketService = new SocketService();
export default socketService;
