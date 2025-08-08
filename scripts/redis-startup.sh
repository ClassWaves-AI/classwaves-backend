#!/bin/sh
# Redis startup script that ensures configuration is loaded

echo "Starting Redis with ClassWaves configuration..."

# Verify config file exists and is readable
if [ ! -r /etc/redis.conf ]; then
    echo "ERROR: Redis config file not found or not readable!"
    exit 1
fi

echo "Config file found, starting Redis with explicit configuration..."

# Start Redis with the configuration file
exec redis-server /etc/redis.conf