# HMM Backend Cost Analysis (India / INR)

Cost breakdown for the hmmchat.live backend based on current tech stack. All figures are approximate and use **March 2025** pricing. Exchange rate: **1 USD ≈ ₹83**.

---

## 1. Tech Stack & Cost Drivers

| Service | Provider | Cost Type | Usage Driver |
|---------|----------|-----------|--------------|
| **Phone OTP** | Twilio | Per verification | Phone sign-ups |
| **Content Moderation** | Sightengine / Google / AWS | Per image | Profile photos, user photos |
| **Storage** | Cloudflare R2 | Per GB + ops | File uploads, profile pics |
| **Payments** | Razorpay | % of transaction | Coin purchases |
| **Database** | PostgreSQL | Fixed + storage | All services |
| **Cache** | Redis | Fixed | Rate limiting, sessions |
| **Streaming** | Mediasoup (self-hosted) | Compute | Video calls |
| **Ads** | Google Ad Manager | Revenue | Rewarded ads (income) |

---

## 2. Approximate Costs by User & Call Volume

### Scenario A: Small Scale (1,000 MAU)

| Component | Assumption | Monthly Cost (INR) | Notes |
|-----------|------------|--------------------|-------|
| **Phone OTP** | 200 sign-ups/mo | ₹2,000–4,000 | ~₹10–20/OTP (Twilio) |
| **Moderation** | 500 images/mo | ₹0–2,400 | Sightengine free tier (2K ops) or Starter $29 |
| **R2 Storage** | 5 GB | ₹0 | Free tier (10 GB) |
| **Razorpay** | ₹50,000 GMV | ₹1,180 | 2% + 18% GST |
| **PostgreSQL** | 1 node | ₹1,245 | DigitalOcean $15/mo |
| **Redis** | 1 GB | ₹830 | DigitalOcean $10/mo |
| **Compute** | 11 services | ₹4,150–8,300 | 2–4 droplets @ $25–50 |
| **Streaming** | Mediasoup | Included in compute | Self-hosted |
| **Total** | | **₹9,400–18,000/mo** | **~₹9–18 per MAU** |

### Scenario B: Medium Scale (10,000 MAU)

| Component | Assumption | Monthly Cost (INR) | Notes |
|-----------|------------|--------------------|-------|
| **Phone OTP** | 2,000 sign-ups | ₹20,000–40,000 | Twilio |
| **Moderation** | 5,000 images | ₹8,200 | Sightengine Growth $99 |
| **R2 Storage** | 50 GB | ₹62 | $0.015/GB × 40 GB over free |
| **Razorpay** | ₹5,00,000 GMV | ₹11,800 | 2% + GST |
| **PostgreSQL** | HA cluster | ₹8,300 | 2 nodes |
| **Redis** | 2 GB | ₹1,660 | |
| **Compute** | 11 services | ₹16,600–33,200 | 4–8 droplets |
| **Total** | | **₹58,000–1,00,000/mo** | **~₹6–10 per MAU** |

### Scenario C: Large Scale (1,00,000 MAU)

| Component | Assumption | Monthly Cost (INR) | Notes |
|-----------|------------|--------------------|-------|
| **Phone OTP** | 15,000 sign-ups | ₹1,50,000–3,00,000 | Twilio |
| **Moderation** | 50,000 images | ₹33,200 | Sightengine Pro $399 |
| **R2 Storage** | 500 GB | ₹520 | |
| **Razorpay** | ₹50,00,000 GMV | ₹1,18,000 | 2% + GST |
| **PostgreSQL** | HA + scaling | ₹24,900+ | |
| **Redis** | 4–8 GB | ₹3,300+ | |
| **Compute** | 11 services + streaming | ₹66,000–1,00,000 | Multiple nodes |
| **Total** | | **₹4,00,000–6,00,000/mo** | **~₹4–6 per MAU** |

---

## 3. Cost per Call / per Action

| Action | Cost (INR) | Provider |
|--------|------------|----------|
| **Phone OTP** | ₹10–20 | Twilio |
| **Image moderation** | ₹0.07–0.12 | AWS Rekognition / Google Vision |
| **Per 1,000 images** | ₹70–125 | Moderation APIs |
| **Per GB storage** | ₹1.25/mo | Cloudflare R2 |
| **Payment (2% + GST)** | 2.36% of txn | Razorpay |
| **Video call** | ~₹0 (compute) | Self-hosted Mediasoup |

---

## 4. Provider Comparison & Cost-Saving Options

### 4.1 Phone OTP (India)

| Provider | Per OTP (INR) | Notes |
|----------|---------------|------|
| **Twilio** | ₹10–20 | Current; USD billing, high for India |
| **MSG91** | ₹0.20–0.35 | ~5–10× cheaper |
| **Gupshup** | ₹0.18–0.30 | Local, INR-friendly |
| **StartMessaging** | ₹0.25 | India-focused |

**Recommendation:** Switch to MSG91 or Gupshup for India OTP. At 10,000 OTPs/mo: Twilio ~₹2,00,000 vs MSG91 ~₹3,500.

---

### 4.2 Content Moderation (Image)

| Provider | Pricing | Per 1K images (INR) | Free Tier |
|---------|---------|--------------------|-----------|
| **Sightengine** | $29–399/mo + $0.0015–0.002/op | ₹1.25–1.75 | 2,000 ops/mo |
| **AWS Rekognition** | $1.00/1K images | ₹83 | 1,000/mo |
| **Google Vision** | $1.50/1K images | ₹125 | 1,000/mo |

**Recommendation:**
- **Low volume (< 10K/mo):** Sightengine Starter ($29) or free tier.
- **High volume (> 50K/mo):** AWS Rekognition is cheapest (~₹83/1K).
- **Google Cloud users:** Vision API if already on GCP.

---

### 4.3 Storage (Cloudflare R2 vs Alternatives)

| Provider | Storage/GB/mo | Egress | Notes |
|----------|---------------|--------|-------|
| **Cloudflare R2** | ₹1.25/mo | Free | Current; best for high egress |
| **AWS S3** | ₹2.50/mo | ~₹8.30/GB | Higher egress cost |
| **DigitalOcean Spaces** | ₹2.50/mo | ~₹8.30/GB | Higher egress cost |
| **Backblaze B2** | ₹1.25/mo | Free | Similar to R2 |

**Recommendation:** Keep Cloudflare R2; free egress is ideal for profile photos and media.

---

### 4.4 Payment Gateway (India)

| Provider | Fee | Notes |
|---------|-----|-------|
| **Razorpay** | 2% + 18% GST | Current; good UX |
| **Paytm** | 1.99–2% | Similar |
| **CCAvenue** | 2% + setup/AMC | Higher fixed costs |
| **Instamojo** | 2% + 18% GST | Simpler for small merchants |

**Recommendation:** Razorpay is fine; enterprise pricing available above ₹5L/month GMV.

---

### 4.5 Database & Cache

| Provider | PostgreSQL | Redis | Notes |
|----------|------------|-------|------|
| **DigitalOcean** | ₹1,245/mo (1 GB) | ₹830/mo | Simple, predictable |
| **AWS RDS** | ₹1,030–8,000/mo | ElastiCache | More flexible |
| **Supabase** | Free tier | - | Good for early stage |
| **Neon** | Free tier | - | Serverless Postgres |

**Recommendation:** DigitalOcean for small/medium; Supabase/Neon for early stage.

---

## 5. India-Specific Considerations

| Factor | Impact |
|--------|--------|
| **GST** | 18% on most services (e.g. Razorpay fees) |
| **DLT compliance** | OTP providers need DLT registration; MSG91/Gupshup handle this |
| **UPI dominance** | Most payments via UPI; Razorpay supports well |
| **Data residency** | Consider India regions for DB/Redis if needed |
| **Currency** | INR billing avoids forex risk; prefer local providers |

---

## 6. Summary & Recommendations

### Cost per MAU (approximate)

| Scale | Cost/MAU (INR) | Main driver |
|-------|----------------|-------------|
| 1K MAU | ₹9–18 | Fixed infra + OTP |
| 10K MAU | ₹6–10 | OTP + moderation |
| 100K MAU | ₹4–6 | OTP + moderation + compute |

### Top 3 Cost-Saving Actions

1. **Switch OTP from Twilio to MSG91/Gupshup** – Save ~80–90% on OTP costs.
2. **Use AWS Rekognition for high volume moderation** – Cheaper than Sightengine at scale.
3. **Use Supabase/Neon free tier** – Reduce DB costs during early stage.

### Estimated Monthly Costs (INR)

| Scale | Current Stack | Optimized Stack |
|-------|---------------|-----------------|
| 1K MAU | ₹9,400–18,000 | ₹6,000–12,000 |
| 10K MAU | ₹58,000–1,00,000 | ₹35,000–50,000 |
| 100K MAU | ₹4,00,000–6,00,000 | ₹2,50,000–4,00,000 |

*Optimized = MSG91 OTP, AWS Rekognition at scale, Supabase/Neon where possible.*

---

*Last updated: March 2025. Prices and exchange rates may change.*
