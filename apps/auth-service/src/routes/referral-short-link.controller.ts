import { Controller, Get, Header, Param, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { z } from "zod";
import { AuthService } from "../services/auth.service.js";

const referralCodeSchema = z
  .string()
  .trim()
  .min(4)
  .max(80)
  .regex(/^[A-Za-z0-9]+$/, "Invalid referral code format");

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

@Controller()
export class ReferralShortLinkController {
  constructor(private readonly auth: AuthService) {}

  @Get("r/:referralCode")
  @Header("Cache-Control", "public, max-age=60")
  async redirectReferral(
    @Param("referralCode") referralCodeRaw: string,
    @Res() res: FastifyReply
  ) {
    const referralCode = referralCodeSchema.parse(referralCodeRaw);
    const landingUrl = this.auth.getReferralShareRedirectTarget(referralCode);
    const preview = await this.fetchInvitePreview(referralCode);
    const name = preview?.username || "Someone";
    const title = `${name} invited you to Beam`;
    const description = "Open this FaceCard and join me on Beam.";
    const image = preview?.imageUrl || "";

    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:url" content="${escapeHtml(landingUrl)}" />
  ${image ? `<meta property="og:image" content="${escapeHtml(image)}" />` : ""}
  ${image ? `<meta property="og:image:alt" content="${escapeHtml(`${name}'s FaceCard`)}" />` : ""}
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(description)}" />
  ${image ? `<meta name="twitter:image" content="${escapeHtml(image)}" />` : ""}
  <meta http-equiv="refresh" content="0;url=${escapeHtml(landingUrl)}" />
  <link rel="canonical" href="${escapeHtml(landingUrl)}" />
</head>
<body>
  <p>Opening ${escapeHtml(name)}'s FaceCard…</p>
  <script>location.replace(${JSON.stringify(landingUrl)});</script>
  <a href="${escapeHtml(landingUrl)}">Continue</a>
</body>
</html>`;

    return res.type("text/html; charset=utf-8").send(html);
  }

  private async fetchInvitePreview(
    referralCode: string
  ): Promise<{ username: string; imageUrl: string } | null> {
    const userServiceUrl = (process.env.USER_SERVICE_URL || "http://localhost:3002").replace(/\/$/, "");
    try {
      const response = await fetch(
        `${userServiceUrl}/users/invite/${encodeURIComponent(referralCode)}`,
        { method: "GET", headers: { Accept: "application/json" } }
      );
      if (!response.ok) return null;
      const body = (await response.json()) as {
        facecard?: { username?: string; displayPictureUrl?: string | null };
      };
      const username = String(body?.facecard?.username || "").trim();
      const imageUrl = String(body?.facecard?.displayPictureUrl || "").trim();
      if (!username) return null;
      return { username, imageUrl };
    } catch {
      return null;
    }
  }
}
