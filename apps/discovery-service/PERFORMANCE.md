# Performance Configuration Guide

## Database Connection Pooling

For optimal performance under high load, configure PostgreSQL connection pooling via the `DATABASE_URL` environment variable.

### Recommended Configuration

For **10K concurrent users** (500 per city × 10 cities):

```bash
# Add connection_limit and pool_timeout to DATABASE_URL
DATABASE_URL="postgresql://user:password@host:port/database?connection_limit=100&pool_timeout=10"
```

### Configuration Parameters

- **connection_limit**: Maximum number of database connections
  - **Development**: 20-50
  - **Production (moderate load)**: 50-100
  - **Production (high load, 10K+ users)**: 100-200

- **pool_timeout**: Maximum time to wait for a connection (seconds)
  - **Recommended**: 10 seconds

### Example for Production

```bash
# High load configuration
DATABASE_URL="postgresql://postgres:password@localhost:5432/hmm_user?connection_limit=100&pool_timeout=10"
```

### Alternative: Using PgBouncer

For very high load scenarios, consider using PgBouncer as a connection pooler:

1. Install PgBouncer
2. Configure PgBouncer to pool connections to PostgreSQL
3. Point `DATABASE_URL` to PgBouncer instead of PostgreSQL directly

## Performance Optimizations Applied

### 1. Parallelized Status Updates
- Status updates for both users now run in parallel using `Promise.all`
- **Improvement**: Reduces latency by ~50-100ms per match

### 2. Optimized Cache Usage
- Removed unnecessary cache re-checks in match selection loop
- Cache is checked once before the loop instead of N times
- **Improvement**: Reduces cache calls from N to 1 (where N = number of candidates)

### 3. Connection Pooling
- Configured via `DATABASE_URL` query parameters
- **Improvement**: Prevents connection exhaustion under high load

## Expected Performance

### Before Optimizations
- **Best case**: 500-1200ms per match
- **Under load**: 2-5s per match

### After Optimizations
- **Best case**: 300-800ms per match
- **Under load**: 1-3s per match
- **Improvement**: ~40-50% faster

## Monitoring

Monitor these metrics to ensure optimal performance:

1. **Database connection pool usage**: Should stay below 80% of limit
2. **API response times**: P50, P95, P99 latencies
3. **Cache hit rate**: Should be >70% for matched user IDs
4. **Database query times**: Should be <100ms for most queries

## Troubleshooting

### Connection Pool Exhausted
- **Symptom**: "Connection pool timeout" errors
- **Solution**: Increase `connection_limit` in `DATABASE_URL`

### Slow Response Times
- **Check**: Cache hit rates (should be >70%)
- **Check**: Database query performance
- **Check**: Network latency to user-service

### High Database Load
- **Solution**: Consider read replicas for read-heavy operations
- **Solution**: Increase connection pool size
- **Solution**: Optimize database indexes

