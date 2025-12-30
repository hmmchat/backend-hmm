# Deployment & Integration Guide

## Overview

This guide explains how to share the backend with the frontend team and set up the integration workflow.

---

## 🎯 Integration Options

You have **3 main options** for how the frontend team can access the backend:

### Option 1: Local Development (Recommended for Initial Integration)
**Best for:** Development, testing, quick iterations

**How it works:**
- Frontend team clones the backend repo
- They run the service locally on their machines
- Frontend connects to `http://localhost:3001`

**Pros:**
- ✅ Fast setup
- ✅ No deployment needed
- ✅ Easy debugging
- ✅ Free
- ✅ Frontend can test immediately

**Cons:**
- ❌ Each developer needs to set up backend locally
- ❌ Requires database/Redis setup on each machine
- ❌ Not suitable for production

**When to use:** Initial integration, development phase

---

### Option 2: Shared Development Server
**Best for:** Team collaboration, shared testing environment

**How it works:**
- You deploy backend to a development server (cloud/VM)
- Frontend team connects to shared dev URL (e.g., `https://dev-api.yourdomain.com`)
- Everyone uses the same backend instance

**Pros:**
- ✅ Single backend instance for all developers
- ✅ No local setup needed for frontend team
- ✅ Consistent testing environment
- ✅ Closer to production setup

**Cons:**
- ❌ Requires deployment setup
- ❌ Costs (server hosting)
- ❌ Need to manage environment

**When to use:** When you have multiple frontend developers, want shared testing

---

### Option 3: Production Deployment
**Best for:** Final integration, production-ready testing

**How it works:**
- Deploy backend to production environment
- Frontend connects to production URL
- Both teams test against production

**Pros:**
- ✅ Production-like environment
- ✅ Real-world testing
- ✅ Ready for launch

**Cons:**
- ❌ Should only use when backend is stable
- ❌ Costs
- ❌ Need proper monitoring

**When to use:** Final testing, pre-launch

---

## 🚀 Recommended Approach: Hybrid

**Phase 1: Initial Integration (Now)**
- Use **Option 1** (Local Development)
- Frontend team clones repo and runs locally
- Fast iteration and testing

**Phase 2: Shared Testing (Later)**
- Set up **Option 2** (Dev Server)
- Deploy to a development environment
- Frontend connects to shared dev URL

**Phase 3: Production (Launch)**
- Deploy to production
- Both teams use production URL

---

## 📋 Step-by-Step: Option 1 (Local Development)

### For You (Backend Developer):

1. **Push code to repository:**
   ```bash
   git add .
   git commit -m "Auth service ready for frontend integration"
   git push origin main
   ```

2. **Share repository access:**
   - Give frontend team access to the repo
   - Or share the repository URL

3. **Share documentation:**
   - Send them `FRONTEND_INTEGRATION.md`
   - Send them `FRONTEND_SETUP.md`
   - Point them to the documentation

### For Frontend Team:

**Follow the simple setup guide:** See `FRONTEND_SETUP.md`

This guide includes:
- Step-by-step instructions
- Prerequisites check
- Troubleshooting section
- Quick reference commands

**Quick summary:**
1. Clone repository
2. Install dependencies
3. Set up `.env` file (ask backend team for values)
4. Set up database
5. Start Redis
6. Start backend service
7. Verify it's running

**Full details:** See `FRONTEND_SETUP.md`

---

## 🌐 Step-by-Step: Option 2 (Dev Server Deployment)

### Prerequisites:
- Cloud provider account (AWS, GCP, Azure, Railway, Render, etc.)
- Domain name (optional, can use provided URL)

### Deployment Options:

#### A. Railway (Easiest - Recommended)
1. **Sign up:** https://railway.app
2. **Connect GitHub repo**
3. **Add environment variables** (from your `.env`)
4. **Deploy** - Railway auto-detects and deploys
5. **Get URL:** `https://your-app.railway.app`

#### B. Render
1. **Sign up:** https://render.com
2. **Create new Web Service**
3. **Connect GitHub repo**
4. **Configure:**
   - Build command: `cd apps/auth-service && npm install && npm run build`
   - Start command: `cd apps/auth-service && npm start`
5. **Add environment variables**
6. **Deploy**

#### C. AWS/GCP/Azure
- More complex setup
- Requires server configuration
- Better for production

### After Deployment:

1. **Get the deployment URL:**
   - Example: `https://auth-service-dev.railway.app`

2. **Update frontend documentation:**
   - Update `FRONTEND_INTEGRATION.md` with dev URL
   - Share new base URL with frontend team

3. **Frontend team uses:**
   - Base URL: `https://auth-service-dev.railway.app`
   - No local setup needed

---

## 🔧 What Frontend Team Needs

### Minimum Requirements:
1. **Base URL** - Where to connect
2. **API Documentation** - `FRONTEND_INTEGRATION.md`
3. **Test Credentials** (optional) - For testing

### If Using Local Development (Option 1):
- Backend repository access
- Instructions to set up locally (see above)

### If Using Dev Server (Option 2):
- Just the base URL
- No repository access needed
- No local setup needed

---

## 📝 Checklist: What to Share with Frontend Team

### Essential:
- [ ] `FRONTEND_INTEGRATION.md` - Complete API documentation
- [ ] `FRONTEND_SETUP.md` - Setup guide
- [ ] Base URLs (local or deployed)

### If Local Development:
- [ ] Repository access/URL
- [ ] Setup instructions (this guide)
- [ ] Environment variables template (without secrets)

### If Dev Server:
- [ ] Deployed URL
- [ ] Any special configuration notes

### Optional:
- [ ] `HOW_TO_GET_TOKENS.md` - For testing
- [ ] Test credentials (if you want to provide)

---

## 🎯 Recommended Next Steps

### Right Now (Initial Integration):

1. **Push your code:**
   ```bash
   git add .
   git commit -m "Auth service ready for frontend integration"
   git push
   ```

2. **Share with frontend team:**
   - Repository URL/access
   - `FRONTEND_INTEGRATION.md`
   - `FRONTEND_SETUP.md`
   - Tell them: "Backend is ready. You can either:
     - Clone and run locally (see FRONTEND_SETUP.md)
     - Or wait for dev server deployment"

3. **Let them choose:**
   - If they want to start immediately → Local setup
   - If they prefer shared environment → You deploy to dev server

### Later (When Ready):

1. **Set up dev server** (Railway/Render)
2. **Deploy backend**
3. **Share dev URL with frontend**
4. **Update documentation with dev URL**

---

## ❓ Common Questions

**Q: Do frontend developers need the full backend repo?**  
A: Only if using Option 1 (local development). For Option 2, they just need the API URL.

**Q: Should I deploy now or wait?**  
A: Start with Option 1 (local). Deploy to dev server when you want shared testing or have multiple frontend developers.

**Q: What if frontend team can't set up backend locally?**  
A: Use Option 2 - deploy to a dev server so they can connect without local setup.

**Q: Can I use both options?**  
A: Yes! Some developers can use local, others can use dev server. Just provide both URLs.

**Q: What about production?**  
A: Production deployment comes later when both frontend and backend are ready for launch.

---

## 🚀 Quick Start for Frontend Team

**If using local development:**
See `FRONTEND_SETUP.md` for complete setup instructions.

**Quick summary:**
```bash
# 1. Clone repo
git clone <repo-url>
cd backend-hmm

# 2. Follow FRONTEND_SETUP.md for detailed instructions
# Setup includes: auth-service, user-service, moderation-service
```

**If using dev server:**
- Just use the provided URL in your API calls
- No setup needed!

---

## 📞 Support

**For Backend Setup Issues:**
- Check `README.md` in auth-service
- Check `HOW_TO_TEST.md` for setup instructions

**For API Questions:**
- See `FRONTEND_INTEGRATION.md`
- Contact backend team

---

## Summary

**Simplest approach for now:**
1. Push code to repo
2. Share repo access + documentation with frontend
3. Frontend clones and runs locally (`http://localhost:3001`)
4. Later, deploy to dev server for shared testing

**No deployment needed immediately** - local development works perfectly for initial integration!

