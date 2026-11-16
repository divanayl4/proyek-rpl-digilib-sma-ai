jest.mock("@/lib/prisma", () => ({
  prisma: {},
}));

import { executeTool, toolsForRole } from "@/lib/ai/tools";

function toolNames(role: string): string[] {
  return toolsForRole(role).map((tool) => tool.function.name);
}

describe("pembatasan tool aktivitas membaca", () => {
  it("menyediakan tool pribadi untuk Siswa/Guru", () => {
    expect(toolNames("STUDENT")).toContain("get_my_reading_activity");
    expect(toolNames("TEACHER")).toContain("get_my_reading_activity");
  });

  it("tool global hanya tersedia untuk ADMIN, bukan Pustakawan", () => {
    expect(toolNames("ADMIN")).toContain("get_ebook_reading_activity");
    expect(toolNames("LIBRARIAN")).not.toContain("get_ebook_reading_activity");
    expect(toolNames("STUDENT")).not.toContain("get_ebook_reading_activity");
  });

  it("menolak eksekusi tool global oleh Pustakawan sebelum query", async () => {
    const result = await executeTool(
      "get_ebook_reading_activity",
      {},
      "user-1",
      "LIBRARIAN"
    );

    expect(JSON.parse(result)).toEqual({
      error: "Akses ditolak: role Anda tidak memiliki wewenang untuk fungsi ini.",
    });
  });
});
