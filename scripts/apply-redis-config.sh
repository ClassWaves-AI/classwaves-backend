#!/bin/bash
# Script to apply ClassWaves Redis configuration manually
# This works around Docker configuration loading issues

echo "Applying ClassWaves Redis configuration..."

# Wait for Redis to be ready
until redis-cli ping > /dev/null 2>&1; do
  echo "Waiting for Redis to be ready..."
  sleep 1
done

echo "Redis is ready, applying configuration..."

# Desired password
PASS=${REDIS_PASSWORD:-classwaves-redis-pass}

# Detect if a password is already required
REQUIREPASS=$(redis-cli config get requirepass | tail -1)

run_redis() {
  # Helper: run redis-cli with or without auth depending on whether requirepass is set
  if [ -n "$REQUIREPASS" ]; then
    redis-cli -a "$PASS" "$@"
  else
    redis-cli "$@"
  fi
}

# Apply memory settings
run_redis config set maxmemory 536870912  # 512MB
# For rate limiter correctness, avoid silent key evictions
run_redis config set maxmemory-policy noeviction

# Apply authentication
# Set password only if not already set
if [ -z "$REQUIREPASS" ]; then
  redis-cli config set requirepass "$PASS"
  # After setting the password, update state and use auth for subsequent commands
  REQUIREPASS="$PASS"
fi

# Apply logging settings
run_redis config set loglevel debug

# Apply persistence settings
run_redis config set save "300 10"

# Apply slow log settings
run_redis config set slowlog-log-slower-than 1000
run_redis config set slowlog-max-len 256

# Apply keyspace notifications
run_redis config set notify-keyspace-events Ex

# Apply timeout settings
run_redis config set timeout 0
run_redis config set tcp-keepalive 300

echo "ClassWaves Redis configuration applied successfully!"

# Show applied settings
echo "Current configuration:"
echo "Memory: $(run_redis config get maxmemory | tail -1) bytes"
echo "Policy: $(run_redis config get maxmemory-policy | tail -1)"
echo "Auth: $(run_redis config get requirepass | tail -1)"
