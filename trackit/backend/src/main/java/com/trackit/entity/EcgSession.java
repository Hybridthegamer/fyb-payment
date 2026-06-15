package com.trackit.entity;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

@Entity
@Table(name = "ecg_sessions")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class EcgSession {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String patientId;

    private String classification;

    private Double confidence;

    // Map of lead name -> signal samples, e.g. { "I": [0.1, 0.3, ...], "II": [...] }
    @Convert(converter = LeadDataConverter.class)
    @Column(columnDefinition = "TEXT")
    private Map<String, List<Double>> leadData;

    private LocalDateTime recordedAt;

    @PrePersist
    protected void onCreate() {
        if (recordedAt == null) {
            recordedAt = LocalDateTime.now();
        }
    }
}
