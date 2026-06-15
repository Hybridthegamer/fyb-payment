package com.trackit.repository;

import com.trackit.entity.Patient;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

public interface PatientRepository extends JpaRepository<Patient, String> {

    @Query("SELECT p FROM Patient p WHERE " +
           "(:search IS NULL OR LOWER(p.firstName) LIKE LOWER(CONCAT('%', :search, '%')) " +
           "OR LOWER(p.lastName) LIKE LOWER(CONCAT('%', :search, '%')) " +
           "OR LOWER(p.id) LIKE LOWER(CONCAT('%', :search, '%')) " +
           "OR LOWER(p.nationalId) LIKE LOWER(CONCAT('%', :search, '%')) " +
           "OR LOWER(p.department) LIKE LOWER(CONCAT('%', :search, '%'))) " +
           "AND (:department IS NULL OR p.department = :department) " +
           "AND (:gender IS NULL OR p.gender = :gender) " +
           "AND (:status IS NULL OR p.status = :status)")
    List<Patient> search(
        @Param("search") String search,
        @Param("department") String department,
        @Param("gender") String gender,
        @Param("status") String status
    );

    boolean existsByNationalId(String nationalId);

    @Query("SELECT p.id FROM Patient p")
    List<String> findAllIds();
}
