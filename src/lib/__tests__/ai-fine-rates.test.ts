/**
 * Tarif denda chatbot harus berasal dari pengaturan aktif (Setting), bukan
 * nominal yang ditulis di kode. Tes ini mengubah nilai Setting dan memastikan
 * jawaban ikut berubah.
 */

const mockSettingFindUnique = jest.fn();
const mockSettingFindMany = jest.fn();

jest.mock("@/lib/prisma", () => ({
  prisma: {
    setting: {
      findUnique: (...args: unknown[]) => mockSettingFindUnique(...args),
      findMany: (...args: unknown[]) => mockSettingFindMany(...args),
    },
  },
}));

import {
  buildFineRateAnswer,
  detectFineRateScope,
} from "@/lib/ai/fineRates";

beforeEach(() => {
  jest.clearAllMocks();
  mockSettingFindUnique.mockResolvedValue(null);
  mockSettingFindMany.mockResolvedValue([]);
});

describe("detectFineRateScope()", () => {
  it("mengenali tarif keterlambatan per hari", () => {
    expect(detectFineRateScope("Berapa tarif denda per hari?")).toEqual({
      late: true,
      damage: [],
    });
  });

  it("mengenali kategori kerusakan spesifik", () => {
    expect(detectFineRateScope("Berapa denda kerusakan ringan?").damage).toEqual([
      "LIGHT",
    ]);
    expect(detectFineRateScope("Berapa denda buku sobek?").damage).toEqual([
      "TORN_PAGE",
    ]);
    expect(detectFineRateScope("Berapa denda kehilangan buku?").damage).toEqual([
      "MISSING_PAGE",
    ]);
    expect(detectFineRateScope("Berapa denda sampul rusak?").damage).toEqual([
      "COVER_DAMAGE",
    ]);
    expect(detectFineRateScope("Berapa denda kerusakan berat?").damage).toEqual([
      "SEVERE",
    ]);
    expect(detectFineRateScope("Berapa denda buku kotor?").damage).toEqual([
      "DIRTY",
    ]);
  });

  it("menampilkan seluruh kategori kerusakan untuk pertanyaan umum", () => {
    const scope = detectFineRateScope("Berapa denda kerusakan?");
    expect(scope.late).toBe(false);
    expect(scope.damage).toEqual([
      "DIRTY",
      "LIGHT",
      "TORN_PAGE",
      "MISSING_PAGE",
      "COVER_DAMAGE",
      "SEVERE",
    ]);
  });

  it("menampilkan keterlambatan dan kerusakan untuk tarif denda umum", () => {
    const scope = detectFineRateScope("Berapa tarif denda?");
    expect(scope.late).toBe(true);
    expect(scope.damage.length).toBeGreaterThan(0);
  });
});

describe("buildFineRateAnswer()", () => {
  it("memakai tarif keterlambatan dari Setting aktif", async () => {
    mockSettingFindUnique.mockResolvedValue({ key: "finePerDayIDR", value: "2500" });

    const answer = await buildFineRateAnswer("Berapa tarif denda per hari?");

    expect(answer.message).toContain("Rp2.500");
    expect(answer.message).not.toContain("Rp1.000");
  });

  it("memakai tarif kerusakan dari Setting aktif", async () => {
    mockSettingFindMany.mockResolvedValue([
      { key: "damageFineIDR.LIGHT", value: "7000" },
    ]);

    const answer = await buildFineRateAnswer("Berapa denda kerusakan ringan?");

    expect(answer.message).toContain("Rp7.000");
    expect(answer.message).not.toContain("Rp5.000");
  });

  it("jatuh ke nilai bawaan hanya bila Setting belum diisi", async () => {
    const answer = await buildFineRateAnswer("Berapa denda kerusakan ringan?");

    expect(answer.message).toContain("Rp5.000");
  });
});
