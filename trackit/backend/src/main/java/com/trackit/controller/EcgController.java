package com.trackit.controller;

import com.trackit.dto.EcgRequest;
import com.trackit.entity.EcgSession;
import com.trackit.service.EcgService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/ecg")
@RequiredArgsConstructor
public class EcgController {

    private final EcgService ecgService;

    @PostMapping("/analyse")
    public ResponseEntity<Map<?, ?>> analyse(@RequestBody EcgRequest req) {
        return ResponseEntity.ok(ecgService.analyse(req));
    }

    @GetMapping("/leads/{id}")
    public ResponseEntity<List<EcgSession>> leads(@PathVariable String id) {
        return ResponseEntity.ok(ecgService.getLeads(id));
    }
}
