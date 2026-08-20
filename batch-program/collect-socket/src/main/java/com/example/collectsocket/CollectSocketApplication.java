package com.example.collectsocket;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class CollectSocketApplication {

	public static void main(String[] args) {
		SpringApplication.run(CollectSocketApplication.class, args);
	}

}
