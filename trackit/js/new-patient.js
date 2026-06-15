/**
 * new-patient.js — Trackit patient registration logic
 *
 * Handles:
 *  - Nigerian states dropdown population
 *  - Patient ID preview (reads localStorage to find next available ID)
 *  - Photo upload with FileReader preview
 *  - Per-field validation rules with regex (fires on blur + re-fires on input)
 *  - Clear button (resets form, photo, and all validation states)
 *  - Save button (validates everything, persists to localStorage, shows toast,
 *    redirects to find-patient.html)
 *  - Desktop and mobile save/clear buttons wired to the same handlers
 */

document.addEventListener('DOMContentLoaded', function () {

	requireAuth();

	// ── Nigerian states ──────────────────────────────────────
	const NIGERIAN_STATES = [
		'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa',
		'Benue', 'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo',
		'Ekiti', 'Enugu', 'FCT (Abuja)', 'Gombe', 'Imo', 'Jigawa',
		'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara',
		'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun',
		'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara'
	];

	const stateSelect = document.getElementById('state');
	NIGERIAN_STATES.forEach(function (s) {
		const opt = document.createElement('option');
		opt.value = s;
		opt.textContent = s;
		stateSelect.appendChild(opt);
	});

	// ── Regex patterns ───────────────────────────────────────
	const EMAIL_REGEX = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
	const MOBILE_REGEX = /^(0)(7|8|9)(0|1)\d{8}$/;
	const NIN_REGEX = /^\d{11}$/;
	const NAME_REGEX = /^[A-Za-z\s'\-]{2,}$/;
	const ZIP_REGEX = /^\d{5,6}$/;

	// ── Validation rules ─────────────────────────────────────
	// Each entry maps a field ID to its empty message, regex, invalid message,
	// and an optional custom validator that returns an error string or null.
	const RULES = [
		{
			id: 'nationalId',
			empty: 'National ID (NIN) is required.',
			regex: NIN_REGEX,
			invalid: 'NIN must be exactly 11 digits, numbers only.'
		},
		{
			id: 'firstName',
			empty: 'First name is required.',
			regex: NAME_REGEX,
			invalid: 'First name must be at least 2 letters.'
		},
		{
			id: 'lastName',
			empty: 'Last name is required.',
			regex: NAME_REGEX,
			invalid: 'Last name must be at least 2 letters.'
		},
		{
			id: 'gender',
			empty: 'Please select a gender.',
			regex: null, invalid: null
		},
		{
			id: 'age',
			empty: 'Age is required.',
			regex: /^\d{1,3}$/,
			invalid: 'Age must be a whole number.',
			custom: function (v) {
				const n = parseInt(v, 10);
				if (n < 0 || n > 150) return 'Age must be between 0 and 150.';
				return null;
			}
		},
		{
			id: 'dob',
			empty: 'Date of birth is required.',
			regex: null, invalid: null,
			custom: function (v) {
				const d = new Date(v);
				if (isNaN(d.getTime())) return 'Please enter a valid date.';
				if (d > new Date()) return 'Date of birth cannot be in the future.';
				return null;
			}
		},
		{
			id: 'mobile',
			empty: 'Mobile number is required.',
			regex: MOBILE_REGEX,
			invalid: 'Enter a valid Nigerian number starting with 070, 080, 081, 090, or 091.'
		},
		{
			id: 'email',
			empty: 'Email address is required.',
			regex: EMAIL_REGEX,
			invalid: 'Please enter a valid email address (e.g. name@example.com).'
		},
		{
			id: 'bloodType',
			empty: 'Please select a blood type.',
			regex: null, invalid: null
		},
		{
			id: 'genotype',
			empty: 'Please select a genotype.',
			regex: null, invalid: null
		},
		{
			id: 'department',
			empty: 'Department is required.',
			regex: /^[A-Za-z\s]{3,}$/,
			invalid: 'Department name must be at least 3 letters.'
		},
		{
			id: 'maritalStatus',
			empty: 'Please select a marital status.',
			regex: null, invalid: null
		},
		{
			id: 'state',
			empty: 'Please select a state.',
			regex: null, invalid: null
		},
		{
			id: 'city',
			empty: 'City / LGA is required.',
			regex: /^.{2,}$/,
			invalid: 'Please enter a valid city name.'
		},
		{
			id: 'street',
			empty: 'Street address is required.',
			regex: /^.{5,}$/,
			invalid: 'Street address must be at least 5 characters.'
		},
		{
			id: 'zip',
			empty: 'ZIP / Postal code is required.',
			regex: ZIP_REGEX,
			invalid: 'Enter a valid 5 or 6-digit postal code.'
		}
	];

	// ── Patient ID preview ───────────────────────────────────
	/**
	 * Reads localStorage to find the current highest patient number,
	 * then shows the next available ID in the sidebar preview.
	 */
	function refreshIdPreview() {
		const saved = JSON.parse(localStorage.getItem('trackit_patients') || '[]');
		let maxNum = 15; // TRK-001 to TRK-015 are the default dataset
		saved.forEach(function (p) {
			const n = parseInt((p.id || '').replace('TRK-', ''), 10);
			if (!isNaN(n) && n > maxNum) maxNum = n;
		});
		document.getElementById('previewId').textContent =
			'TRK-' + String(maxNum + 1).padStart(3, '0');
	}
	refreshIdPreview();

	// ── Photo upload ─────────────────────────────────────────
	const photoInput = document.getElementById('photoInput');
	const photoBox = document.getElementById('photoBox');
	const photoImg = document.getElementById('photoImg');
	const photoHolder = document.getElementById('photoPlaceholder');
	const photoFileName = document.getElementById('photoFileName');
	const uploadBtn = document.getElementById('uploadBtn');

	/** Open the hidden file picker */
	function triggerFilePicker() { photoInput.click(); }
	photoBox.addEventListener('click', triggerFilePicker);
	uploadBtn.addEventListener('click', function (e) {
		e.stopPropagation(); // prevent double-trigger from photoBox click
		triggerFilePicker();
	});

	photoInput.addEventListener('change', function () {
		const file = this.files[0];
		if (!file) return;

		if (file.size > 5 * 1024 * 1024) {
			showToast('Photo must be under 5 MB. Please choose a smaller file.', 'danger');
			return;
		}

		const reader = new FileReader();
		reader.onload = function (e) {
			photoImg.src = e.target.result;
			photoImg.style.display = 'block';
			photoHolder.style.display = 'none';
			photoFileName.textContent = file.name;
		};
		reader.readAsDataURL(file);
	});

	// ── Real-time blur validation ────────────────────────────
	RULES.forEach(function (rule) {
		const el = document.getElementById(rule.id);
		if (!el) return;

		// Validate when user leaves the field
		el.addEventListener('blur', function () { validateField(rule); });

		// Re-validate while typing once the field has been touched
		el.addEventListener('input', function () {
			if (el.classList.contains('is-invalid') ||
				el.classList.contains('is-valid')) {
				validateField(rule);
			}
		});
		// Selects fire 'change', not 'input'
		el.addEventListener('change', function () {
			if (el.tagName === 'SELECT') validateField(rule);
		});
	});

	// ── Clear form ───────────────────────────────────────────
	function clearForm() {
		// Reset all form fields inside <form id="patientForm">
		document.getElementById('patientForm').reset();

		// Also reset address fields (they live outside the <form> tag)
		['country', 'state', 'city', 'zip', 'street'].forEach(function (id) {
			const el = document.getElementById(id);
			if (!el) return;
			if (el.tagName === 'SELECT') el.selectedIndex = 0;
			else el.value = '';
		});

		// Clear all Bootstrap validation states
		document.querySelectorAll('.is-valid, .is-invalid').forEach(function (el) {
			el.classList.remove('is-valid', 'is-invalid');
		});

		// Reset photo preview
		photoImg.src = '';
		photoImg.style.display = 'none';
		photoHolder.style.display = '';
		photoFileName.textContent = 'No photo selected';
		photoInput.value = '';

		// Clear contacts
		contacts.length = 0;
		renderContacts();
		refreshIdPreview();
		window.scrollTo({ top: 0, behavior: 'smooth' });
	}

	document.getElementById('clearBtn').addEventListener('click', clearForm);
	document.getElementById('clearBtnMobile').addEventListener('click', clearForm);

	// ── Save ─────────────────────────────────────────────────
	function handleSave() {
		// Run all validations
		const allValid = RULES.every(function (rule) {
			return validateField(rule);
		});

		if (!allValid) {
			// Scroll to the first invalid field so the user sees what's wrong
			const firstInvalid = document.querySelector('.is-invalid');
			if (firstInvalid) {
				firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
				setTimeout(function () { firstInvalid.focus(); }, 400);
			}
			showToast('Please fix the highlighted errors before saving.', 'danger');
			return;
		}

		const patient = buildPatient();
		setSaving(true);

		apiFetch('/api/patients', {
			method: 'POST',
			body: JSON.stringify(patient)
		})
			.then(function (saved) {
				// Show the backend-assigned ID and mark the preview as saved
				document.getElementById('previewId').textContent = saved.id;
				const badge = document.querySelector('#previewId + .badge');
				if (badge) {
					badge.className = 'badge bg-success small';
					badge.textContent = 'Saved';
				}

				showToast(
					`<i class="bi bi-check-circle-fill me-2"></i>
       Patient <strong>${patient.firstName} ${patient.lastName}</strong>
       registered as <strong>${saved.id}</strong>`,
					'success'
				);

				// Brief delay then redirect so the user sees the toast
				setTimeout(function () {
					window.location.href = 'find-patient.html?new=1';
				}, 2200);
			})
			.catch(function (err) {
				showToast(
					`<i class="bi bi-exclamation-triangle-fill me-2"></i>${err.message}`,
					'danger'
				);
				setSaving(false);
			});
	}

	/** Disables/enables the save buttons while a save request is in flight */
	function setSaving(saving) {
		[document.getElementById('saveBtn'), document.getElementById('saveBtnMobile')]
			.forEach(function (btn) {
				if (btn) btn.disabled = saving;
			});
	}

	document.getElementById('saveBtn').addEventListener('click', handleSave);
	document.getElementById('saveBtnMobile').addEventListener('click', handleSave);

	// ── Build patient object ─────────────────────────────────
	function buildPatient() {
		return {
			nationalId: getVal('nationalId'),
			firstName: getVal('firstName'),
			lastName: getVal('lastName'),
			gender: getVal('gender'),
			age: parseInt(getVal('age'), 10),
			dob: getVal('dob'),
			mobile: getVal('mobile'),
			email: getVal('email'),
			bloodType: getVal('bloodType'),
			genotype: getVal('genotype'),
			department: getVal('department'),
			maritalStatus: getVal('maritalStatus'),
			country: getVal('country'),
			state: getVal('state'),
			city: getVal('city'),
			street: getVal('street'),
			zip: getVal('zip'),
			telephone: getVal('telephone') || null,
			doctor: getVal('doctor') || null,
			contacts: contacts.slice(),
			status: 'Active',
			registeredDate: new Date().toISOString().split('T')[0],
			photo: photoImg.src || null
		};
	}

	// ── Contacts management ──────────────────────────────────
	const contacts = [];

	document.getElementById('addContactBtn').addEventListener('click', function () {
		const type = document.getElementById('contactType').value;
		const detail = document.getElementById('contactDetail').value.trim();
		if (!type || !detail) {
			showToast('Please select a contact type and enter the detail.', 'danger');
			return;
		}
		contacts.push({ type, detail });
		renderContacts();
		document.getElementById('contactType').value = '';
		document.getElementById('contactDetail').value = '';
	});

	function renderContacts() {
		const list = document.getElementById('contactsList');
		const noMsg = document.getElementById('noContactsMsg');
		noMsg.style.display = contacts.length ? 'none' : '';
		list.innerHTML = contacts.map(function (c, i) {
			return '<div class="d-flex align-items-center justify-content-between ' +
				'py-2 border-bottom" style="font-size:.85rem;">' +
				'<span><strong>' + c.type + ':</strong> ' + c.detail + '</span>' +
				'<button type="button" class="btn btn-sm btn-outline-danger py-0 px-2" ' +
				'style="font-size:.75rem;" onclick="removeContact(' + i + ')">Remove</button>' +
				'</div>';
		}).join('');
	}

	window.removeContact = function (index) {
		contacts.splice(index, 1);
		renderContacts();
	};

	// ── Validation helpers ───────────────────────────────────

	/**
	 * Validates a single field against its rule.
	 * @param {object} rule — entry from RULES array
	 * @returns {boolean} true if valid
	 */
	function validateField(rule) {
		const el = document.getElementById(rule.id);
		if (!el) return true;

		const value = el.value.trim();

		// Skip optional fields — they pass validation regardless
		if (rule.optional) { markValid(el); return true; }

		if (!value) {
			markInvalid(el, rule.empty);
			return false;
		}
		if (rule.custom) {
			const msg = rule.custom(value);
			if (msg) { markInvalid(el, msg); return false; }
		}
		if (rule.regex && !rule.regex.test(value)) {
			markInvalid(el, rule.invalid);
			return false;
		}

		markValid(el);
		return true;
	}

	function markInvalid(el, message) {
		el.classList.add('is-invalid');
		el.classList.remove('is-valid');
		const fb = el.parentElement.querySelector('.invalid-feedback');
		if (fb) fb.textContent = message;
	}

	function markValid(el) {
		el.classList.remove('is-invalid');
		el.classList.add('is-valid');
	}

	/** Safely read a trimmed value from any field by ID */
	function getVal(id) {
		const el = document.getElementById(id);
		return el ? el.value.trim() : '';
	}

	// ── Toast notification ───────────────────────────────────
	/**
	 * Shows a Bootstrap toast in the top-right corner.
	 * @param {string} html  — inner HTML content (can include tags)
	 * @param {string} type  — 'success' | 'danger'
	 */
	function showToast(html, type) {
		const bgClass = type === 'success' ? 'bg-success' : 'bg-danger';
		const toast = document.createElement('div');
		toast.className = `toast align-items-center text-white ${bgClass} border-0`;
		toast.setAttribute('role', 'alert');
		toast.setAttribute('aria-live', 'assertive');
		toast.style.minWidth = '300px';
		toast.innerHTML = `
      <div class="d-flex">
        <div class="toast-body">${html}</div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto"
                data-bs-dismiss="toast" aria-label="Close"></button>
      </div>`;

		document.getElementById('toastContainer').appendChild(toast);
		const bsToast = new bootstrap.Toast(toast, { delay: 4500 });
		bsToast.show();
		toast.addEventListener('hidden.bs.toast', function () { toast.remove(); });
	}

});
