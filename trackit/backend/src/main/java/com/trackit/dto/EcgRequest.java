package com.trackit.dto;

import lombok.Data;
import java.util.List;

@Data
public class EcgRequest {
    private String patientId;
    private List<Double> signal;
}
