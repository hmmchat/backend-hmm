# Documentation

This folder contains project documentation organized by audience.

## 📁 Structure

```
docs/
├── README.md (this file)
├── COINS_AND_DIAMONDS.md  # Coins vs diamonds, wallet API, migrations
└── for-frontend/          # Documentation for frontend team
    ├── README.md
    ├── FRONTEND_SETUP.md
    └── FRONTEND_INTEGRATION.md
```

## 🎯 For Frontend Team

**All frontend integration documentation is in:** `for-frontend/`

See `for-frontend/README.md` for getting started.

## 📚 Backend Documentation

- **Coins and diamonds**: [COINS_AND_DIAMONDS.md](COINS_AND_DIAMONDS.md) — Decoupled coins/diamonds, wallet API, migrations, DB setup.
- **User reporting (product overview)**: [USER_REPORTING_OVERVIEW.md](USER_REPORTING_OVERVIEW.md) — How report scores, weights, discovery tiers, and auto-moderation work; weighted vs absolute reporting.

Backend-specific documentation (testing, development guides) remains in:
- `apps/auth-service/` - Service-specific docs

This keeps service documentation close to the code.

