import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
console.log('wallet' in prisma ? '✅ wallet exists' : '❌ wallet missing');
console.log('Type:', typeof prisma.wallet);
