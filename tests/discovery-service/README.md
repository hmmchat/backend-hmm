# Discovery Service Tests

Test scripts and documentation for discovery-service.

## Test Scripts

### `test-discovery-service.sh`

Comprehensive test script for discovery-service metrics endpoint.

**Prerequisites:**
- User service running on port 3002
- Discovery service running on port 3004 (or will be started automatically)

**Usage:**
```bash
cd tests/discovery-service
./test-discovery-service.sh
```

**Tests Included:**
1. Get active meetings count from discovery-service
2. Verify discovery-service calls user-service correctly
3. Response format validation
4. Error handling (invalid endpoints)

**What it tests:**
- `/metrics/meetings` endpoint returns correct format
- Integration with user-service `/metrics/active-meetings` endpoint
- Response contains `liveMeetings` count
- Error handling for invalid endpoints

## Metrics Endpoint

### GET /metrics/meetings

Returns the count of users currently available or in calls (squad/broadcast).

**Response:**
```json
{
  "liveMeetings": 1250
}
```

**Note:** This endpoint calls user-service internally to get the count of users with statuses:
- `AVAILABLE`
- `IN_SQUAD`
- `IN_SQUAD_AVAILABLE`
- `IN_BROADCAST`
- `IN_BROADCAST_AVAILABLE`

## Integration with User Service

Discovery-service uses HTTP client to call user-service's `/metrics/active-meetings` endpoint. This follows microservices best practices where each service owns its data and exposes APIs.

