import { NextRequest } from "next/server";

const mockGetServerSession = jest.fn();

jest.mock("next-auth/next", () => ({
  getServerSession: (...args: unknown[]) => mockGetServerSession(...args),
}));

jest.mock("@/lib/prisma", () => ({
  prisma: {},
}));

jest.mock("fs/promises", () => ({
  ...jest.requireActual("fs/promises"),
  writeFile: jest.fn().mockResolvedValue(undefined),
  mkdir: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  existsSync: jest.fn().mockReturnValue(true),
}));

import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { POST as uploadCoverHandler } from "@/app/api/upload/route";
import { POST as uploadEbookHandler } from "@/app/api/upload/ebook/route";

const ADMIN_SESSION = { user: { id: "admin-1", role: "ADMIN" } };
const STUDENT_SESSION = { user: { id: "stu-1", role: "STUDENT" } };

function createFormDataRequest(url: string, file?: File | null): NextRequest {
  const formData = new FormData();
  if (file) {
    formData.append("file", file);
  }
  return new NextRequest(url, {
    method: "POST",
    body: formData,
  });
}

describe("Upload API Handlers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (existsSync as jest.Mock).mockReturnValue(true);
    (writeFile as jest.Mock).mockResolvedValue(undefined);
    (mkdir as jest.Mock).mockResolvedValue(undefined);
  });

  describe("POST /api/upload (Book Cover Upload)", () => {
    it("should return 403 if unauthenticated or role is not ADMIN/LIBRARIAN", async () => {
      mockGetServerSession.mockResolvedValueOnce(null);
      const req1 = createFormDataRequest("http://localhost:3000/api/upload");
      expect((await uploadCoverHandler(req1)).status).toBe(403);

      mockGetServerSession.mockResolvedValueOnce(STUDENT_SESSION);
      const req2 = createFormDataRequest("http://localhost:3000/api/upload");
      expect((await uploadCoverHandler(req2)).status).toBe(403);
    });

    it("should return 400 if no file is uploaded", async () => {
      mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
      const req = createFormDataRequest("http://localhost:3000/api/upload");
      const res = await uploadCoverHandler(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toBe("File tidak ditemukan");
    });

    it("should return 400 if file MIME type is unsupported", async () => {
      mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
      const file = new File(["dummy text"], "doc.txt", { type: "text/plain" });
      const req = createFormDataRequest("http://localhost:3000/api/upload", file);

      const res = await uploadCoverHandler(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toContain("Format file tidak didukung");
    });

    it("should return 400 if file extension does not match MIME type (anti-spoofing)", async () => {
      mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
      const file = new File(["dummy content"], "malicious.exe", { type: "image/png" });
      const req = createFormDataRequest("http://localhost:3000/api/upload", file);

      const res = await uploadCoverHandler(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toBe("Ekstensi file tidak sesuai dengan tipe file.");
    });

    it("should return 400 if file size exceeds 5 MB limit", async () => {
      mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
      // 5 MB + 1024 bytes buffer
      const overSizeBuffer = new Uint8Array(5 * 1024 * 1024 + 1024);
      const bigFile = new File([overSizeBuffer], "large-cover.jpg", { type: "image/jpeg" });

      const req = createFormDataRequest("http://localhost:3000/api/upload", bigFile);
      const res = await uploadCoverHandler(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toContain("Ukuran file terlalu besar");
    });

    it("should successfully save image file and return 201 with public URL", async () => {
      mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
      (existsSync as jest.Mock).mockReturnValue(false); // test directory creation

      const validFile = new File(["valid image data"], "buku-ipa.png", { type: "image/png" });
      const req = createFormDataRequest("http://localhost:3000/api/upload", validFile);

      const res = await uploadCoverHandler(req);
      const data = await res.json();

      expect(res.status).toBe(201);
      expect(data.url).toMatch(/^\/uploads\/cover-\d+-\d+\.png$/);
      expect(mkdir).toHaveBeenCalled();
      expect(writeFile).toHaveBeenCalled();
    });

    it("should return 500 when disk write fails", async () => {
      mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
      (writeFile as jest.Mock).mockRejectedValue(new Error("Disk full"));

      const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});

      const validFile = new File(["image data"], "cover.jpg", { type: "image/jpeg" });
      const req = createFormDataRequest("http://localhost:3000/api/upload", validFile);

      const res = await uploadCoverHandler(req);
      const data = await res.json();

      expect(res.status).toBe(500);
      expect(data.error).toBe("Gagal mengunggah file");

      consoleSpy.mockRestore();
    });
  });

  describe("POST /api/upload/ebook (PDF Ebook Upload)", () => {
    it("should return 403 if unauthenticated or non-librarian", async () => {
      mockGetServerSession.mockResolvedValueOnce(null);
      const req1 = createFormDataRequest("http://localhost:3000/api/upload/ebook");
      expect((await uploadEbookHandler(req1)).status).toBe(403);

      mockGetServerSession.mockResolvedValueOnce(STUDENT_SESSION);
      const req2 = createFormDataRequest("http://localhost:3000/api/upload/ebook");
      expect((await uploadEbookHandler(req2)).status).toBe(403);
    });

    it("should return 400 if no file is provided", async () => {
      mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
      const req = createFormDataRequest("http://localhost:3000/api/upload/ebook");
      const res = await uploadEbookHandler(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toBe("File tidak ditemukan");
    });

    it("should return 400 if file is not application/pdf", async () => {
      mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
      const file = new File(["dummy"], "ebook.epub", { type: "application/epub+zip" });
      const req = createFormDataRequest("http://localhost:3000/api/upload/ebook", file);

      const res = await uploadEbookHandler(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toBe("Format tidak didukung. Unggah berkas PDF.");
    });

    it("should return 400 if extension is not .pdf", async () => {
      mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
      const file = new File(["dummy"], "ebook.bin", { type: "application/pdf" });
      const req = createFormDataRequest("http://localhost:3000/api/upload/ebook", file);

      const res = await uploadEbookHandler(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toBe("Ekstensi berkas harus .pdf");
    });

    it("should return 400 if file size exceeds 50 MB", async () => {
      mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
      // 50 MB + 1024 bytes buffer
      const overSizeBuffer = new Uint8Array(50 * 1024 * 1024 + 1024);
      // Write magic bytes at start
      const magic = Buffer.from("%PDF-");
      overSizeBuffer.set(magic, 0);

      const bigPdf = new File([overSizeBuffer], "big.pdf", { type: "application/pdf" });

      const req = createFormDataRequest("http://localhost:3000/api/upload/ebook", bigPdf);
      const res = await uploadEbookHandler(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toContain("Ukuran berkas terlalu besar");
    });

    it("should return 400 if file content does not have valid PDF magic bytes (%PDF-)", async () => {
      mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
      const fakePdf = new File(["NOT A REAL PDF CONTENT"], "fake.pdf", { type: "application/pdf" });

      const req = createFormDataRequest("http://localhost:3000/api/upload/ebook", fakePdf);
      const res = await uploadEbookHandler(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toBe("Berkas bukan PDF yang sah.");
    });

    it("should successfully upload valid PDF with magic bytes %PDF- and return 201", async () => {
      mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
      (existsSync as jest.Mock).mockReturnValue(false); // test directory creation

      const validPdfBytes = "%PDF-1.5 some binary pdf body stream";
      const validPdf = new File([validPdfBytes], "modul-rpl.pdf", { type: "application/pdf" });

      const req = createFormDataRequest("http://localhost:3000/api/upload/ebook", validPdf);
      const res = await uploadEbookHandler(req);
      const data = await res.json();

      expect(res.status).toBe(201);
      expect(data.filePath).toMatch(/^ebook-\d+-\d+\.pdf$/);
      expect(data.size).toBe(validPdfBytes.length);
      expect(mkdir).toHaveBeenCalled();
      expect(writeFile).toHaveBeenCalled();
    });

    it("should return 500 when disk write fails for ebook", async () => {
      mockGetServerSession.mockResolvedValue(ADMIN_SESSION);
      (writeFile as jest.Mock).mockRejectedValue(new Error("Disk I/O error"));

      const consoleSpy = jest.spyOn(console, "error").mockImplementation(() => {});

      const validPdf = new File(["%PDF-1.4 test"], "modul.pdf", { type: "application/pdf" });
      const req = createFormDataRequest("http://localhost:3000/api/upload/ebook", validPdf);

      const res = await uploadEbookHandler(req);
      const data = await res.json();

      expect(res.status).toBe(500);
      expect(data.error).toBe("Gagal mengunggah berkas ebook");

      consoleSpy.mockRestore();
    });
  });
});
