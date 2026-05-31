package config

import (
	"fmt"
	"os"
	"strconv"
	"time"

	"github.com/joho/godotenv"
)

type Config struct {
	ListenAddr string
	WebOrigin  string

	MySQLHost string
	MySQLPort int
	MySQLUser string
	MySQLPass string
	MySQLDB   string

	CookieSecure bool
	CookieDomain string
	SessionTTL   time.Duration
}

func Load() (*Config, error) {
	// Best-effort .env load; missing file is fine.
	_ = godotenv.Load()

	port, err := strconv.Atoi(env("MYSQL_PORT", "3306"))
	if err != nil {
		return nil, fmt.Errorf("MYSQL_PORT: %w", err)
	}
	ttlHrs, err := strconv.Atoi(env("SESSION_TTL_HOURS", "720"))
	if err != nil {
		return nil, fmt.Errorf("SESSION_TTL_HOURS: %w", err)
	}

	user := os.Getenv("MYSQL_USER")
	if user == "" {
		return nil, fmt.Errorf("MYSQL_USER is required")
	}

	return &Config{
		ListenAddr:   env("LISTEN_ADDR", ":8080"),
		WebOrigin:    env("WEB_ORIGIN", "http://localhost:3000"),
		MySQLHost:    env("MYSQL_HOST", "127.0.0.1"),
		MySQLPort:    port,
		MySQLUser:    user,
		MySQLPass:    os.Getenv("MYSQL_PASSWORD"),
		MySQLDB:      env("MYSQL_DATABASE", "tcg"),
		CookieSecure: env("COOKIE_SECURE", "false") == "true",
		CookieDomain: os.Getenv("COOKIE_DOMAIN"),
		SessionTTL:   time.Duration(ttlHrs) * time.Hour,
	}, nil
}

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func (c *Config) MySQLDSN() string {
	return fmt.Sprintf(
		"%s:%s@tcp(%s:%d)/%s?parseTime=true&charset=utf8mb4&collation=utf8mb4_unicode_ci&multiStatements=true",
		c.MySQLUser, c.MySQLPass, c.MySQLHost, c.MySQLPort, c.MySQLDB,
	)
}
