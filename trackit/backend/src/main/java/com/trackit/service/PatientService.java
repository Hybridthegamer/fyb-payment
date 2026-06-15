package com.trackit.service;

import com.trackit.entity.Patient;
import com.trackit.repository.PatientRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.util.List;

@Service
@RequiredArgsConstructor
public class PatientService {

    private final PatientRepository patientRepository;

    public List<Patient> search(String search, String department, String gender, String status) {
        String s = (search != null && search.isBlank()) ? null : search;
        String d = (department != null && department.isBlank()) ? null : department;
        String g = (gender != null && gender.isBlank()) ? null : gender;
        String st = (status != null && status.isBlank()) ? null : status;
        return patientRepository.search(s, d, g, st);
    }

    public Patient getById(String id) {
        return patientRepository.findById(id)
                .orElseThrow(() -> new RuntimeException("Patient not found: " + id));
    }

    public Patient save(Patient patient) {
        if (patient.getNationalId() != null && patientRepository.existsByNationalId(patient.getNationalId())) {
            throw new IllegalArgumentException("A patient with national ID " + patient.getNationalId() + " already exists");
        }
        if (patient.getId() == null || patient.getId().isBlank()) {
            patient.setId(generateId());
        }
        if (patient.getRegisteredDate() == null || patient.getRegisteredDate().isBlank()) {
            patient.setRegisteredDate(LocalDate.now().toString());
        }
        return patientRepository.save(patient);
    }

    public Patient update(String id, Patient updated) {
        Patient existing = getById(id);
        updated.setId(existing.getId());
        updated.setRegisteredDate(existing.getRegisteredDate());
        return patientRepository.save(updated);
    }

    public void delete(String id) {
        patientRepository.deleteById(id);
    }

    private static final java.util.regex.Pattern TRK_ID_PATTERN = java.util.regex.Pattern.compile("TRK-(\\d+)");

    private String generateId() {
        int maxNum = patientRepository.findAllIds().stream()
                .filter(id -> id != null)
                .map(TRK_ID_PATTERN::matcher)
                .filter(java.util.regex.Matcher::matches)
                .mapToInt(m -> Integer.parseInt(m.group(1)))
                .max()
                .orElse(0);
        // TRK-001 to TRK-015 are reserved for frontend demo data (DEFAULT_PATIENTS)
        if (maxNum < 15) {
            maxNum = 15;
        }
        return String.format("TRK-%03d", maxNum + 1);
    }
}
