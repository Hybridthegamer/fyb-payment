package com.trackit.dto;

import lombok.AllArgsConstructor;
import lombok.Data;

@Data
@AllArgsConstructor
public class LoginResponse {
    private String token;
    private UserInfo user;

    @Data
    @AllArgsConstructor
    public static class UserInfo {
        private Long id;
        private String email;
        private String name;
    }
}
