const prisma = null as any;
async function dangerousOps() {
  await prisma.$queryRawUnsafe<any>(`SELECT * FROM ${table}`);
  await prisma.$executeRaw<number>`UPDATE users SET active = true`;
  await prisma.$executeRawUnsafe<void>(`DELETE FROM logs WHERE id = ${id}`);
}
