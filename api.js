/**
 * DisasterGuard SIH 2026 — Shared Frontend API & Auth Client
 * ==========================================================
 * Provides a unified client for REST API communication, JWT session
 * management, and Socket.IO real-time event connectivity.
 */

(function (window) {
  'use strict';

  // Base URL for backend API: use current origin if served via HTTP/HTTPS, else default to localhost:5000
 const API_BASE = 'http://localhost:5000';

  /**
   * Session / Auth Management
   */
  function getToken() {
    return localStorage.getItem('dg_token') || null;
  }

  function getUser() {
    try {
      const userStr = localStorage.getItem('dg_user') || localStorage.getItem('dg-user');
      return userStr ? JSON.parse(userStr) : null;
    } catch (e) {
      console.warn('[Auth] Failed to parse stored user:', e);
      return null;
    }
  }

  function setAuth(token, user) {
    if (token) localStorage.setItem('dg_token', token);
    if (user) {
      const serialized = JSON.stringify(user);
      localStorage.setItem('dg_user', serialized);
      localStorage.setItem('dg-user', serialized); // Backward compatibility
    }
  }

  function clearAuth() {
    localStorage.removeItem('dg_token');
    localStorage.removeItem('dg_user');
    localStorage.removeItem('dg-user');
  }

  function isAuthenticated() {
    return !!getToken();
  }

  /**
   * Route protection: check if current user is logged in with required role
   */
  function requireAuth(allowedRoles = [], redirectUrl = 'login.html') {
    const token = getToken();
    const user = getUser();

    if (!token || !user) {
      clearAuth();
      window.location.href = redirectUrl;
      return false;
    }

    if (allowedRoles && allowedRoles.length > 0) {
      const userRole = (user.role || '').toLowerCase();
      const normalizedAllowed = allowedRoles.map(r => r.toLowerCase());
      if (!normalizedAllowed.includes(userRole)) {
        console.warn(`[Auth] User role '${userRole}' not permitted. Required: ${allowedRoles.join(', ')}`);
        // If mismatched role, send to their own role's dashboard or login
        if (userRole === 'citizen') window.location.href = 'citizen1.html';
        else if (userRole === 'rescue') window.location.href = 'rescue.html';
        else if (userRole === 'command') window.location.href = 'command_centre1.html';
        else window.location.href = redirectUrl;
        return false;
      }
    }

    return true;
  }

  /**
   * Unified API fetch wrapper
   */
  async function apiRequest(endpoint, options = {}) {
    const url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
    const headers = {
      'Accept': 'application/json',
      ...(options.headers || {})
    };

    const token = getToken();
    if (token && !headers['Authorization']) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    let body = options.body;
    if (body && typeof body === 'object' && !(body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }

    const config = {
      ...options,
      headers,
      body
    };

    try {
      const response = await fetch(url, config);
      const isJson = (response.headers.get('content-type') || '').includes('application/json');
      const data = isJson ? await response.json() : await response.text();

      if (!response.ok) {
        const errorMsg = (data && data.error) || (data && data.message) || `HTTP error ${response.status}`;
        const err = new Error(errorMsg);
        err.status = response.status;
        err.data = data;
        throw err;
      }

      return data;
    } catch (err) {
      console.error(`[API Error] ${options.method || 'GET'} ${endpoint}:`, err);
      throw err;
    }
  }

  // HTTP helper verbs
  const api = {
    BASE_URL: API_BASE,
    getToken,
    getUser,
    setAuth,
    clearAuth,
    isAuthenticated,
    requireAuth,
    request: apiRequest,
    get: (endpoint, headers) => apiRequest(endpoint, { method: 'GET', headers }),
    post: (endpoint, body, headers) => apiRequest(endpoint, { method: 'POST', body, headers }),
    patch: (endpoint, body, headers) => apiRequest(endpoint, { method: 'PATCH', body, headers }),
    put: (endpoint, body, headers) => apiRequest(endpoint, { method: 'PUT', body, headers }),
    delete: (endpoint, headers) => apiRequest(endpoint, { method: 'DELETE', headers }),

    /**
     * Socket.IO Helper
     */
    initSocket: function (role) {
      if (typeof io === 'undefined') {
        console.warn('[Socket.IO] Library not loaded. Realtime updates disabled.');
        return null;
      }
      const socket = io(API_BASE);
      socket.on('connect', () => {
        console.log(`[Socket.IO] Connected to backend with ID ${socket.id}`);
        if (role) {
          socket.emit('join_role', role);
          console.log(`[Socket.IO] Joined room_${role}`);
        }
      });
      return socket;
    }
  };

  window.DisasterGuard = api;
})(window);
