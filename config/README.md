# ClassWaves Configuration Files

## Redis Configuration

This directory contains Redis configuration files for different environments:

### `redis-dev.conf`
- **Purpose**: Development environment Redis configuration
- **Features**: 
  - Debug logging enabled
  - Relaxed security for easier development
  - 512MB memory limit
  - Development-friendly command renaming (commands available but prefixed)
- **Usage**: Automatically used by `docker-compose up redis`

### `redis-prod.conf`
- **Purpose**: Production environment Redis configuration  
- **Features**:
  - Production security settings
  - Dangerous commands completely disabled
  - 2GB memory limit
  - Optimized persistence settings
  - Performance tuning
- **Usage**: Deploy to production Redis servers

### Quick Start

```bash
# Development (from project root)
docker-compose up -d redis

# Check Redis is running
redis-cli -a classwaves-redis-pass ping
# Should return: PONG

# Monitor Redis (development)
./scripts/redis-monitor.sh

# Backup Redis data
./scripts/redis-backup.sh
```

### Environment Variables

The following environment variables can be used to customize Redis:

- `REDIS_PASSWORD`: Redis authentication password (default: classwaves-redis-pass)
- `REDIS_HOST`: Redis server host (default: localhost)
- `REDIS_PORT`: Redis server port (default: 6379)
- `REDIS_DB`: Redis database number (default: 0)

### Documentation

For comprehensive Redis configuration documentation, see:
`../Re_build/08_INFRASTRUCTURE/02_Redis_Configuration.md`