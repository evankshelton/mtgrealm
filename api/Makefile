# Convenience targets. `migrate` CLI is expected on PATH; install with:
#   brew install golang-migrate
# or
#   go install -tags 'mysql' github.com/golang-migrate/migrate/v4/cmd/migrate@latest

include .env
export

DSN := mysql://$(MYSQL_USER):$(MYSQL_PASSWORD)@tcp($(MYSQL_HOST):$(MYSQL_PORT))/$(MYSQL_DATABASE)?multiStatements=true

.PHONY: run build vet test migrate-up migrate-down migrate-status migrate-force-baseline

run:
	go run ./cmd/server

build:
	go build -o bin/server ./cmd/server

vet:
	go vet ./...

test:
	go test ./...

migrate-up:
	migrate -path ./migrations -database "$(DSN)" up

migrate-down:
	migrate -path ./migrations -database "$(DSN)" down 1

migrate-status:
	migrate -path ./migrations -database "$(DSN)" version

# One-time: tell migrate that the four existing tables (cards, sets,
# canonical_cards, load_meta) are already in place so it skips migration 1.
# Run this on a database that already has data from load_scryfall.py.
migrate-force-baseline:
	migrate -path ./migrations -database "$(DSN)" force 1
