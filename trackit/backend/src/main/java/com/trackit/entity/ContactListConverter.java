package com.trackit.entity;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.AttributeConverter;
import jakarta.persistence.Converter;

import java.util.Collections;
import java.util.List;

@Converter
public class ContactListConverter implements AttributeConverter<List<Contact>, String> {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Override
    public String convertToDatabaseColumn(List<Contact> attribute) {
        try {
            return MAPPER.writeValueAsString(attribute == null ? Collections.emptyList() : attribute);
        } catch (Exception e) {
            throw new IllegalArgumentException("Unable to serialise contacts to JSON", e);
        }
    }

    @Override
    public List<Contact> convertToEntityAttribute(String dbData) {
        if (dbData == null || dbData.isBlank()) {
            return Collections.emptyList();
        }
        try {
            return MAPPER.readValue(dbData, new TypeReference<List<Contact>>() {});
        } catch (Exception e) {
            throw new IllegalArgumentException("Unable to parse contacts JSON", e);
        }
    }
}
