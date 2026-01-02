#!/usr/bin/env node
// Postinstall script to create @prisma/client symlink for proper module resolution
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const prismaClientDir = path.join(__dirname, '../node_modules/@prisma/client');
const prismaGeneratedDir = path.join(__dirname, '../node_modules/.prisma/client');

// Remove existing @prisma/client if it exists (could be directory or symlink)
if (fs.existsSync(prismaClientDir)) {
  try {
    if (fs.lstatSync(prismaClientDir).isSymbolicLink()) {
      fs.unlinkSync(prismaClientDir);
    } else {
      fs.rmSync(prismaClientDir, { recursive: true, force: true });
    }
  } catch (error) {
    console.error('Error removing existing @prisma/client:', error.message);
  }
}

// Create symlink from @prisma/client to .prisma/client
try {
  fs.symlinkSync('../.prisma/client', prismaClientDir, 'dir');
  console.log('✅ Created @prisma/client symlink for user-service');
} catch (error) {
  // If symlink fails (e.g., on Windows), create package.json as fallback
  console.warn('⚠️  Symlink failed, creating package.json fallback:', error.message);
  if (!fs.existsSync(prismaClientDir)) {
    fs.mkdirSync(prismaClientDir, { recursive: true });
  }
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
}

