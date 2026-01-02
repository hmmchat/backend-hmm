#!/usr/bin/env node
// Postinstall script to create @prisma/client package.json for proper module resolution
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const prismaClientDir = path.join(__dirname, '../node_modules/@prisma/client');
const prismaGeneratedDir = path.join(__dirname, '../node_modules/.prisma/client');

// Create @prisma/client directory if it doesn't exist
if (!fs.existsSync(prismaClientDir)) {
  fs.mkdirSync(prismaClientDir, { recursive: true });
}

// Create package.json that points to the generated client
// The package.json is in node_modules/@prisma/client/
// The generated client is in node_modules/.prisma/client/
// So we need to go up two levels (from @prisma/client to node_modules), then into .prisma
const packageJson = {
  name: '@prisma/client',
  main: '../../.prisma/client/index.js',
  types: '../../.prisma/client/index.d.ts'
};

fs.writeFileSync(
  path.join(prismaClientDir, 'package.json'),
  JSON.stringify(packageJson, null, 2)
);

console.log('✅ Created @prisma/client package.json for discovery-service');

