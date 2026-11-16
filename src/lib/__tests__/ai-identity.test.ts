/**
 * AI Chat — Personalisasi Sapaan
 *
 * Fokus: sapaan diambil HANYA dari identitas akun yang login, memakai gelar
 * Pak/Bu yang benar, tidak pernah mengarang, dan sopan untuk semua peran.
 */

import {
  buildPersonalGreeting,
  formatDisplayName,
  getHonorific,
  isPureGreeting,
  normalizeGender,
  toUserIdentity,
} from "@/lib/ai/identity";

describe("normalizeGender()", () => {
  it("menerima MALE/FEMALE tanpa membedakan huruf besar-kecil", () => {
    expect(normalizeGender("MALE")).toBe("MALE");
    expect(normalizeGender("female")).toBe("FEMALE");
    expect(normalizeGender(" Male ")).toBe("MALE");
  });

  it("mengembalikan null untuk nilai kosong atau tak dikenal", () => {
    expect(normalizeGender(null)).toBeNull();
    expect(normalizeGender(undefined)).toBeNull();
    expect(normalizeGender("")).toBeNull();
    expect(normalizeGender("LAINNYA")).toBeNull();
  });
});

describe("toUserIdentity()", () => {
  it("menormalkan gender dari database", () => {
    expect(toUserIdentity({ name: "Yoga", role: "TEACHER", gender: "male" })).toEqual({
      name: "Yoga",
      role: "TEACHER",
      gender: "MALE",
      class: null,
    });
  });

  it("membawa kelas siswa dan mengabaikan kelas kosong", () => {
    expect(
      toUserIdentity({ name: "Arya", role: "STUDENT", gender: "MALE", class: "XI IPA 1" })
    ).toEqual({
      name: "Arya",
      role: "STUDENT",
      gender: "MALE",
      class: "XI IPA 1",
    });

    expect(
      toUserIdentity({ name: "Budi", role: "STUDENT", gender: "MALE", class: "   " })
    ).toMatchObject({ class: null });
  });
});

describe("getHonorific()", () => {
  it("memberi Pak untuk laki-laki dan Bu untuk perempuan", () => {
    expect(getHonorific("TEACHER", "MALE")).toBe("Pak");
    expect(getHonorific("TEACHER", "FEMALE")).toBe("Bu");
  });

  it("tidak memberi gelar untuk siswa", () => {
    expect(getHonorific("STUDENT", "MALE")).toBe("");
    expect(getHonorific("STUDENT", "FEMALE")).toBe("");
  });

  it("tidak memberi gelar bila gender tidak tersedia", () => {
    expect(getHonorific("TEACHER", null)).toBe("");
    expect(getHonorific("STUDENT", undefined)).toBe("");
    expect(getHonorific("STAFF", null)).toBe("");
  });
});

describe("formatDisplayName()", () => {
  it("menambahkan gelar untuk guru sesuai gender", () => {
    expect(formatDisplayName({ name: "Yoga", role: "TEACHER", gender: "MALE" })).toBe(
      "Pak Yoga"
    );
    expect(formatDisplayName({ name: "Siti", role: "TEACHER", gender: "FEMALE" })).toBe(
      "Bu Siti"
    );
  });

  it("memakai nama polos untuk siswa", () => {
    expect(formatDisplayName({ name: "Arya", role: "STUDENT", gender: "MALE" })).toBe("Arya");
    expect(formatDisplayName({ name: "Aisyah", role: "STUDENT", gender: "FEMALE" })).toBe(
      "Aisyah"
    );
  });

  it("memakai nama polos bila gender tidak tersedia", () => {
    expect(formatDisplayName({ name: "Staf TU", role: "STAFF", gender: null })).toBe("Staf TU");
  });

  it("tidak menggandakan gelar yang sudah ada pada nama", () => {
    expect(formatDisplayName({ name: "Pak Guru", role: "TEACHER", gender: "MALE" })).toBe(
      "Pak Guru"
    );
    expect(formatDisplayName({ name: "Bu Rina", role: "TEACHER", gender: "FEMALE" })).toBe(
      "Bu Rina"
    );
  });
});

describe("buildPersonalGreeting()", () => {
  it("menyapa guru laki-laki dengan Pak", () => {
    expect(buildPersonalGreeting({ name: "Yoga", role: "TEACHER", gender: "MALE" })).toBe(
      "Hai, Pak Yoga. Ada yang bisa saya bantu?"
    );
  });

  it("menyapa guru perempuan dengan Bu", () => {
    expect(buildPersonalGreeting({ name: "Siti", role: "TEACHER", gender: "FEMALE" })).toBe(
      "Hai, Bu Siti. Ada yang bisa saya bantu?"
    );
  });

  it("menyapa siswa dengan nama polos", () => {
    expect(buildPersonalGreeting({ name: "Arya", role: "STUDENT", gender: "MALE" })).toBe(
      "Hai, Arya. Ada yang bisa saya bantu?"
    );
    expect(buildPersonalGreeting({ name: "Aisyah", role: "STUDENT", gender: "FEMALE" })).toBe(
      "Hai, Aisyah. Ada yang bisa saya bantu?"
    );
  });

  it("memakai nama polos bila gender tidak tersedia", () => {
    expect(buildPersonalGreeting({ name: "Staf TU", role: "STAFF", gender: null })).toBe(
      "Hai, Staf TU. Ada yang bisa saya bantu?"
    );
  });
});

describe("isPureGreeting()", () => {
  it("mengenali sapaan murni dengan berbagai variasi", () => {
    expect(isPureGreeting("hai")).toBe(true);
    expect(isPureGreeting("Halo")).toBe(true);
    expect(isPureGreeting("  Hai!  ")).toBe(true);
    expect(isPureGreeting("haloo...")).toBe(true);
    expect(isPureGreeting("selamat pagi")).toBe(true);
    expect(isPureGreeting("Selamat malam!")).toBe(true);
    expect(isPureGreeting("apa kabar")).toBe(true);
    expect(isPureGreeting("halo apa kabar")).toBe(true);
    expect(isPureGreeting("good morning")).toBe(true);
    expect(isPureGreeting("assalamualaikum")).toBe(true);
  });

  it("menolak pesan yang berisi permintaan lain", () => {
    expect(isPureGreeting("hai, apa yang bisa kamu bantu?")).toBe(false);
    expect(isPureGreeting("halo, ada buku fisika?")).toBe(false);
    expect(isPureGreeting("jelaskan hukum Newton")).toBe(false);
    expect(isPureGreeting("terima kasih")).toBe(false);
    expect(isPureGreeting("")).toBe(false);
    expect(isPureGreeting("   ")).toBe(false);
  });
});