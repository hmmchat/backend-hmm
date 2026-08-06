// Prisma config for discovery-service
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "apps/discovery-service/prisma/schema.prisma",
  experimental: {
    adapter: true,
  },
  datasources: {
    db: {
      url: env("DATABASE_URL"),
    },
  },
});