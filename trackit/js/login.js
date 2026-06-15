/**
 * login.js — Trackit login page logic
 *
 * Handles:
 *  - Real-time + on-submit email and password validation (regex)
 *  - Show / hide password toggle
 *  - Remember me (persists email in localStorage)
 *  - Loading state on submit button
 *  - Redirect to find-patient.html on successful login
 */

document.addEventListener('DOMContentLoaded', function () {

	// ── DOM references ───────────────────────────────────
	const form = document.getElementById('loginForm');
	const emailInput = document.getElementById('loginEmail');
	const passInput = document.getElementById('loginPassword');
	const toggleBtn = document.getElementById('togglePassword');
	const toggleIcon = document.getElementById('toggleIcon');
	const rememberMe = document.getElementById('rememberMe');
	const submitBtn = document.getElementById('submitBtn');

	// ── Regex patterns ───────────────────────────────────
	// Standard email: local@domain.tld — allows common special chars in local part
	const EMAIL_REGEX = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;

	// ── Restore remembered email on page load ────────────
	const savedEmail = localStorage.getItem('trackit_remember_email');
	if (savedEmail) {
		emailInput.value = savedEmail;
		rememberMe.checked = true;
	}

	// ── Show / hide password ─────────────────────────────
	toggleBtn.addEventListener('click', function () {
		const isHidden = passInput.type === 'password';
		passInput.type = isHidden ? 'text' : 'password';
		toggleIcon.className = isHidden ? 'bi bi-eye-slash' : 'bi bi-eye';
		toggleBtn.setAttribute('aria-label', isHidden ? 'Hide password' : 'Show password');
	});

	// ── Real-time validation (only fires after first blur) ─
	emailInput.addEventListener('blur', () => validateEmail());
	passInput.addEventListener('blur', () => validatePassword());

	// Re-validate on input once field has been touched
	emailInput.addEventListener('input', () => {
		if (emailInput.classList.contains('is-invalid') ||
			emailInput.classList.contains('is-valid')) {
			validateEmail();
		}
	});
	passInput.addEventListener('input', () => {
		if (passInput.classList.contains('is-invalid') ||
			passInput.classList.contains('is-valid')) {
			validatePassword();
		}
	});

	// ── Form submit ──────────────────────────────────────
	form.addEventListener('submit', function (e) {
		e.preventDefault();

		const emailOk = validateEmail();
		const passOk = validatePassword();
		if (!emailOk || !passOk) return;

		// Persist or clear remembered email
		if (rememberMe.checked) {
			localStorage.setItem('trackit_remember_email', emailInput.value.trim());
		} else {
			localStorage.removeItem('trackit_remember_email');
		}

		// Loading state — prevent double submission
		setLoading(true);

		fetch(API_BASE + '/api/auth/login', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				email: emailInput.value.trim(),
				password: passInput.value
			})
		})
			.then(function (res) {
				if (res.status === 401) {
					markInvalid(emailInput, 'Invalid email or password');
					markInvalid(passInput, 'Invalid email or password');
					setLoading(false);
					return null;
				}
				if (!res.ok) {
					throw new Error('Login request failed: ' + res.status);
				}
				return res.json();
			})
			.then(function (data) {
				if (!data) return; // 401 already handled above
				setToken(data.token);
				setUser(data.user);
				window.location.href = 'find-patient.html';
			})
			.catch(function () {
				markInvalid(emailInput, 'Could not connect to server');
				markInvalid(passInput, 'Could not connect to server');
				setLoading(false);
			});
	});

	// ── Validation functions ─────────────────────────────

	/**
	 * Validates the email field against EMAIL_REGEX.
	 * @returns {boolean} true if valid
	 */
	function validateEmail() {
		const val = emailInput.value.trim();

		if (!val) {
			markInvalid(emailInput, 'Email address is required.');
			return false;
		}
		if (!EMAIL_REGEX.test(val)) {
			markInvalid(emailInput, 'Please enter a valid email address (e.g. name@example.com).');
			return false;
		}

		markValid(emailInput);
		return true;
	}

	/**
	 * Validates the password field — must be non-empty and at least 8 characters.
	 * @returns {boolean} true if valid
	 */
	function validatePassword() {
		const val = passInput.value;

		if (!val) {
			markInvalid(passInput, 'Password is required.');
			return false;
		}
		if (val.length < 8) {
			markInvalid(passInput, 'Password must be at least 8 characters.');
			return false;
		}

		markValid(passInput);
		return true;
	}

	// ── UI helpers ───────────────────────────────────────

	/**
	 * Marks an input as invalid and updates its feedback message.
	 * Walks up to the input-group wrapper so Bootstrap's invalid-feedback
	 * div is found regardless of input-group nesting.
	 */
	function markInvalid(input, message) {
		input.classList.add('is-invalid');
		input.classList.remove('is-valid');

		// Find the closest wrapping div and look for invalid-feedback inside it
		const wrapper = input.closest('.input-group') || input.parentElement;
		const feedback = wrapper.querySelector('.invalid-feedback');
		if (feedback) feedback.textContent = message;
	}

	/**
	 * Marks an input as valid and clears any error state.
	 */
	function markValid(input) {
		input.classList.remove('is-invalid');
		input.classList.add('is-valid');
	}

	/**
	 * Toggles the submit button between its normal and loading states.
	 * @param {boolean} loading
	 */
	function setLoading(loading) {
		submitBtn.disabled = loading;
		submitBtn.innerHTML = loading
			? '<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>Signing in…'
			: 'Sign In';
	}

});
