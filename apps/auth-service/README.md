# auth-service

Independent service/module of the product.

Conventions:
- REST under /v1
- Swagger: /docs and /docs-json
- Health: /health
- Use schema-per-service if DB is needed.

## 📚 Documentation

### For Frontend Team
**All frontend integration docs are in:** `../../docs/for-frontend/`
- Start with `FRONTEND_SETUP.md` for local setup
- See `FRONTEND_INTEGRATION.md` for API documentation

### For Backend Developers
- `../../tests/auth-service/E2E_TESTING.md` - End-to-end testing
- `../../tests/auth-service/HOW_TO_GET_TOKENS.md` - Getting test tokens
- `../../tests/auth-service/TEST_FULL_FLOW.md` - Full flow testing guide
- Test scripts: `../../tests/auth-service/test-*.sh`
