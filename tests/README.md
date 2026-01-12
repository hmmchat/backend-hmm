# E2E Test Suite

Automated end-to-end test suite for all backend services. These tests are designed to run with a single click, handling setup, execution, and cleanup automatically.

## Features

- ✅ **Zero Configuration**: Tests handle service startup, database setup, and cleanup automatically
- ✅ **No Authentication Required**: Uses test endpoints that bypass authentication for local testing
- ✅ **Dynamic Seed Data**: Creates test users and data on-the-fly
- ✅ **Comprehensive Coverage**: Tests important scenarios, edge cases, and error handling
- ✅ **Automatic Cleanup**: Cleans up test data after execution

## Prerequisites

1. **Node.js v22+** installed
2. **PostgreSQL** running (services will create databases if needed)
3. **Redis** (optional, for services that use it)
4. **Dependencies installed**: Run `npm ci` in the root directory

## Quick Start

### Run All Tests

```bash
./tests/run-all-tests.sh
```

### Run Tests for a Specific Service

```bash
./tests/run-all-tests.sh user
./tests/run-all-tests.sh discovery
./tests/run-all-tests.sh auth
```

### Run Individual Service Tests

```bash
./tests/user-service/test-user-service.sh
./tests/discovery-service/test-discovery-service.sh
./tests/auth-service/test-auth-service.sh
```

## Available Test Scripts

| Service | Script | Description |
|---------|--------|-------------|
| **Auth Service** | `auth-service/test-auth-service.sh` | Authentication flows, OTP, account management |
| **User Service** | `user-service/test-user-service.sh` | Profile management, photos, preferences |
| **Discovery Service** | `discovery-service/test-discovery-service.sh` | Discovery cards, rainchecks, location selection |
| **Moderation Service** | `moderation-service/test-moderation-service.sh` | Content moderation, NSFW detection |
| **Wallet Service** | `wallet-service/test-wallet-service.sh` | Wallet operations, transactions |
| **Streaming Service** | `streaming-service/test-streaming-service.sh` | Room creation, video calls, dares, gifts |
| **Payment Service** | `payment-service/test-payment-service.sh` | Payment flows, coin calculations |
| **Files Service** | `files-service/test-files-service.sh` | File upload, retrieval, presigned URLs |
| **Friend Service** | `friend-service/test-friend-service.sh` | Friend requests, messaging |

## Test Structure

Each test script follows this structure:

1. **Setup Phase**
   - Checks infrastructure (PostgreSQL, Redis)
   - Sets up database schema
   - Starts the service if not running
   - Creates test users and seed data

2. **Test Execution**
   - Runs test cases covering:
     - Happy path scenarios
     - Edge cases
     - Error handling
     - Validation

3. **Cleanup Phase**
   - Removes test data
   - Stops services (if started by test)

## Test Utilities

The `test-utils.sh` file provides common functions:

- `check_service_health()` - Check if a service is running
- `start_service()` - Start a service if not running
- `setup_database()` - Set up database schema and seed data
- `create_test_user()` - Create test users directly in database
- `http_request()` - Make HTTP requests and validate responses
- `cleanup_test_data()` - Clean up test data

## Test Endpoints

Tests use special test endpoints that bypass authentication:

- **User Service**: `/users/test/:userId/*` endpoints
- **Discovery Service**: `/discovery/test/*` endpoints
- **Payment Service**: `/v1/payments/test/*` endpoints
- **Files Service**: `/test/files/*` endpoints
- **Friend Service**: `/internal/*` endpoints

## Environment Variables

Tests will work with default configurations. For production-like testing, ensure `.env` files are configured in each service directory.

## Troubleshooting

### Service Won't Start

- Check if port is already in use: `lsof -i :3001` (replace with service port)
- Check service logs in `/tmp/{service-name}.log`
- Ensure database is accessible

### Database Issues

- Ensure PostgreSQL is running: `pg_isready`
- Check database connection strings in service `.env` files
- Services will create databases automatically if they have permissions

### Test Failures

- Check service logs: `tail -f /tmp/{service-name}.log`
- Verify service is healthy: `curl http://localhost:{port}/health`
- Check test output for specific error messages

## Continuous Integration

These tests can be integrated into CI/CD pipelines:

```yaml
# Example GitHub Actions
- name: Run E2E Tests
  run: |
    ./tests/run-all-tests.sh
```

## Contributing

When adding new tests:

1. Use test endpoints that bypass authentication
2. Create test users with IDs starting with `test-`
3. Clean up all test data in cleanup function
4. Follow the existing test structure
5. Include edge cases and error scenarios

## Notes

- Tests are designed for local development and may need adjustments for CI environments
- Some tests may skip if external services (Twilio, OAuth providers) are not configured
- Test data is automatically cleaned up, but manual cleanup may be needed if tests are interrupted
