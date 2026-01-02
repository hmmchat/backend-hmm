import { PrismaClient } from '@prisma/client';
const pc = new PrismaClient();
console.log(typeof pc.wallet);
