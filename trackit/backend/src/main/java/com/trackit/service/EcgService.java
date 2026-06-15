package com.trackit.service;

import com.trackit.dto.EcgRequest;
import com.trackit.entity.EcgSession;
import com.trackit.repository.EcgSessionRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class EcgService {

    @Value("${app.ml.url}")
    private String mlUrl;

    private final RestTemplate restTemplate;
    private final EcgSessionRepository ecgSessionRepository;

    public Map<?, ?> analyse(EcgRequest req) {
        try {
            return restTemplate.postForObject(mlUrl + "/predict", req, Map.class);
        } catch (Exception e) {
            // ML service unavailable — return graceful degraded response
            return Map.of(
                "classification", "Unavailable",
                "confidence", 0.0,
                "error", "ML service offline"
            );
        }
    }

    public List<EcgSession> getLeads(String patientId) {
        return ecgSessionRepository.findByPatientIdOrderByRecordedAtDesc(patientId);
    }
}
