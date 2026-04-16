# Frontend Integration Documentation

Complete documentation for frontend team to integrate with all backend services.

## 📚 Documentation

This folder contains the main setup/integration guides plus focused addenda:

### 1. **`FRONTEND_SETUP.md`** ⭐ - START HERE!

Complete setup guide for all backend services:
- Prerequisites and installation
- Environment configuration
- Database setup
- Service startup instructions
- Troubleshooting guide

### 2. **`FRONTEND_INTEGRATION.md`** — Complete API guide

Comprehensive API integration guide covering:
- Authentication (Google, Apple, Facebook, Phone OTP)
- User profile management
- Discovery & matching
- Streaming & video calls
- **History** (call history list, detail, hide, Hotline)
- **Favourites** (mark participants as favourite, favourite section — who is live)
- Friends & messaging
- Wallet & payments
- File uploads
- Ads & rewards
- Error handling
- Complete user flows

### 3. **`DISCOVERY_LOCATION_CARDS.md`** — LOCATION promos and `select-location`

Step-by-step frontend notes for **LOCATION** cards (cities + **Anywhere in India**), **`GET /v1/discovery/card`**, **`raincheck`**, **`select-location`** (`persistPreference`), **`proceed`**, and related **`/v1/discovery-city-options`**, **`/v1/me/preferred-city`**, and **`/v1/location/*`** APIs.

### 4. **`USER_STATUS_AND_APIS.md`**

User status and related APIs (see file for scope).

## 🚀 Quick Start

1. **Read `FRONTEND_SETUP.md`** - Set up all backend services locally
2. **Read `FRONTEND_INTEGRATION.md`** - Complete API reference with examples
3. Start building! 🎉

## 📁 File Structure

```
docs/for-frontend/
├── README.md (this file)
├── FRONTEND_SETUP.md ⭐ — Setup guide (START HERE)
├── FRONTEND_INTEGRATION.md — Complete API documentation
├── DISCOVERY_LOCATION_CARDS.md — LOCATION promos & discovery session APIs
└── USER_STATUS_AND_APIS.md — User status APIs
```

## 🆘 Need Help?

- **Setup issues?** → See `FRONTEND_SETUP.md` troubleshooting section
- **API questions?** → See `FRONTEND_INTEGRATION.md` (covers all services)
- **Specific use case?** → Check the relevant section in `FRONTEND_INTEGRATION.md`
- **Still stuck?** → Contact backend team for support

---

Start with **FRONTEND_SETUP** and **FRONTEND_INTEGRATION**; use the focused docs for discovery LOCATION flow and user status. 🚀

