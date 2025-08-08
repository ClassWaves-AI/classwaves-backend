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

# Apply memory settings
redis-cli config set maxmemory 536870912  # 512MB
redis-cli config set maxmemory-policy allkeys-lru

# Apply authentication
redis-cli config set requirepass classwaves-redis-pass

# Apply logging settings
redis-cli config set loglevel debug

# Apply persistence settings
redis-cli config set save "300 10"

# Apply slow log settings
redis-cli config set slowlog-log-slower-than 1000
redis-cli config set slowlog-max-len 256

# Apply keyspace notifications
redis-cli config set notify-keyspace-events Ex

# Apply timeout settings
redis-cli config set timeout 0
redis-cli config set tcp-keepalive 300

echo "ClassWaves Redis configuration applied successfully!"

# Show applied settings
echo "Current configuration:"
echo "Memory: $(redis-cli config get maxmemory | tail -1) bytes"
echo "Policy: $(redis-cli config get maxmemory-policy | tail -1)"
echo "Auth: $(redis-cli config get requirepass | tail -1)"