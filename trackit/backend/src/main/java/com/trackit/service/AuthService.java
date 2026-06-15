package com.trackit.service;

import com.trackit.dto.LoginRequest;
import com.trackit.dto.LoginResponse;
import com.trackit.entity.AppUser;
import com.trackit.repository.UserRepository;
import com.trackit.security.JwtUtil;
import lombok.RequiredArgsConstructor;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class AuthService {

    private final UserRepository userRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtUtil jwtUtil;

    public LoginResponse login(LoginRequest req) {
        AppUser user = userRepository.findByEmail(req.getEmail())
                .orElseThrow(() -> new BadCredentialsException("Invalid email or password"));

        if (!passwordEncoder.matches(req.getPassword(), user.getPassword())) {
            throw new BadCredentialsException("Invalid email or password");
        }

        String token = jwtUtil.generate(user.getEmail());
        LoginResponse.UserInfo userInfo = new LoginResponse.UserInfo(user.getId(), user.getEmail(), user.getFullName());
        return new LoginResponse(token, userInfo);
    }
}
