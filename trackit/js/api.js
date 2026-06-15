/**
 * api.js — Shared API helper for the Trackit frontend.
 *
 * Wraps fetch() calls to the Spring Boot backend with JWT auth handling.
 * Load this script before any page-specific script that calls apiFetch().
 */

const API_BASE = 'http://localhost:8080';

function getToken() {
	return localStorage.getItem('trackit_token');
}

function setToken(token) {
	localStorage.setItem('trackit_token', token);
}

function clearToken() {
	localStorage.removeItem('trackit_token');
}

function setUser(user) {
	localStorage.setItem('trackit_user', JSON.stringify(user));
}

function getUser() {
	const raw = localStorage.getItem('trackit_user');
	return raw ? JSON.parse(raw) : null;
}

/** Redirects to the login page if no auth token is present. */
function requireAuth() {
	if (!getToken()) {
		window.location.href = 'login.html';
	}
}

/**
 * fetch() wrapper that adds the JWT Authorization header, parses JSON,
 * and redirects to login on a 401 response.
 * @param {string} path    — API path, e.g. '/api/patients'
 * @param {object} options — standard fetch() options
 * @returns {Promise<any>} parsed JSON response body (or null for empty bodies)
 */
async function apiFetch(path, options = {}) {
	const headers = {
		'Content-Type': 'application/json',
		'Authorization': 'Bearer ' + getToken(),
		...(options.headers || {})
	};

	const res = await fetch(API_BASE + path, { ...options, headers });

	if (res.status === 401) {
		clearToken();
		window.location.href = 'login.html';
		throw new Error('Unauthorized');
	}

	const text = await res.text();
	const data = text ? JSON.parse(text) : null;

	if (!res.ok) {
		const message = (data && data.error) || `Request failed (${res.status})`;
		const error = new Error(message);
		error.status = res.status;
		error.body = data;
		throw error;
	}

	return data;
}
