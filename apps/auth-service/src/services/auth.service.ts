import { Injectable, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";

import { ProviderGoogle } from "./providers/google.provider.js";
import { ProviderApple } from "./providers/apple.provider.js";
import { ProviderFacebook } from "./providers/facebook.provider.js";
import { ProviderPhone } from "./providers/phone.provider.js";

import {
  signAccessToken,
  signRefreshToken,
  verifyToken,
  AccessPayload
} from "@hmm/common";

import { JWK } from "jose";
import * as argon2 from "argon2";

@Injectable()
export class AuthService implements OnModuleInit {
  private verifyAccess!: (token: string) => Promise<AccessPayload>;
  private publicJwk!: JWK;
  private privateKey!: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly google: ProviderGoogle,
    private readonly apple: ProviderApple,
    private readonly facebook: ProviderFacebook,
    private readonly phone: ProviderPhone
  ) {}

  /* ---------- Init ---------- */

  async onModuleInit() {
    // Load JWT keys from environment variables
    const jwkStr = process.env.JWT_PUBLIC_JWK;
    const keyStr = process.env.JWT_PRIVATE_KEY;

    if (!jwkStr || jwkStr === "undefined") {
      throw new Error("JWT_PUBLIC_JWK environment variable is not set or is invalid");
    }
    if (!keyStr || keyStr === "undefined") {
      throw new Error("JWT_PRIVATE_KEY environment variable is not set or is invalid");
    }

    // Remove surrounding quotes if present
    const cleanedJwk = jwkStr.trim().replace(/^['"]|['"]$/g, "");
    this.publicJwk = JSON.parse(cleanedJwk) as JWK;
    this.privateKey = keyStr.trim().replace(/^['"]|['"]$/g, "");

    this.verifyAccess = await verifyToken(this.publicJwk);
  }

  /* ---------- Auth flows ---------- */

  async loginWithGoogle(idToken: string, termsVer: string) {
    const g = await this.google.verify(idToken);
    return this.signInOrUp(
      {
        email: g.email,
        name: g.name,
        photoUrl: g.picture,
        googleSub: g.sub
      },
      termsVer
    );
  }

  async loginWithApple(identityToken: string, termsVer: string) {
    const a = await this.apple.verify(identityToken);
    return this.signInOrUp(
      {
        email: a.email,
        name: a.name,
        appleSub: a.sub
      },
      termsVer
    );
  }

  async loginWithFacebook(accessToken: string, termsVer: string) {
    const f = await this.facebook.verify(accessToken);
    return this.signInOrUp(
      {
        email: f.email,
        name: f.name,
        photoUrl: f.picture,
        facebookId: f.id
      },
      termsVer
    );
  }

  async sendPhoneOtp(phone: string) {
    await this.phone.send(phone);
    return { ok: true };
  }

  async verifyPhoneOtp(phone: string, code: string, termsVer: string) {
    await this.phone.verify(phone, code);
    return this.signInOrUp({ phone }, termsVer);
  }

  /* ---------- User ---------- */

  async getMe(accessToken: string) {
    const payload = await this.verifyAccess(accessToken);

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { preferences: true }
    });

    if (!user) throw new Error("User not found");
    return { user };
  }

  async updatePreferences(
    accessToken: string,
    prefs: {
      videoEnabled: boolean;
      meetMode: "both" | "location";
      location?: { lat: number; lng: number };
    }
  ) {
    const payload = await this.verifyAccess(accessToken);

    const preferences = await this.prisma.preference.upsert({
      where: { userId: payload.sub },
      create: {
        userId: payload.sub,
        videoEnabled: prefs.videoEnabled,
        meetMode: prefs.meetMode,
        latitude: prefs.location?.lat,
        longitude: prefs.location?.lng
      },
      update: {
        videoEnabled: prefs.videoEnabled,
        meetMode: prefs.meetMode,
        latitude: prefs.location?.lat,
        longitude: prefs.location?.lng
      }
    });

    return { preferences };
  }

  /* ---------- Tokens ---------- */

  async refresh(refreshToken: string) {
    const sessions = await this.prisma.session.findMany({
      where: { expiresAt: { gt: new Date() } }
    });

    for (const session of sessions) {
      const valid = await argon2.verify(session.refreshHash, refreshToken);
      if (!valid) continue;

      const accessToken = await signAccessToken(this.privateKey, {
        sub: session.userId,
        uid: session.userId
      });

      return { accessToken };
    }

    return null;
  }

  async logout(refreshToken: string) {
    const sessions = await this.prisma.session.findMany({
      where: { expiresAt: { gt: new Date() } }
    });

    for (const session of sessions) {
      const valid = await argon2.verify(session.refreshHash, refreshToken);
      if (!valid) continue;

      await this.prisma.session.delete({ where: { id: session.id } });
      return;
    }
  }

  /* ---------- Internal ---------- */

  private async signInOrUp(
    data: Partial<{
      email: string | null;
      phone: string | null;
      name: string | null;
      photoUrl: string | null;
      googleSub: string | null;
      appleSub: string | null;
      facebookId: string | null;
    }>,
    termsVer: string
  ) {
    const user =
      (await this.prisma.user.findFirst({
        where: {
          OR: [
            data.googleSub && { googleSub: data.googleSub },
            data.appleSub && { appleSub: data.appleSub },
            data.facebookId && { facebookId: data.facebookId },
            data.email && { email: data.email },
            data.phone && { phone: data.phone }
          ].filter(Boolean) as any
        }
      })) ??
      (await this.prisma.user.create({
        data: {
          email: data.email ?? undefined,
          phone: data.phone ?? undefined,
          name: data.name ?? undefined,
          photoUrl: data.photoUrl ?? undefined,
          googleSub: data.googleSub ?? undefined,
          appleSub: data.appleSub ?? undefined,
          facebookId: data.facebookId ?? undefined,
          acceptedTerms: true,
          acceptedTermsAt: new Date(),
          acceptedTermsVer: termsVer
        }
      }));

    const accessToken = await signAccessToken(this.privateKey, {
      sub: user.id,
      uid: user.id
    });

    const refreshToken = await signRefreshToken(this.privateKey, {
      sub: user.id,
      uid: user.id
    });

    await this.prisma.session.create({
      data: {
        userId: user.id,
        refreshHash: await argon2.hash(refreshToken),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      }
    });

    return { accessToken, refreshToken };
  }
}
