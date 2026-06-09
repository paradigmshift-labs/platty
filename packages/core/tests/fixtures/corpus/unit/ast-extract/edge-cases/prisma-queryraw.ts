const prisma = null as any;
async function getUsers() {
  return prisma.$queryRaw<{id: string}[]>`SELECT id FROM users`;
}
