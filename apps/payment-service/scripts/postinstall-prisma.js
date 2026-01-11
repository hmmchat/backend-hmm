#!/usr/bin/env node
// Postinstall script to create @prisma/client symlink for proper module resolution
// This matches the setup used in wallet-service
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const prismaClientDir = path.join(__dirname, '../node_modules/@prisma/client');
const prismaGeneratedDir = path.join(__dirname, '../node_modules/.prisma/client');

// Only proceed if .prisma/client exists (Prisma client has been generated)
if (!fs.existsSync(prismaGeneratedDir)) {
  console.log('⚠️  Prisma client not generated yet. Run: npm run prisma:generate');
  process.exit(0);
}

// Remove existing @prisma/client if it exists (could be directory or symlink)
if (fs.existsSync(prismaClientDir)) {
  try {
    const stats = fs.lstatSync(prismaClientDir);
    if (stats.isSymbolicLink()) {
      fs.unlinkSync(prismaClientDir);
    } else if (stats.isDirectory()) {
      fs.rmSync(prismaClientDir, { recursive: true, force: true });
    }
  } catch (error) {
    console.error('Error removing existing @prisma/client:', error.message);
  }
}

// Create symlink from @prisma/client to .prisma/client (like wallet-service)
try {
  fs.symlinkSync('../.prisma/client', prismaClientDir, 'dir');
  console.log('✅ Created @prisma/client symlink for payment-service');
} catch (error) {
  console.error('❌ Failed to create symlink:', error.message);
  // Fall back to package.json approach if symlink fails
  try {
    fs.mkdirSync(prismaClientDir, { recursive: true });
    const packageJson = {
      name: '@prisma/client',
      main: '../.prisma/client/index.js',
      types: '../.prisma/client/index.d.ts'
    };
    fs.writeFileSync(
      path.join(prismaClientDir, 'package.json'),
      JSON.stringify(packageJson, null, 2)
    );
    console.log('⚠️  Created @prisma/client package.json (symlink failed)');
  } catch (fallbackError) {
    console.error('❌ Failed to create fallback package.json:', fallbackError.message);
    process.exit(1);
  }
}
