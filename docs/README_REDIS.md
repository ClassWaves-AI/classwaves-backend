# Redis Setup for ClassWaves Backend

## Starting Redis with Docker

1. **Start Redis:**
   ```bash
   docker-compose up -d redis
   ```

2. **Verify Redis is running:**
   ```bash
   docker ps | grep classwaves-redis
   ```

3. **Test Redis connection:**
   ```bash
   docker exec -it classwaves-redis redis-cli -a classwaves-redis-pass ping
   ```

## Environment Configuration

Add these to your `.env` file:
```env
REDIS_URL=redis://localhost:6379
REDIS_PASSWORD=classwaves-redis-pass
```

## Features Using Redis

1. **Session Storage** - All user sessions are stored in Redis
2. **Distributed Rate Limiting** - Rate limits are shared across all server instances
3. **Refresh Token Storage** - Secure storage of refresh tokens
4. **Caching Layer** - Ready for future caching implementations

## Troubleshooting

If Redis connection fails:
1. Check if Docker is running
2. Verify port 6379 is not in use: `lsof -i :6379`
3. Check Redis logs: `docker logs classwaves-redis`
4. Ensure environment variables are set correctly

## Production Considerations

For production, consider:
- Using Redis Sentinel or Redis Cluster for high availability
- Configuring persistent storage appropriately
- Setting up Redis backups
- Using TLS for Redis connections
- Monitoring Redis memory usage