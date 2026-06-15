package com.trackit.entity;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

import java.util.Collections;
import java.util.List;
import java.util.Map;

@Converter
public class LeadDataConverter implements AttributeConverter<Map<String, List<Double>>, String> {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Override
    public String convertToDatabaseColumn(Map<String, List<Double>> attribute) {
        try {
            return MAPPER.writeValueAsString(attribute == null ? Collections.emptyMap() : attribute);
        } catch (Exception e) {
            throw new IllegalArgumentException("Unable to serialise lead data to JSON", e);
        }
    }

    @Override
    public Map<String, List<Double>> convertToEntityAttribute(String dbData) {
        if (dbData == null || dbData.isBlank()) {
            return Collections.emptyMap();
        }
        try {
            return MAPPER.readValue(dbData, new TypeReference<Map<String, List<Double>>>() {});
        } catch (Exception e) {
            throw new IllegalArgumentException("Unable to parse lead data JSON", e);
        }
    }
}
