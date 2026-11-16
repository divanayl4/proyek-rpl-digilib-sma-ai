/**
 * Verifikasi: perubahan database tercermin dalam jawaban AI tanpa ubah prompt.
 * Membuat notifikasi sementara untuk Bela, memanggil tool get_my_notifications
 * sebelum/sesudah, lalu menghapus kembali. Database kembali seperti semula.
 *
 * Jalankan: npx tsx scripts/verify-reactivity.ts
 */
import { prisma } from "../src/lib/prisma";
import { executeTool } from "../src/lib/ai/tools";

async function main() {
  const bela = await prisma.user.findFirst({
    where: { email: "bela@sma.id" },
    select: { id: true, role: true },
  });
  if (!bela) throw new Error("Bela tidak ditemukan");

  const before = JSON.parse(
    await executeTool("get_my_notifications", {}, bela.id, bela.role)
  );
  console.log(`sebelum: count=${before.count}`);

  const created = await prisma.notification.create({
    data: {
      userId: bela.id,
      title: "UJI REAKTIVITAS AI",
      message: "Notifikasi sementara untuk verifikasi.",
      type: "INFO",
    },
    select: { id: true },
  });

  try {
    const after = JSON.parse(
      await executeTool("get_my_notifications", {}, bela.id, bela.role)
    );
    console.log(`sesudah tambah: count=${after.count}`);
    const terlihat = (after.notifications as Array<{ title: string }>).some(
      (n) => n.title === "UJI REAKTIVITAS AI"
    );
    console.log(`notifikasi baru terlihat di jawaban tool: ${terlihat ? "YA" : "TIDAK"}`);
    if (!terlihat || after.count !== before.count + 1) {
      throw new Error("Perubahan database TIDAK tercermin.");
    }
    console.log("OK: perubahan database tercermin tanpa mengubah prompt.");
  } finally {
    await prisma.notification.delete({ where: { id: created.id } });
    const bersih = JSON.parse(
      await executeTool("get_my_notifications", {}, bela.id, bela.role)
    );
    console.log(`setelah dibersihkan: count=${bersih.count} (harus = ${before.count})`);
    if (bersih.count !== before.count) throw new Error("Pembersihan gagal.");
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
