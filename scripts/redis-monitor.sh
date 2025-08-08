#!/bin/bash
# File: scripts/redis-monitor.sh
# ClassWaves Redis Monitoring Script

REDIS_CLI="redis-cli -a ${REDIS_PASSWORD:-classwaves-redis-pass}"

echo "=== ClassWaves Redis Monitoring ==="
echo "Timestamp: $(date)"
echo

# Basic info
echo "--- Redis Info ---"
$REDIS_CLI info server | grep -E "(redis_version|uptime_in_seconds|connected_clients)"
echo

# Memory usage
echo "--- Memory Usage ---"
$REDIS_CLI info memory | grep -E "(used_memory_human|used_memory_peak_human|maxmemory_human)"
echo

# Keyspace info
echo "--- Keyspace ---"
$REDIS_CLI info keyspace
echo

# ClassWaves specific metrics
echo "--- ClassWaves Metrics ---"
echo "Active Sessions: $($REDIS_CLI eval "return #redis.call('keys', 'session:*')" 0)"
echo "Live Sessions: $($REDIS_CLI eval "return #redis.call('keys', 'active:*')" 0)"
echo "Transcription Buffers: $($REDIS_CLI eval "return #redis.call('keys', 'transcript:*')" 0)"
echo "AI Analysis Cache: $($REDIS_CLI eval "return #redis.call('keys', 'analysis:*')" 0)"
echo "Refresh Tokens: $($REDIS_CLI eval "return #redis.call('keys', 'refresh:*')" 0)"
echo

# Performance metrics
echo "--- Performance ---"
$REDIS_CLI info stats | grep -E "(instantaneous_ops_per_sec|total_commands_processed)"
$REDIS_CLI latency latest
echo

# Slow log
echo "--- Recent Slow Queries ---"
$REDIS_CLI slowlog get 5