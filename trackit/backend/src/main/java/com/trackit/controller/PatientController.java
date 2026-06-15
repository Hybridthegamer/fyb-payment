package com.trackit.controller;

import com.trackit.entity.Patient;
import com.trackit.service.PatientService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/patients")
@RequiredArgsConstructor
public class PatientController {

    private final PatientService patientService;

    @GetMapping
    public ResponseEntity<List<Patient>> search(
            @RequestParam(required = false) String search,
            @RequestParam(required = false) String department,
            @RequestParam(required = false) String gender,
            @RequestParam(required = false) String status) {
        return ResponseEntity.ok(patientService.search(search, department, gender, status));
    }

    @GetMapping("/{id}")
    public ResponseEntity<Patient> getById(@PathVariable String id) {
        try {
            return ResponseEntity.ok(patientService.getById(id));
        } catch (RuntimeException e) {
            return ResponseEntity.notFound().build();
        }
    }

    @PostMapping
    public ResponseEntity<Patient> create(@Valid @RequestBody Patient patient) {
        return ResponseEntity.status(201).body(patientService.save(patient));
    }

    @PutMapping("/{id}")
    public ResponseEntity<Patient> update(@PathVariable String id, @Valid @RequestBody Patient patient) {
        try {
            return ResponseEntity.ok(patientService.update(id, patient));
        } catch (RuntimeException e) {
            return ResponseEntity.notFound().build();
        }
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Map<String, String>> delete(@PathVariable String id) {
        patientService.delete(id);
        return ResponseEntity.ok(Map.of("message", "Patient deleted"));
    }
}
