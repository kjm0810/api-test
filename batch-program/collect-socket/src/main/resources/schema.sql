CREATE TABLE IF NOT EXISTS donations (
    _id CHAR(36) NOT NULL,
    type VARCHAR(20) NOT NULL,
    platform VARCHAR(20) NOT NULL,
    streamer_id VARCHAR(100) NOT NULL,
    message TEXT NOT NULL,
    user_id VARCHAR(100),
    nickname VARCHAR(100),
    cnt INT NOT NULL,
    amount BIGINT NOT NULL,
    extras JSON NOT NULL,
    created_at DATETIME(3) NOT NULL,
    ttl DATETIME(3) NOT NULL,
    `__v` INT NOT NULL DEFAULT 0,
    PRIMARY KEY (_id),
    INDEX idx_donations_streamer_created (streamer_id, created_at),
    INDEX idx_donations_created (created_at),
    INDEX idx_donations_ttl (ttl)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
