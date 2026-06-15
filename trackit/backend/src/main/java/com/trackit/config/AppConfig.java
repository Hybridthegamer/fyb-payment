package com.trackit.config;

import com.trackit.entity.AppUser;
import com.trackit.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.boot.CommandLineRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.client.RestTemplate;

@Configuration
@RequiredArgsConstructor
public class AppConfig {

    @Bean
    public RestTemplate restTemplate() {
        return new RestTemplate();
    }

    @Bean
    public CommandLineRunner seedAdminUser(UserRepository userRepository, PasswordEncoder passwordEncoder) {
        return args -> {
            if (userRepository.findByEmail("admin@trackit.com").isEmpty()) {
                AppUser admin = new AppUser();
                admin.setEmail("admin@trackit.com");
                admin.setPassword(passwordEncoder.encode("Admin1234"));
                admin.setRole("ADMIN");
                admin.setFullName("System Admin");
                userRepository.save(admin);
                System.out.println("=================================================");
                System.out.println("  Admin user seeded: admin@trackit.com / Admin1234");
                System.out.println("=================================================");
            }
        };
    }
}
