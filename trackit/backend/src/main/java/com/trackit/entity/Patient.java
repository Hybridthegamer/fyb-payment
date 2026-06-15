package com.trackit.entity;

import jakarta.persistence.*;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.AllArgsConstructor;

import java.util.List;

@Entity
@Table(name = "patients")
@Data
@NoArgsConstructor
@AllArgsConstructor
public class Patient {

    @Id
    private String id; // TRK-001 format

    @NotBlank(message = "National ID is required")
    @Pattern(regexp = "\\d{11}", message = "National ID must be exactly 11 digits")
    @Column(nullable = false, length = 11)
    private String nationalId;

    @NotBlank(message = "First name is required")
    @Column(nullable = false)
    private String firstName;

    @NotBlank(message = "Last name is required")
    @Column(nullable = false)
    private String lastName;

    @NotBlank(message = "Gender is required")
    private String gender;
    private Integer age;
    private String dob;

    @NotBlank(message = "Mobile number is required")
    private String mobile;
    private String telephone;

    @NotBlank(message = "Email is required")
    @Email(message = "Email must be a valid address")
    private String email;
    private String bloodType;

    @Pattern(regexp = "AA|AS|SS|AC", message = "Genotype must be one of AA, AS, SS, AC")
    private String genotype;
    private String department;
    private String maritalStatus;
    private String doctor;
    private String country;
    private String state;
    private String city;
    private String street;
    private String zip;

    // Stored as JSON text in the database, exposed as a proper array over the API
    @Convert(converter = ContactListConverter.class)
    @Column(columnDefinition = "TEXT")
    private List<Contact> contacts;

    private String status = "Active";
    private String registeredDate;

    @Column(columnDefinition = "TEXT")
    private String photo; // base64 or null
}
