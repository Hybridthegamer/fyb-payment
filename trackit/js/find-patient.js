/**
 * find-patient.js — Trackit patient search and table logic
 *
 * Handles:
 *  - Merging DEFAULT_PATIENTS (from data.js) with patients from the API
 *  - "New patient registered" toast when redirected from new-patient.html
 *  - Live search across name, ID, NIN, and department
 *  - Filter dropdowns: department, gender, status
 *  - Clear all filters button
 *  - Sortable columns (click header to sort asc/desc, icons update)
 *  - Table rendering with empty state
 *  - Result count display
 *  - CSV export of currently filtered results
 *  - Patient detail modal (view all fields)
 */

document.addEventListener('DOMContentLoaded', function () {

    requireAuth();

    // ── State ──────────────────────────────────────────────
    let allPatients = [];
    let filteredPatients = [];

    // ── Sort state ───────────────────────────────────────────
    // Default: most recently registered first
    let sortCol = 'registeredDate';
    let sortDir = 'desc';

    // ── DOM refs ─────────────────────────────────────────────
    const searchInput = document.getElementById('searchInput');
    const deptFilter = document.getElementById('deptFilter');
    const genderFilter = document.getElementById('genderFilter');
    const statusFilter = document.getElementById('statusFilter');
    const clearFiltersBtn = document.getElementById('clearFiltersBtn');
    const tableBody = document.getElementById('patientTableBody');
    const resultCount = document.getElementById('resultCount');
    const exportBtn = document.getElementById('exportBtn');

    // ── Show toast if redirected from new-patient.html ───────
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('new') === '1') {
        // Clean the URL without reloading
        history.replaceState({}, '', 'find-patient.html');
        showToast(
            '<i class="bi bi-check-circle-fill me-2"></i>New patient registered successfully!',
            'success'
        );
    }

    // ── Load patients from API, merged with DEFAULT_PATIENTS ─
    apiFetch('/api/patients')
        .then(function (apiPatients) {
            allPatients = mergePatients(DEFAULT_PATIENTS, apiPatients || []);
            init();
        })
        .catch(function (err) {
            console.warn('Could not load patients from API, falling back to defaults only:', err);
            allPatients = [...DEFAULT_PATIENTS];
            init();
        });

    /** Merges two patient lists, deduplicated by id (apiList entries win on conflict) */
    function mergePatients(defaults, apiList) {
        const map = new Map();
        defaults.forEach(function (p) { map.set(p.id, p); });
        apiList.forEach(function (p) { map.set(p.id, p); });
        return Array.from(map.values());
    }

    function init() {
        filteredPatients = [...allPatients];

        // ── Populate department filter ───────────────────────
        const departments = [...new Set(allPatients.map(p => p.department))].sort();
        departments.forEach(function (dept) {
            const opt = document.createElement('option');
            opt.value = dept;
            opt.textContent = dept;
            deptFilter.appendChild(opt);
        });

        // ── Initial render ───────────────────────────────────
        applyFilters();

        // ── Event listeners ──────────────────────────────────
        searchInput.addEventListener('input', applyFilters);
        deptFilter.addEventListener('change', applyFilters);
        genderFilter.addEventListener('change', applyFilters);
        statusFilter.addEventListener('change', applyFilters);
        clearFiltersBtn.addEventListener('click', clearAllFilters);
        exportBtn.addEventListener('click', exportCSV);

        // Sort on column header click
        document.querySelectorAll('.sort-th[data-col]').forEach(function (th) {
            th.addEventListener('click', function () {
                const col = this.dataset.col;
                if (sortCol === col) {
                    sortDir = sortDir === 'asc' ? 'desc' : 'asc';
                } else {
                    sortCol = col;
                    sortDir = 'asc';
                }
                updateSortIcons();
                sortData();
                renderTable();
            });
        });
    }

    // ── Filter logic ─────────────────────────────────────────
    /**
     * Reads all filter inputs, filters allPatients, then re-renders.
     */
    function applyFilters() {
        const q = searchInput.value.toLowerCase().trim();
        const dept = deptFilter.value;
        const gender = genderFilter.value;
        const status = statusFilter.value;

        filteredPatients = allPatients.filter(function (p) {
            const fullName = (p.firstName + ' ' + p.lastName).toLowerCase();

            const matchSearch = !q ||
                p.id.toLowerCase().includes(q) ||
                fullName.includes(q) ||
                p.firstName.toLowerCase().includes(q) ||
                p.lastName.toLowerCase().includes(q) ||
                p.department.toLowerCase().includes(q) ||
                (p.nationalId || '').includes(q) ||
                (p.email || '').toLowerCase().includes(q);

            const matchDept = !dept || p.department === dept;
            const matchGender = !gender || p.gender === gender;
            const matchStatus = !status || p.status === status;

            return matchSearch && matchDept && matchGender && matchStatus;
        });

        sortData();
        renderTable();
        updateResultCount();
    }

    // ── Clear all filters ────────────────────────────────────
    function clearAllFilters() {
        searchInput.value = '';
        deptFilter.value = '';
        genderFilter.value = '';
        statusFilter.value = '';
        applyFilters();
        searchInput.focus();
    }
    // Expose globally so empty-state button can call it
    window.clearAllFilters = clearAllFilters;

    // ── Sort logic ───────────────────────────────────────────
    function sortData() {
        filteredPatients.sort(function (a, b) {
            let valA = a[sortCol] !== undefined ? a[sortCol] : '';
            let valB = b[sortCol] !== undefined ? b[sortCol] : '';

            // Numeric sort for age
            if (sortCol === 'age') {
                valA = parseInt(valA, 10) || 0;
                valB = parseInt(valB, 10) || 0;
                return sortDir === 'asc' ? valA - valB : valB - valA;
            }

            // String sort for everything else
            valA = String(valA).toLowerCase();
            valB = String(valB).toLowerCase();
            if (valA < valB) return sortDir === 'asc' ? -1 : 1;
            if (valA > valB) return sortDir === 'asc' ? 1 : -1;
            return 0;
        });
    }

    // ── Update sort icons ────────────────────────────────────
    function updateSortIcons() {
        document.querySelectorAll('.sort-icon').forEach(function (icon) {
            const col = icon.id.replace('icon-', '');
            if (col === sortCol) {
                icon.className = 'sort-icon active bi ' +
                    (sortDir === 'asc' ? 'bi-arrow-up' : 'bi-arrow-down');
            } else {
                icon.className = 'sort-icon bi bi-arrow-down-up';
            }
        });
    }

    // ── Render table ─────────────────────────────────────────
    function renderTable() {
        if (filteredPatients.length === 0) {
            tableBody.innerHTML = `
        <tr>
          <td colspan="9" class="text-center py-5">
            <i class="bi bi-person-x" style="font-size:2.2rem;color:var(--text-muted);opacity:.4;display:block;margin-bottom:10px;"></i>
            <div class="text-muted mb-3">No patients match your current filters.</div>
            <button class="btn btn-sm btn-outline-primary px-3"
                    onclick="clearAllFilters()">
              Clear filters
            </button>
          </td>
        </tr>`;
            return;
        }

        tableBody.innerHTML = filteredPatients.map(function (p) {
            const statusClass = p.status === 'Active' ? 'badge-active' : 'badge-inactive';
            return `
        <tr>
          <td class="patient-id-cell">${escHtml(p.id)}</td>
          <td class="fw-medium">${escHtml(p.lastName)}, ${escHtml(p.firstName)}</td>
          <td>${p.age}</td>
          <td>${escHtml(p.gender)}</td>
          <td>${escHtml(p.department)}</td>
          <td>${escHtml(p.bloodType)}</td>
          <td><span class="${statusClass}">${escHtml(p.status)}</span></td>
          <td class="text-muted" style="font-size:.82rem;">${escHtml(p.registeredDate)}</td>
          <td>
            <button class="btn btn-sm btn-outline-primary px-2 py-0"
                    style="font-size:.78rem;"
                    onclick="viewPatient('${escHtml(p.id)}')">
              <i class="bi bi-eye me-1"></i>View
            </button>
          </td>
        </tr>`;
        }).join('');
    }

    // ── Update result count ──────────────────────────────────
    function updateResultCount() {
        const total = allPatients.length;
        const showing = filteredPatients.length;
        const filtered = showing < total;
        resultCount.innerHTML =
            `Showing <strong>${showing}</strong> of <strong>${total}</strong> patient${total !== 1 ? 's' : ''}` +
            (filtered ? ' <span class="text-warning">(filtered)</span>' : '');
    }

    // ── View patient modal ───────────────────────────────────
    /**
     * Opens the detail modal for a given patient ID.
     * Exposed on window so inline onclick in table rows can call it.
     */
    window.viewPatient = function (id) {
        const p = allPatients.find(function (x) { return x.id === id; });
        if (!p) return;

        setText('modalPatientId', p.id);
        setText('modalName', p.firstName + ' ' + p.lastName);
        setText('modalNin', p.nationalId || '—');
        setText('modalGender', p.gender || '—');
        setText('modalAge', p.age + ' years old');
        setText('modalDob', p.dob || '—');
        setText('modalMobile', p.mobile || '—');
        setText('modalEmail', p.email || '—');
        setText('modalBloodType', p.bloodType || '—');
        setText('modalGenotype', p.genotype || '—');
        setText('modalDept', p.department || '—');
        setText('modalMarital', p.maritalStatus || '—');
        setText('modalStreet', p.street || '—');
        setText('modalCity', p.city || '—');
        setText('modalState', p.state || '—');
        setText('modalCountry', p.country || '—');
        setText('modalZip', p.zip || '—');
        setText('modalRegistered', p.registeredDate || '—');
        setText('modalStatusText', p.status || '—');

        // Update status badge
        const badge = document.getElementById('modalStatusBadge');
        badge.className = p.status === 'Active' ? 'badge-active' : 'badge-inactive';
        badge.textContent = p.status;

        const modal = new bootstrap.Modal(document.getElementById('patientModal'));
        modal.show();
    };

    // ── CSV export ───────────────────────────────────────────
    /**
     * Exports the currently filtered patient list as a downloadable CSV.
     */
    function exportCSV() {
        if (filteredPatients.length === 0) {
            showToast('No patients to export. Clear your filters first.', 'danger');
            return;
        }

        const headers = [
            'ID', 'First Name', 'Last Name', 'Gender', 'Age', 'Date of Birth',
            'Mobile', 'Email', 'Blood Type', 'Genotype', 'Department',
            'Marital Status', 'Country', 'State', 'City', 'Street', 'ZIP',
            'Status', 'Registered Date'
        ];

        const rows = filteredPatients.map(function (p) {
            return [
                p.id, p.firstName, p.lastName, p.gender, p.age, p.dob,
                p.mobile, p.email, p.bloodType, p.genotype, p.department,
                p.maritalStatus, p.country, p.state, p.city, p.street, p.zip,
                p.status, p.registeredDate
            ];
        });

        const csvContent = [headers, ...rows]
            .map(function (row) {
                return row.map(function (cell) {
                    return '"' + String(cell === undefined || cell === null ? '' : cell)
                        .replace(/"/g, '""') + '"';
                }).join(',');
            })
            .join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const today = new Date().toISOString().split('T')[0];
        link.href = url;
        link.download = `trackit_patients_${today}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);

        showToast(
            `<i class="bi bi-file-earmark-check-fill me-2"></i>
       Exported <strong>${filteredPatients.length}</strong> patient records to CSV.`,
            'success'
        );
    }

    // ── Utility helpers ──────────────────────────────────────
    function setText(id, value) {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    }

    /** Basic XSS guard for user-generated content in innerHTML */
    function escHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    // ── Toast ────────────────────────────────────────────────
    function showToast(html, type) {
        const bgClass = type === 'success' ? 'bg-success' : 'bg-danger';
        const toast = document.createElement('div');
        toast.className = `toast align-items-center text-white ${bgClass} border-0`;
        toast.setAttribute('role', 'alert');
        toast.style.minWidth = '300px';
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
