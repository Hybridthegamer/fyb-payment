/**
 * patient-connection.js — Trackit Patient Connection page
 *
 * Handles:
 *  - Animated ECG waveform (canvas — P wave, QRS complex, T wave)
 *  - Connect to patient by ID (API lookup) or name (API search), falling
 *    back to DEFAULT_PATIENTS if the API is unavailable
 *  - Live vital signs display with realistic fluctuation when connected
 *  - Pause / Resume / Stop / Save / Analyse ECG controls
 *  - UDP toggle (visual demo)
 *  - Patient info panel population on connect
 */

document.addEventListener('DOMContentLoaded', function () {

	requireAuth();

	// ── Canvas setup ─────────────────────────────────────────
	const canvas = document.getElementById('ecgCanvas');
	const ctx = canvas.getContext('2d');

	function resizeCanvas() {
		canvas.width = canvas.offsetWidth;
		canvas.height = canvas.offsetHeight;
	}
	resizeCanvas();
	window.addEventListener('resize', function () {
		resizeCanvas();
		if (!ecg.running) drawIdle();
	});

	// ── ECG heartbeat pattern ────────────────────────────────
	// Normalised: x ∈ [0,1], y ∈ [-1,1]
	// Represents one complete cardiac cycle: baseline → P → QRS → T → baseline
	const BEAT_POINTS = [
		[0.00, 0.00],
		[0.09, 0.00],
		[0.13, 0.04],
		[0.17, 0.14],   // P wave peak
		[0.21, 0.04],
		[0.25, 0.00],
		[0.30, 0.00],
		[0.33, -0.08],   // Q dip
		[0.37, 0.00],
		[0.39, -0.12],
		[0.41, 1.00],   // R spike
		[0.43, -0.38],   // S dip
		[0.46, 0.00],
		[0.52, 0.00],
		[0.58, 0.00],
		[0.62, 0.07],
		[0.67, 0.26],   // T wave peak
		[0.72, 0.07],
		[0.76, 0.00],
		[1.00, 0.00]
	];

	/**
	 * Interpolates the normalised ECG pattern at position t ∈ [0,1].
	 * Uses linear interpolation between control points.
	 */
	function ecgAt(t) {
		for (let i = 0; i < BEAT_POINTS.length - 1; i++) {
			const [x0, y0] = BEAT_POINTS[i];
			const [x1, y1] = BEAT_POINTS[i + 1];
			if (t >= x0 && t <= x1) {
				const frac = (t - x0) / (x1 - x0);
				return y0 + frac * (y1 - y0);
			}
		}
		return 0;
	}

	/**
	 * Generates a synthetic ECG signal of `numSamples` points by repeating
	 * the BEAT_POINTS waveform at the current heart rate, treated as 360Hz.
	 */
	function generateEcgSignal(numSamples) {
		const sampleRate = 360; // Hz, matches ml-service assumption
		const bpm = ecg.bpm || 72;
		const samplesPerCycle = (sampleRate * 60) / bpm;

		const signal = [];
		for (let i = 0; i < numSamples; i++) {
			const t = (i % samplesPerCycle) / samplesPerCycle;
			signal.push(ecgAt(t));
		}
		return signal;
	}

	// ── ECG state ────────────────────────────────────────────
	const ecg = {
		running: false,
		paused: false,
		t: 0,          // current position within the beat cycle (0–1)
		bpm: 72,         // beats per minute — controls scroll speed
		buffer: [],         // rolling Y values (one per canvas pixel column)
		rafId: null
	};

	// ── Draw idle flat line ──────────────────────────────────
	function drawIdle() {
		const { width, height } = canvas;
		ctx.fillStyle = '#060d1a';
		ctx.fillRect(0, 0, width, height);
		drawGrid();

		// Flat centre line
		ctx.strokeStyle = 'rgba(0, 200, 100, 0.25)';
		ctx.lineWidth = 1.5;
		ctx.beginPath();
		ctx.moveTo(0, height / 2);
		ctx.lineTo(width, height / 2);
		ctx.stroke();

		// "Connect a patient" label
		ctx.fillStyle = 'rgba(255,255,255,0.15)';
		ctx.font = '13px system-ui, sans-serif';
		ctx.textAlign = 'center';
		ctx.fillText('Connect a patient to begin monitoring', width / 2, height / 2 - 18);
		ctx.textAlign = 'left';
	}

	function drawGrid() {
		const { width, height } = canvas;
		ctx.strokeStyle = 'rgba(0,150,80,0.10)';
		ctx.lineWidth = 0.5;
		const step = 20;
		for (let x = 0; x < width; x += step) {
			ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
		}
		for (let y = 0; y < height; y += step) {
			ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
		}
	}

	drawIdle();

	// ── Animation loop ───────────────────────────────────────
	function animate() {
		if (!ecg.running || ecg.paused) return;

		const { width, height } = canvas;
		const midY = height / 2;
		const amplitude = height * 0.36;

		// How much to advance t per frame: faster BPM = faster scroll
		const advance = (ecg.bpm / 60) * (1 / 60) * 0.9;
		ecg.t = (ecg.t + advance) % 1;

		const yVal = ecgAt(ecg.t);
		ecg.buffer.push(yVal);
		if (ecg.buffer.length > width) ecg.buffer.shift();

		// Redraw
		ctx.fillStyle = '#060d1a';
		ctx.fillRect(0, 0, width, height);
		drawGrid();

		// ECG trace
		ctx.strokeStyle = '#00e676';
		ctx.lineWidth = 2;
		ctx.shadowColor = '#00e676';
		ctx.shadowBlur = 5;
		ctx.beginPath();

		for (let i = 0; i < ecg.buffer.length; i++) {
			const x = i;
			const y = midY - ecg.buffer[i] * amplitude;
			i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
		}
		ctx.stroke();

		// Cursor dot
		const lx = ecg.buffer.length - 1;
		const ly = midY - ecg.buffer[lx] * amplitude;
		ctx.fillStyle = '#ffffff';
		ctx.shadowColor = '#00e676';
		ctx.shadowBlur = 12;
		ctx.beginPath();
		ctx.arc(lx, ly, 3, 0, Math.PI * 2);
		ctx.fill();
		ctx.shadowBlur = 0;

		ecg.rafId = requestAnimationFrame(animate);
	}

	function startECG() {
		ecg.running = true;
		ecg.paused = false;
		ecg.buffer = [];
		animate();
	}

	function pauseECG() {
		ecg.paused = true;
		if (ecg.rafId) cancelAnimationFrame(ecg.rafId);
	}

	function resumeECG() {
		if (ecg.running && ecg.paused) {
			ecg.paused = false;
			animate();
		}
	}

	function stopECG() {
		ecg.running = false;
		ecg.paused = false;
		if (ecg.rafId) cancelAnimationFrame(ecg.rafId);
		ecg.buffer = [];
		drawIdle();
	}

	// ── Vital signs ──────────────────────────────────────────
	const VITALS_BASE = {
		temp: 36.8, hr: 72, spo2: 97, sys: 118, dia: 76, resp: 16
	};

	let vitalsInterval = null;
	let vitalsState = { ...VITALS_BASE };

	function startVitals() {
		updateVitalsDisplay();
		vitalsInterval = setInterval(function () {
			// Gentle random fluctuation
			vitalsState.temp = clamp(vitalsState.temp + rand(-0.05, 0.05), 36.0, 38.5);
			vitalsState.hr = clamp(vitalsState.hr + rand(-2, 2), 50, 110);
			vitalsState.spo2 = clamp(vitalsState.spo2 + rand(-0.5, 0.5), 90, 100);
			vitalsState.sys = clamp(vitalsState.sys + rand(-1, 1), 90, 160);
			vitalsState.dia = clamp(vitalsState.dia + rand(-1, 1), 50, 110);
			vitalsState.resp = clamp(vitalsState.resp + rand(-0.5, 0.5), 10, 25);

			// Sync ECG speed to heart rate
			ecg.bpm = Math.round(vitalsState.hr);

			updateVitalsDisplay();
		}, 1200);
	}

	function stopVitals() {
		if (vitalsInterval) clearInterval(vitalsInterval);
		vitalsInterval = null;
		['Temp', 'HR', 'SPO2', 'BP', 'Resp'].forEach(function (id) {
			const el = document.getElementById('val' + id);
			if (el) el.textContent = '—';
		});
		document.querySelectorAll('.vital-card').forEach(function (c) {
			c.classList.remove('active');
		});
		document.querySelectorAll('.vital-value').forEach(function (v) {
			v.classList.remove('active');
		});
	}

	function updateVitalsDisplay() {
		setText('valTemp', vitalsState.temp.toFixed(1));
		setText('valHR', Math.round(vitalsState.hr).toString());
		setText('valSPO2', Math.round(vitalsState.spo2).toString());
		setText('valBP', Math.round(vitalsState.sys) + '/' + Math.round(vitalsState.dia));
		setText('valResp', Math.round(vitalsState.resp).toString());

		document.querySelectorAll('.vital-card').forEach(function (c) {
			c.classList.add('active');
		});
		document.querySelectorAll('.vital-value').forEach(function (v) {
			v.classList.add('active');
		});
	}

	// ── Patient data ─────────────────────────────────────────
	let connectedPat = null;

	// Populate datalist suggestions
	const connType = document.getElementById('connType');
	const connValue = document.getElementById('connValue');
	const connLabel = document.getElementById('connValueLabel');
	const suggestions = document.getElementById('patientSuggestions');

	function rebuildSuggestions() {
		suggestions.innerHTML = '';
		DEFAULT_PATIENTS.forEach(function (p) {
			const opt = document.createElement('option');
			opt.value = connType.value === 'name'
				? p.firstName + ' ' + p.lastName
				: p.id;
			suggestions.appendChild(opt);
		});
		connLabel.textContent = connType.value === 'name' ? 'Name' : 'Patient ID';
		connValue.placeholder = connType.value === 'name' ? 'e.g. Amaka Okafor' : 'e.g. TRK-002';
	}
	connType.addEventListener('change', rebuildSuggestions);
	rebuildSuggestions();

	// ── Connect / disconnect ─────────────────────────────────

	/** Local fallback lookup against DEFAULT_PATIENTS only */
	function findPatientLocal(query) {
		const q = query.trim().toLowerCase();
		if (!q) return null;
		if (connType.value === 'id') {
			return DEFAULT_PATIENTS.find(function (p) {
				return p.id.toLowerCase() === q;
			}) || null;
		}
		return DEFAULT_PATIENTS.find(function (p) {
			return (p.firstName + ' ' + p.lastName).toLowerCase() === q ||
				p.lastName.toLowerCase() === q ||
				p.firstName.toLowerCase() === q;
		}) || null;
	}

	/**
	 * Looks up a patient via the API: by ID first (unless the search type is
	 * "name"), then by search query, then falls back to DEFAULT_PATIENTS.
	 */
	async function findPatient(query) {
		const q = query.trim();
		if (!q) return null;

		if (connType.value !== 'name') {
			try {
				const patient = await apiFetch('/api/patients/' + encodeURIComponent(q));
				if (patient) return patient;
			} catch (err) {
				if (err.status !== 404) console.warn('Patient lookup by ID failed:', err);
			}
		}

		try {
			const results = await apiFetch('/api/patients?search=' + encodeURIComponent(q));
			if (results && results.length > 0) return results[0];
		} catch (err) {
			console.warn('Patient search failed:', err);
		}

		return findPatientLocal(q);
	}

	async function connect() {
		const connectBtn = document.getElementById('connectBtn');
		const originalHtml = connectBtn.innerHTML;
		connectBtn.disabled = true;
		connectBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Connecting…';

		const patient = await findPatient(connValue.value);

		connectBtn.disabled = false;
		connectBtn.innerHTML = originalHtml;

		if (!patient) {
			connValue.classList.add('is-invalid');
			const errEl = document.getElementById('connError');
			errEl.textContent = 'No patient found. Check the name or ID and try again.';
			errEl.style.display = 'block';
			return;
		}
		connValue.classList.remove('is-invalid');
		document.getElementById('connError').style.display = 'none';

		connectedPat = patient;
		setConnectedState(true);
		showPatientInfo(patient);
		resetEcgResult();

		// Start ECG and vitals
		vitalsState = { ...VITALS_BASE };
		startECG();
		startVitals();

		showToast(
			`<i class="bi bi-plug-fill me-2"></i>Connected to <strong>${patient.firstName} ${patient.lastName}</strong>`,
			'success'
		);
	}

	function disconnect() {
		connectedPat = null;
		setConnectedState(false);
		stopECG();
		stopVitals();
		clearPatientInfo();
		resetEcgResult();
		showToast('Disconnected from patient.', 'secondary');
	}

	function setConnectedState(connected) {
		const liveBadge = document.getElementById('liveBadge');
		const liveText = document.getElementById('liveText');
		const btnPause = document.getElementById('btnPause');
		const btnSave = document.getElementById('btnSave');
		const btnAnalyse = document.getElementById('btnAnalyse');
		const btnStop = document.getElementById('btnStop');
		const connectBtn = document.getElementById('connectBtn');
		const disconnBtn = document.getElementById('disconnectBtn');

		liveBadge.classList.toggle('active', connected);
		liveText.textContent = connected ? 'LIVE' : 'DISCONNECTED';

		btnPause.disabled = !connected;
		btnSave.disabled = !connected;
		btnAnalyse.disabled = !connected;
		btnStop.disabled = !connected;

		connectBtn.classList.toggle('d-none', connected);
		disconnBtn.classList.toggle('d-none', !connected);
	}

	function showPatientInfo(p) {
		document.getElementById('patientInfoPanel').innerHTML = `
      <div class="info-row">
        <span>Patient ID</span>
        <span style="font-family:monospace;color:var(--green-dark);">${esc(p.id)}</span>
      </div>
      <div class="info-row">
        <span>Full Name</span>
        <span>${esc(p.firstName)} ${esc(p.lastName)}</span>
      </div>
      <div class="info-row">
        <span>Age</span>
        <span>${p.age} yrs</span>
      </div>
      <div class="info-row">
        <span>Gender</span>
        <span>${esc(p.gender)}</span>
      </div>
      <div class="info-row">
        <span>Blood Type</span>
        <span style="color:var(--green-dark);font-weight:700;">${esc(p.bloodType)}</span>
      </div>
      <div class="info-row">
        <span>Department</span>
        <span>${esc(p.department)}</span>
      </div>
      <div class="info-row">
        <span>Status</span>
        <span class="badge-${p.status === 'Active' ? 'active' : 'inactive'}">${esc(p.status)}</span>
      </div>`;
	}

	function clearPatientInfo() {
		document.getElementById('patientInfoPanel').innerHTML = `
      <div class="disconnected-msg">
        <i class="bi bi-person-slash"></i>
        <div class="small">No patient connected</div>
      </div>`;
	}

	// ── ECG analysis result ───────────────────────────────────
	const CLASSIFICATION_BADGE = {
		Normal: 'bg-success',
		Tachycardia: 'bg-warning text-dark',
		Bradycardia: 'bg-warning text-dark',
		'Atrial Fibrillation': 'bg-danger',
		Chaotic: 'bg-danger',
		Unavailable: 'bg-secondary'
	};

	function showEcgResult(classification, confidence) {
		const badge = document.getElementById('ecgResultBadge');
		badge.className = 'badge ' + (CLASSIFICATION_BADGE[classification] || 'bg-secondary');
		badge.textContent = classification;
		document.getElementById('ecgResultConfidence').textContent =
			typeof confidence === 'number' ? `${Math.round(confidence * 100)}% confidence` : '';
	}

	function resetEcgResult() {
		const badge = document.getElementById('ecgResultBadge');
		badge.className = 'badge bg-secondary';
		badge.textContent = 'Not yet analysed';
		document.getElementById('ecgResultConfidence').textContent = '';
	}

	// ── Control buttons ──────────────────────────────────────
	document.getElementById('connectBtn').addEventListener('click', connect);
	document.getElementById('btnConnect').addEventListener('click', function () {
		connValue.focus();
		window.scrollTo({ top: 0, behavior: 'smooth' });
	});
	document.getElementById('disconnectBtn').addEventListener('click', disconnect);

	document.getElementById('btnPause').addEventListener('click', function () {
		if (!ecg.paused) {
			pauseECG();
			if (vitalsInterval) clearInterval(vitalsInterval);
			this.innerHTML = '<i class="bi bi-play-fill me-1"></i>Resume';
			this.classList.replace('btn-outline-secondary', 'btn-outline-success');
		} else {
			resumeECG();
			startVitals();
			this.innerHTML = '<i class="bi bi-pause-fill me-1"></i>Pause';
			this.classList.replace('btn-outline-success', 'btn-outline-secondary');
		}
	});

	document.getElementById('btnSave').addEventListener('click', function () {
		if (!connectedPat) return;
		showToast(
			`<i class="bi bi-check-circle-fill me-2"></i>
       Session saved for <strong>${connectedPat.firstName} ${connectedPat.lastName}</strong>`,
			'success'
		);
	});

	document.getElementById('btnAnalyse').addEventListener('click', async function () {
		if (!connectedPat) return;

		const btn = this;
		const originalHtml = btn.innerHTML;
		btn.disabled = true;
		btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Analysing…';

		const signal = generateEcgSignal(720);

		try {
			const result = await apiFetch('/api/ecg/analyse', {
				method: 'POST',
				body: JSON.stringify({ patientId: connectedPat.id, signal })
			});
			showEcgResult(result.classification, result.confidence);
			showToast(
				`<i class="bi bi-activity me-2"></i>ECG analysis: <strong>${esc(result.classification)}</strong>`,
				'success'
			);
		} catch (err) {
			showToast(
				`<i class="bi bi-exclamation-triangle-fill me-2"></i>ECG analysis failed: ${esc(err.message)}`,
				'danger'
			);
		} finally {
			btn.disabled = !connectedPat;
			btn.innerHTML = originalHtml;
		}
	});

	document.getElementById('btnStop').addEventListener('click', function () {
		disconnect();
		const pauseBtn = document.getElementById('btnPause');
		pauseBtn.innerHTML = '<i class="bi bi-pause-fill me-1"></i>Pause';
		pauseBtn.classList.replace('btn-outline-success', 'btn-outline-secondary');
	});

	let udpOn = false;
	document.getElementById('btnUDP').addEventListener('click', function () {
		udpOn = !udpOn;
		this.innerHTML = udpOn
			? '<i class="bi bi-broadcast me-1"></i>UDP: ON'
			: '<i class="bi bi-broadcast me-1"></i>UDP';
		this.classList.toggle('btn-primary', udpOn);
		this.classList.toggle('btn-outline-secondary', !udpOn);
	});

	// Allow Enter key in connect input
	connValue.addEventListener('keydown', function (e) {
		if (e.key === 'Enter') connect();
	});
	connValue.addEventListener('input', function () {
		this.classList.remove('is-invalid');
	});

	// ── Utility ──────────────────────────────────────────────
	function rand(min, max) {
		return Math.random() * (max - min) + min;
	}
	function clamp(val, min, max) {
		return Math.min(Math.max(val, min), max);
	}
	function setText(id, val) {
		const el = document.getElementById(id);
		if (el) el.textContent = val;
	}
	function esc(str) {
		return String(str)
			.replace(/&/g, '&amp;').replace(/</g, '&lt;')
			.replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	}

	function showToast(html, type) {
		const bg = { success: 'bg-success', danger: 'bg-danger', secondary: 'bg-secondary' };
		const toast = document.createElement('div');
		toast.className = `toast align-items-center text-white ${bg[type] || 'bg-secondary'} border-0`;
		toast.setAttribute('role', 'alert');
		toast.style.minWidth = '280px';
		toast.innerHTML = `
      <div class="d-flex">
        <div class="toast-body">${html}</div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto"
                data-bs-dismiss="toast" aria-label="Close"></button>
      </div>`;
		document.getElementById('toastContainer').appendChild(toast);
		const bsToast = new bootstrap.Toast(toast, { delay: 4000 });
		bsToast.show();
		toast.addEventListener('hidden.bs.toast', function () { toast.remove(); });
	}

});
