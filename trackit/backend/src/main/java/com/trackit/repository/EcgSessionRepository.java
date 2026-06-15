package com.trackit.repository;

import com.trackit.entity.EcgSession;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface EcgSessionRepository extends JpaRepository<EcgSession, Long> {
    List<EcgSession> findByPatientIdOrderByRecordedAtDesc(String patientId);
}
