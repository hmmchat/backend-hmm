# Complete API Reference (Frontend)

> Audited against controllers in `apps/*`. All paths use the **API gateway** prefix `/v1` unless noted.
> **Auth:** `Authorization: Bearer <accessToken>` on protected routes.
> **WebSocket:** `ws://<streaming-host>/streaming/ws` (gateway may proxy as `/v1/streaming/ws`).

For flows and examples see **[FRONTEND_INTEGRATION.md](./FRONTEND_INTEGRATION.md)**.

## homepage

| Method | Gateway path | Service path |
|--------|--------------|-------------|
| `GET` | `/v1/homepage` | `/homepage` |

## auth

| Method | Gateway path | Service path |
|--------|--------------|-------------|
| `POST` | `/v1/auth/apple` | `/auth/apple` |
| `POST` | `/v1/auth/facebook` | `/auth/facebook` |
| `POST` | `/v1/auth/google` | `/auth/google` |
| `POST` | `/v1/auth/logout` | `/auth/logout` |
| `DELETE` | `/v1/auth/me` | `/auth/me` |
| `POST` | `/v1/auth/me/deactivate` | `/auth/me/deactivate` |
| `POST` | `/v1/auth/me/reactivate` | `/auth/me/reactivate` |
| `GET` | `/v1/auth/me/referral-code` | `/auth/me/referral-code` |
| `GET` | `/v1/auth/me/referral-overview` | `/auth/me/referral-overview` |
| `POST` | `/v1/auth/me/referral-share-events` | `/auth/me/referral-share-events` |
| `GET` | `/v1/auth/me/referral-stats` | `/auth/me/referral-stats` |
| `GET` | `/v1/auth/me/referrals` | `/auth/me/referrals` |
| `GET` | `/v1/auth/me/status` | `/auth/me/status` |
| `POST` | `/v1/auth/phone/send-otp` | `/auth/phone/send-otp` |
| `POST` | `/v1/auth/phone/verify` | `/auth/phone/verify` |
| `POST` | `/v1/auth/refresh` | `/auth/refresh` |
| `GET` | `/v1/auth/users/:userId/account-status` | `/auth/users/:userId/account-status` |
| `POST` | `/v1/auth/users/:userId/mark-referral-claimed` | `/auth/users/:userId/mark-referral-claimed` |
| `GET` | `/v1/auth/users/:userId/referral-status` | `/auth/users/:userId/referral-status` |

## referrals

| Method | Gateway path | Service path |
|--------|--------------|-------------|
| `GET` | `/v1/referrals/me/overview` | `/referrals/me/overview` |
| `POST` | `/v1/referrals/me/share-events` | `/referrals/me/share-events` |

## r

| Method | Gateway path | Service path |
|--------|--------------|-------------|
| `GET` | `/v1/r/:referralCode` | `/r/:referralCode` |

## me

| Method | Gateway path | Service path |
|--------|--------------|-------------|
| `GET` | `/v1/me` | `/me` |
| `PATCH` | `/v1/me/brand-preferences` | `/me/brand-preferences` |
| `GET` | `/v1/me/export` | `/me/export` |
| `GET` | `/v1/me/horoscope` | `/me/horoscope` |
| `PATCH` | `/v1/me/intent` | `/me/intent` |
| `PATCH` | `/v1/me/interests` | `/me/interests` |
| `PATCH` | `/v1/me/location` | `/me/location` |
| `PATCH` | `/v1/me/moderator-face-card` | `/me/moderator-face-card` |
| `PATCH` | `/v1/me/music-preference` | `/me/music-preference` |
| `GET` | `/v1/me/photos` | `/me/photos` |
| `POST` | `/v1/me/photos` | `/me/photos` |
| `DELETE` | `/v1/me/photos/:photoId` | `/me/photos/:photoId` |
| `PATCH` | `/v1/me/preferred-city` | `/me/preferred-city` |
| `POST` | `/v1/me/presence` | `/me/presence` |
| `POST` | `/v1/me/presence/heartbeat` | `/me/presence/heartbeat` |
| `PATCH` | `/v1/me/profile` | `/me/profile` |
| `GET` | `/v1/me/profile-completion` | `/me/profile-completion` |
| `PATCH` | `/v1/me/status` | `/me/status` |
| `PATCH` | `/v1/me/values` | `/me/values` |
| `PATCH` | `/v1/me/zodiac` | `/me/zodiac` |

## users

| Method | Gateway path | Service path |
|--------|--------------|-------------|
| `GET` | `/v1/users/:userId` | `/users/:userId` |
| `GET` | `/v1/users/:userId/badges` | `/users/:userId/badges` |
| `GET` | `/v1/users/:userId/badges/active` | `/users/:userId/badges/active` |
| `POST` | `/v1/users/:userId/badges/active` | `/users/:userId/badges/active` |
| `GET` | `/v1/users/:userId/horoscope` | `/users/:userId/horoscope` |
| `GET` | `/v1/users/:userId/intent` | `/users/:userId/intent` |
| `GET` | `/v1/users/:userId/photos` | `/users/:userId/photos` |
| `POST` | `/v1/users/:userId/profile` | `/users/:userId/profile` |
| `POST` | `/v1/users/batch` | `/users/batch` |
| `POST` | `/v1/users/discovery` | `/users/discovery` |
| `GET` | `/v1/users/nearby` | `/users/nearby` |
| `POST` | `/v1/users/report` | `/users/report` |

## brands

| Method | Gateway path | Service path |
|--------|--------------|-------------|
| `GET` | `/v1/brands` | `/brands` |
| `POST` | `/v1/brands/:brandId/fetch-logo` | `/brands/:brandId/fetch-logo` |
| `GET` | `/v1/brands/search` | `/brands/search` |

## interests

| Method | Gateway path | Service path |
|--------|--------------|-------------|
| `GET` | `/v1/interests` | `/interests` |

## values

| Method | Gateway path | Service path |
|--------|--------------|-------------|
| `GET` | `/v1/values` | `/values` |

## music

| Method | Gateway path | Service path |
|--------|--------------|-------------|
| `POST` | `/v1/music/preferences` | `/music/preferences` |
| `GET` | `/v1/music/search` | `/music/search` |

## intent-prompts

| Method | Gateway path | Service path |
|--------|--------------|-------------|
| `GET` | `/v1/intent-prompts` | `/intent-prompts` |

## discovery-city-options

| Method | Gateway path | Service path |
|--------|--------------|-------------|
| `GET` | `/v1/discovery-city-options/active` | `/discovery-city-options/active` |

## moderator-face-card

| Method | Gateway path | Service path |
|--------|--------------|-------------|
| `GET` | `/v1/moderator-face-card/active` | `/moderator-face-card/active` |

## zodiacs

| Method | Gateway path | Service path |
|--------|--------------|-------------|
| `GET` | `/v1/zodiacs` | `/zodiacs` |

## discovery

| Method | Gateway path | Service path |
|--------|--------------|-------------|
| `GET` | `/v1/discovery/broadcasts/:roomId` | `/discovery/broadcasts/:roomId` |
| `POST` | `/v1/discovery/broadcasts/:roomId/comment` | `/discovery/broadcasts/:roomId/comment` |
| `GET` | `/v1/discovery/broadcasts/:roomId/comments` | `/discovery/broadcasts/:roomId/comments` |
| `POST` | `/v1/discovery/broadcasts/:roomId/follow/:userId` | `/discovery/broadcasts/:roomId/follow/:userId` |
| `GET` | `/v1/discovery/broadcasts/:roomId/follow/:userId/status` | `/discovery/broadcasts/:roomId/follow/:userId/status` |
| `POST` | `/v1/discovery/broadcasts/:roomId/gift` | `/discovery/broadcasts/:roomId/gift` |
| `POST` | `/v1/discovery/broadcasts/:roomId/share` | `/discovery/broadcasts/:roomId/share` |
| `POST` | `/v1/discovery/broadcasts/:roomId/unfollow/:userId` | `/discovery/broadcasts/:roomId/unfollow/:userId` |
| `GET` | `/v1/discovery/broadcasts/feed` | `/discovery/broadcasts/feed` |
| `GET` | `/v1/discovery/broadcasts/follows` | `/discovery/broadcasts/follows` |
| `POST` | `/v1/discovery/broadcasts/viewed` | `/discovery/broadcasts/viewed` |
| `GET` | `/v1/discovery/card` | `/discovery/card` |
| `GET` | `/v1/discovery/fallback-cities` | `/discovery/fallback-cities` |
| `GET` | `/v1/discovery/meet-rn/waiting-message` | `/discovery/meet-rn/waiting-message` |
| `GET` | `/v1/discovery/meet-rn/waiting-messages` | `/discovery/meet-rn/waiting-messages` |
| `GET` | `/v1/discovery/offline-cards/card` | `/discovery/offline-cards/card` |
| `POST` | `/v1/discovery/offline-cards/raincheck` | `/discovery/offline-cards/raincheck` |
| `POST` | `/v1/discovery/proceed` | `/discovery/proceed` |
| `POST` | `/v1/discovery/raincheck` | `/discovery/raincheck` |
| `POST` | `/v1/discovery/reset-session` | `/discovery/reset-session` |
| `POST` | `/v1/discovery/select-location` | `/discovery/select-location` |
| `POST` | `/v1/discovery/session/end` | `/discovery/session/end` |
| `POST` | `/v1/discovery/session/enter` | `/discovery/session/enter` |
| `POST` | `/v1/discovery/session/heartbeat` | `/discovery/session/heartbeat` |

## squad

| Method | Gateway path | Service path |
|--------|--------------|-------------|
| `POST` | `/v1/squad/invitations/:inviteId/accept` | `/squad/invitations/:inviteId/accept` |
| `POST` | `/v1/squad/invitations/:inviteId/reject` | `/squad/invitations/:inviteId/reject` |
| `POST` | `/v1/squad/invitations/cancel` | `/squad/invitations/cancel` |
| `GET` | `/v1/squad/invitations/pending` | `/squad/invitations/pending` |
| `GET` | `/v1/squad/invitations/pending/lobby` | `/squad/invitations/pending/lobby` |
| `GET` | `/v1/squad/invitations/received` | `/squad/invitations/received` |
| `POST` | `/v1/squad/invite` | `/squad/invite` |
| `POST` | `/v1/squad/invite-external` | `/squad/invite-external` |
| `GET` | `/v1/squad/join/:token` | `/squad/join/:token` |
| `GET` | `/v1/squad/lobby` | `/squad/lobby` |
| `POST` | `/v1/squad/lobby/enter-call` | `/squad/lobby/enter-call` |
| `GET` | `/v1/squad/lobby/membership` | `/squad/lobby/membership` |
| `POST` | `/v1/squad/lobby/remove-member` | `/squad/lobby/remove-member` |
| `GET` | `/v1/squad/me/quick-invite-suggestions` | `/squad/me/quick-invite-suggestions` |
| `POST` | `/v1/squad/me/quick-invite/record-call-peers` | `/squad/me/quick-invite/record-call-peers` |
| `POST` | `/v1/squad/toggle-solo` | `/squad/toggle-solo` |

## location

| Method | Gateway path | Service path |
|--------|--------------|-------------|
| `GET` | `/v1/location/cities` | `/location/cities` |
| `POST` | `/v1/location/locate-me` | `/location/locate-me` |
| `GET` | `/v1/location/preference` | `/location/preference` |
| `PATCH` | `/v1/location/preference` | `/location/preference` |
| `GET` | `/v1/location/search` | `/location/search` |

## gender-filters

| Method | Gateway path | Service path |
|--------|--------------|-------------|
| `GET` | `/v1/gender-filters` | `/gender-filters` |
| `POST` | `/v1/gender-filters/apply` | `/gender-filters/apply` |

## streaming

| Method | Gateway path | Service path |
|--------|--------------|-------------|
| `GET` | `/v1/streaming/broadcasts` | `/streaming/broadcasts` |
| `GET` | `/v1/streaming/favourites` | `/streaming/favourites` |
| `POST` | `/v1/streaming/favourites` | `/streaming/favourites` |
| `DELETE` | `/v1/streaming/favourites/:targetUserId` | `/streaming/favourites/:targetUserId` |
| `GET` | `/v1/streaming/favourites/broadcasting` | `/streaming/favourites/broadcasting` |
| `GET` | `/v1/streaming/gifs/search` | `/streaming/gifs/search` |
| `GET` | `/v1/streaming/history` | `/streaming/history` |
| `DELETE` | `/v1/streaming/history/:sessionId` | `/streaming/history/:sessionId` |
| `GET` | `/v1/streaming/history/:sessionId` | `/streaming/history/:sessionId` |
| `GET` | `/v1/streaming/history/:sessionId/timeline` | `/streaming/history/:sessionId/timeline` |
| `GET` | `/v1/streaming/loading-memes` | `/streaming/loading-memes` |
| `GET` | `/v1/streaming/loading-memes/random` | `/streaming/loading-memes/random` |
| `POST` | `/v1/streaming/offline-cards/gifts` | `/streaming/offline-cards/gifts` |
| `GET` | `/v1/streaming/pull-stranger/room/:userId` | `/streaming/pull-stranger/room/:userId` |
| `GET` | `/v1/streaming/pull-stranger/room/:userId/eligibility/:joiningUserId` | `/streaming/pull-stranger/room/:userId/eligibility/:joiningUserId` |
| `POST` | `/v1/streaming/rooms` | `/streaming/rooms` |
| `GET` | `/v1/streaming/rooms/:roomId` | `/streaming/rooms/:roomId` |
| `POST` | `/v1/streaming/rooms/:roomId/accept-from-waitlist` | `/streaming/rooms/:roomId/accept-from-waitlist` |
| `POST` | `/v1/streaming/rooms/:roomId/cancel-join-request` | `/streaming/rooms/:roomId/cancel-join-request` |
| `GET` | `/v1/streaming/rooms/:roomId/chat` | `/streaming/rooms/:roomId/chat` |
| `GET` | `/v1/streaming/rooms/:roomId/dares` | `/streaming/rooms/:roomId/dares` |
| `POST` | `/v1/streaming/rooms/:roomId/dares/:dareId/perform` | `/streaming/rooms/:roomId/dares/:dareId/perform` |
| `POST` | `/v1/streaming/rooms/:roomId/dares/assign` | `/streaming/rooms/:roomId/dares/assign` |
| `GET` | `/v1/streaming/rooms/:roomId/dares/custom` | `/streaming/rooms/:roomId/dares/custom` |
| `DELETE` | `/v1/streaming/rooms/:roomId/dares/custom/:dareId` | `/streaming/rooms/:roomId/dares/custom/:dareId` |
| `POST` | `/v1/streaming/rooms/:roomId/dares/custom/save` | `/streaming/rooms/:roomId/dares/custom/save` |
| `GET` | `/v1/streaming/rooms/:roomId/dares/gifts` | `/streaming/rooms/:roomId/dares/gifts` |
| `GET` | `/v1/streaming/rooms/:roomId/dares/history` | `/streaming/rooms/:roomId/dares/history` |
| `GET` | `/v1/streaming/rooms/:roomId/dares/random` | `/streaming/rooms/:roomId/dares/random` |
| `POST` | `/v1/streaming/rooms/:roomId/dares/select` | `/streaming/rooms/:roomId/dares/select` |
| `POST` | `/v1/streaming/rooms/:roomId/dares/send` | `/streaming/rooms/:roomId/dares/send` |
| `POST` | `/v1/streaming/rooms/:roomId/dares/view` | `/streaming/rooms/:roomId/dares/view` |
| `POST` | `/v1/streaming/rooms/:roomId/disable-pull-stranger` | `/streaming/rooms/:roomId/disable-pull-stranger` |
| `POST` | `/v1/streaming/rooms/:roomId/enable-pull-stranger` | `/streaming/rooms/:roomId/enable-pull-stranger` |
| `GET` | `/v1/streaming/rooms/:roomId/gifts` | `/streaming/rooms/:roomId/gifts` |
| `POST` | `/v1/streaming/rooms/:roomId/gifts` | `/streaming/rooms/:roomId/gifts` |
| `POST` | `/v1/streaming/rooms/:roomId/join-via-pull-stranger` | `/streaming/rooms/:roomId/join-via-pull-stranger` |
| `POST` | `/v1/streaming/rooms/:roomId/leave` | `/streaming/rooms/:roomId/leave` |
| `POST` | `/v1/streaming/rooms/:roomId/request-to-join` | `/streaming/rooms/:roomId/request-to-join` |
| `GET` | `/v1/streaming/rooms/:roomId/waitlist` | `/streaming/rooms/:roomId/waitlist` |
| `GET` | `/v1/streaming/users/:userId/room` | `/streaming/users/:userId/room` |
| `POST` | `/v1/streaming/users/report` | `/streaming/users/report` |

## wallet

| Method | Gateway path | Service path |
|--------|--------------|-------------|
| `GET` | `/v1/wallet/me/balance` | `/me/balance` |
| `POST` | `/v1/wallet/me/diamonds/purchase` | `/me/diamonds/purchase` |
| `POST` | `/v1/wallet/me/transactions/gender-filter` | `/me/transactions/gender-filter` |
| `GET` | `/v1/wallet/me/transactions/gifts` | `/me/transactions/gifts` |

## friends

| Method | Gateway path | Service path |
|--------|--------------|-------------|
| `GET` | `/v1/friends/me/conversations/:conversationId/messages` | `/me/conversations/:conversationId/messages` |
| `POST` | `/v1/friends/me/conversations/:conversationId/messages` | `/me/conversations/:conversationId/messages` |
| `GET` | `/v1/friends/me/conversations/inbox` | `/me/conversations/inbox` |
| `GET` | `/v1/friends/me/conversations/received-requests` | `/me/conversations/received-requests` |
| `GET` | `/v1/friends/me/conversations/sent-requests` | `/me/conversations/sent-requests` |
| `GET` | `/v1/friends/me/friends` | `/me/friends` |
| `POST` | `/v1/friends/me/friends/:friendId/block` | `/me/friends/:friendId/block` |
| `GET` | `/v1/friends/me/friends/:friendId/check` | `/me/friends/:friendId/check` |
| `GET` | `/v1/friends/me/friends/:friendId/messages` | `/me/friends/:friendId/messages` |
| `POST` | `/v1/friends/me/friends/:friendId/messages` | `/me/friends/:friendId/messages` |
| `POST` | `/v1/friends/me/friends/:friendId/messages/read` | `/me/friends/:friendId/messages/read` |
| `POST` | `/v1/friends/me/friends/:friendId/unfriend` | `/me/friends/:friendId/unfriend` |
| `POST` | `/v1/friends/me/friends/offline-cards/request` | `/me/friends/offline-cards/request` |
| `POST` | `/v1/friends/me/friends/requests/:requestId/accept` | `/me/friends/requests/:requestId/accept` |
| `GET` | `/v1/friends/me/friends/requests/:requestId/messages` | `/me/friends/requests/:requestId/messages` |
| `POST` | `/v1/friends/me/friends/requests/:requestId/messages` | `/me/friends/requests/:requestId/messages` |
| `POST` | `/v1/friends/me/friends/requests/:requestId/reject` | `/me/friends/requests/:requestId/reject` |
| `GET` | `/v1/friends/me/friends/requests/pending` | `/me/friends/requests/pending` |
| `GET` | `/v1/friends/me/friends/requests/sent` | `/me/friends/requests/sent` |
| `GET` | `/v1/friends/me/friends/wall` | `/me/friends/wall` |
| `POST` | `/v1/friends/me/friends/wall/share` | `/me/friends/wall/share` |
| `GET` | `/v1/friends/me/gifs/search` | `/me/gifs/search` |
| `GET` | `/v1/friends/me/gifs/trending` | `/me/gifs/trending` |
| `GET` | `/v1/friends/me/gifts/catalog` | `/me/gifts/catalog` |
| `GET` | `/v1/friends/me/giphy/trending` | `/me/giphy/trending` |
| `GET` | `/v1/friends/me/notifications/count` | `/me/notifications/count` |
| `POST` | `/v1/friends/me/notifications/mark-seen` | `/me/notifications/mark-seen` |

## files

| Method | Gateway path | Service path |
|--------|--------------|-------------|
| `DELETE` | `/v1/files/:fileId` | `/files/:fileId` |
| `GET` | `/v1/files/:fileId` | `/files/:fileId` |
| `GET` | `/v1/files/me/files` | `/me/files` |
| `POST` | `/v1/files/presigned-url` | `/files/presigned-url` |
| `GET` | `/v1/files/proxy/image` | `/files/proxy/image` |
| `POST` | `/v1/files/upload` | `/files/upload` |

## payments

| Method | Gateway path | Service path |
|--------|--------------|-------------|
| `POST` | `/v1/payments/purchase/initiate` | `/v1/payments/purchase/initiate` |
| `GET` | `/v1/payments/purchase/orders` | `/v1/payments/purchase/orders` |
| `GET` | `/v1/payments/purchase/packages` | `/v1/payments/purchase/packages` |
| `GET` | `/v1/payments/purchase/packages/:packageId` | `/v1/payments/purchase/packages/:packageId` |
| `POST` | `/v1/payments/purchase/verify` | `/v1/payments/purchase/verify` |
| `POST` | `/v1/payments/redemption/initiate` | `/v1/payments/redemption/initiate` |
| `POST` | `/v1/payments/redemption/preview` | `/v1/payments/redemption/preview` |
| `GET` | `/v1/payments/redemption/requests` | `/v1/payments/redemption/requests` |

## ads

| Method | Gateway path | Service path |
|--------|--------------|-------------|
| `GET` | `/v1/ads/ads/reward/history` | `/me/ads/reward/history` |
| `POST` | `/v1/ads/ads/reward/verify` | `/me/ads/reward/verify` |
| `GET` | `/v1/ads/reward/config` | `/ads/reward/config` |
| `POST` | `/v1/ads/reward/config` | `/ads/reward/config` |

## moderation

| Method | Gateway path | Service path |
|--------|--------------|-------------|
| `POST` | `/v1/moderation/check-image` | `/moderation/check-image` |

## kyc

| Method | Gateway path | Service path |
|--------|--------------|-------------|
| `POST` | `/v1/kyc/:id/kyc/revoke` | `/v1/kyc/:id/kyc/revoke` |
| `POST` | `/v1/kyc/feedback` | `/v1/kyc/feedback` |
| `POST` | `/v1/kyc/session/decision` | `/v1/kyc/session/decision` |
| `POST` | `/v1/kyc/session/start` | `/v1/kyc/session/start` |

---

**Total endpoints:** 209 (excludes `/test/*`, `/internal/*`, `/admin/*`, health, metrics, webhooks, dare-submission review).

**Legacy aliases:** `/v1/auth/me/referral-overview` mirrors `/v1/referrals/me/overview`; prefer `/v1/referrals/*` for new code.
