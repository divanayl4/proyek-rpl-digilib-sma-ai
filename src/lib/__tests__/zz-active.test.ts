import { prisma } from "@/lib/prisma";
test("active count", async () => {
  const active = await prisma.user.count({ where: { isActive: true } });
  const inactive = await prisma.user.count({ where: { isActive: false } });
  console.log("ACTIVE:", active, "INACTIVE:", inactive);
  const users = await prisma.user.findMany({ select: { name: true, isActive: true } });
  for (const u of users) console.log(u.name, u.isActive);
});
