// Post-install script to ensure Prisma client is available
const { execSync } = require("child_process");
const path = require("path");

try {
  const prismaPath = path.join(__dirname, "..", "node_modules", ".prisma", "client");
  const fs = require("fs");

  if (!fs.existsSync(prismaPath)) {
    console.log("Generating Prisma client...");
    execSync("npx prisma generate", {
      cwd: path.join(__dirname, ".."),
      stdio: "inherit"
    });
  }
} catch (error) {
  console.warn("Failed to generate Prisma client:", error.message);
}
