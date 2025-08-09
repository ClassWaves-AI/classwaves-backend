#!/bin/bash
# ClassWaves Backend Development Startup Script
# Automatically starts Redis and applies configuration before starting the backend

set -euo pipefail

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