#!/bin/bash
# File: scripts/redis-backup.sh
# ClassWaves Redis Backup Script

BACKUP_DIR="${BACKUP_DIR:-./backups/redis}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
REDIS_CLI="redis-cli -a ${REDIS_PASSWORD:-classwaves-redis-pass}"

# Create backup directory
mkdir -p $BACKUP_DIR

echo "Starting ClassWaves Redis backup..."
echo "Timestamp: $(date)"

# Create RDB backup
echo "Creating RDB backup..."
$REDIS_CLI bgsave
sleep 5  # Wait for background save to complete

# For Docker/development, we need to copy from the container
if [ "$REDIS_CONTAINER" = "true" ]; then
    docker cp classwaves-redis:/data/dump.rdb "$BACKUP_DIR/classwaves-redis-$TIMESTAMP.rdb"
    
    # Copy AOF file if it exists
    if docker exec classwaves-redis test -f /data/appendonly.aof; then
        docker cp classwaves-redis:/data/appendonly.aof "$BACKUP_DIR/classwaves-redis-$TIMESTAMP.aof"
    fi
else
    # For local Redis installation
    REDIS_DATA_DIR="${REDIS_DATA_DIR:-/var/lib/redis}"
    
    if [ -f "$REDIS_DATA_DIR/dump.rdb" ]; then
        cp "$REDIS_DATA_DIR/dump.rdb" "$BACKUP_DIR/classwaves-redis-$TIMESTAMP.rdb"
    fi
    
    if [ -f "$REDIS_DATA_DIR/appendonly.aof" ]; then
        cp "$REDIS_DATA_DIR/appendonly.aof" "$BACKUP_DIR/classwaves-redis-$TIMESTAMP.aof"
    fi
fi

# Compress backups older than 1 day
find $BACKUP_DIR -name "*.rdb" -o -name "*.aof" -mtime +1 -exec gzip {} \;

# Remove backups older than 30 days
find $BACKUP_DIR -name "*.gz" -mtime +30 -delete

echo "Backup completed: $BACKUP_DIR/classwaves-redis-$TIMESTAMP.*"
echo "Backup directory contents:"
ls -la $BACKUP_DIR/ | tail -5