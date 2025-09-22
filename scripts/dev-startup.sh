#!/bin/bash
# ClassWaves Backend Development Startup Script
# Automatically starts Redis and applies configuration before starting the backend

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

load_env_file() {
    local env_file="$1"
    [ -f "$env_file" ] || return 0
    while IFS= read -r line || [ -n "$line" ]; do
        case "$line" in
            ''|\#*) continue ;;
        esac
        if [[ $line =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
            local key="${BASH_REMATCH[1]}"
            local value="${BASH_REMATCH[2]}"
            if [ -z "${!key+x}" ]; then
                export "$key=$value"
            fi
        fi
    done < "$env_file"
}

load_env_file "${BACKEND_DIR}/.env"

echo "🚀 Starting ClassWaves Backend Development Environment..."

# Function to check if Redis is running
check_redis() {
    if redis-cli ping > /dev/null 2>&1; then
        echo "✅ Redis is already running"
        return 0
    else
        echo "❌ Redis is not running"
        return 1
    fi
}

# Function to check if Docker is running
check_docker() {
    if ! command -v docker >/dev/null 2>&1; then
        echo "⚠️  Docker not installed; skipping Docker-based Redis startup"
        return 1
    fi
    if ! docker info > /dev/null 2>&1; then
        echo "⚠️  Docker not running; skipping Docker-based Redis startup"
        return 1
    fi
    echo "✅ Docker is running"
    return 0
}

# Function to check if Postgres (local dev) is healthy via Docker
check_postgres() {
    if ! check_docker; then
        return 1
    fi
    local status
    status=$(docker inspect -f '{{.State.Health.Status}}' classwaves-postgres 2>/dev/null || true)
    if [ "$status" = "healthy" ]; then
        echo "✅ Postgres is healthy"
        return 0
    fi
    echo "❌ Postgres is not healthy (status=${status:-absent})"
    return 1
}

# Function to start Postgres with Docker Compose
start_postgres() {
    echo "🐳 Starting Postgres with Docker Compose..."
    cd "$(dirname "$0")/../.." # repo root
    if command -v docker-compose >/dev/null 2>&1; then
      docker-compose up -d postgres || true
    else
      docker compose up -d postgres || true
    fi
    echo "⏳ Waiting for Postgres to be healthy..."
    local count=0
    while true; do
        local status
        status=$(docker inspect -f '{{.State.Health.Status}}' classwaves-postgres 2>/dev/null || true)
        if [ "$status" = "healthy" ]; then
            echo "✅ Postgres is ready!"
            break
        fi
        sleep 1
        count=$((count + 1))
        if [ $count -gt 60 ]; then
            echo "❌ Postgres failed to become healthy within 60 seconds"
            exit 1
        fi
        echo "   Waiting... (${count}s)"
    done
}

# Function to start Redis with Docker Compose
start_redis() {
    echo "🐳 Starting Redis with Docker Compose..."
    
    # Navigate to project root
    cd "$(dirname "$0")/../.."
    
    # Start Redis container
    if command -v docker-compose >/dev/null 2>&1; then
      docker-compose up -d redis || true
    else
      docker compose up -d redis || true
    fi
    
    echo "⏳ Waiting for Redis to be ready..."
    
    # Wait for Redis to be ready (max 30 seconds)
    local count=0
    while ! redis-cli ping > /dev/null 2>&1; do
        sleep 1
        count=$((count + 1))
        if [ $count -gt 30 ]; then
            echo "❌ Redis failed to start within 30 seconds"
            exit 1
        fi
        echo "   Waiting... (${count}s)"
    done
    
    echo "✅ Redis is ready!"
}

# Function to apply ClassWaves Redis configuration
apply_redis_config() {
    echo "⚙️  Applying ClassWaves Redis configuration..."
    
    # Navigate back to backend directory
    cd "$(dirname "$0")/.."
    
    # Apply Redis configuration
    ./scripts/apply-redis-config.sh
    
    echo "✅ Redis configuration applied!"
}

# Function to start the backend server
start_backend() {
    echo "🎯 Starting ClassWaves Backend Server..."
    
    # Navigate to backend directory
    cd "$(dirname "$0")/.."
    
    # Start the development server
    # Ensure local dev uses Postgres provider by default (may be overridden by user env)
    export DB_PROVIDER=${DB_PROVIDER:-postgres}
    export DATABASE_URL=${DATABASE_URL:-postgres://classwaves:classwaves@localhost:5433/classwaves_dev}
    export DB_SSL=${DB_SSL:-0}
    echo "🧭 DB Provider: $DB_PROVIDER"
    echo "🔌 DATABASE_URL: ${DATABASE_URL}"
    nodemon --exitcrash --signal SIGINT --exec ts-node src/server.ts
}

# Main execution flow
main() {
    echo "======================================"
    echo "   ClassWaves Development Startup"
    echo "======================================"
    echo
    
    # Check if Docker is running and try to ensure Redis if missing
    if check_docker; then
      # Ensure Postgres is up for local dev DB
      if ! check_postgres; then
          start_postgres
      fi
      if ! check_redis; then
          start_redis
          sleep 2  # Give Redis a moment to fully initialize
          apply_redis_config || true
      else
          echo "ℹ️  Redis configuration may need to be applied manually if not done yet"
          echo "   Run: ./scripts/apply-redis-config.sh"
      fi
    else
      echo "ℹ️  Proceeding without Docker; Redis may be unavailable. The server will degrade gracefully."
    fi
    
    echo
    echo "🎉 All services ready! Starting backend development server..."
    echo "------------------------------------------------------------"
    echo "📊 Monitor Redis: ./scripts/redis-monitor.sh"
    echo "🔧 Redis Config: ./scripts/apply-redis-config.sh"
    echo "📋 Redis Backup: ./scripts/redis-backup.sh"
    echo "------------------------------------------------------------"
    echo
    
    # Start the backend
    start_backend
}

# Handle script interruption
trap 'echo ""; echo "👋 Development server stopped"; exit 0' INT TERM

# Run main function
main
