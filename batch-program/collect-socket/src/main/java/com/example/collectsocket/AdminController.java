package com.example.collectsocket;

import java.util.List;

import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

@RestController
@RequestMapping("/api/admin")
public class AdminController {
    private final SoopService soop;
    public AdminController(SoopService soop) { this.soop = soop; }
    @GetMapping("/status") public SoopService.Status status() { return soop.status(); }
    @GetMapping("/broadcasts") public List<SoopService.Broadcast> broadcasts() { return soop.broadcasts(); }
    @GetMapping("/chzzk/broadcasts") public List<SoopService.ChzzkBroadcast> chzzkBroadcasts() {
        return soop.chzzkBroadcasts();
    }
    @GetMapping("/donations") public List<SoopService.Donation> donations() { return soop.donations(); }
    @GetMapping("/connection-failures") public List<SoopService.ConnectionFailure> connectionFailures() {
        return soop.connectionFailures();
    }
    @GetMapping(path = "/events", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter events() { return soop.subscribe(); }
}
