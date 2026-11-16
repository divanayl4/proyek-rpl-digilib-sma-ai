/**
 * @jest-environment jsdom
 */

/**
 * Halaman Konfigurasi AI — input API key bersifat password, tidak disimpan di
 * localStorage/URL, dan dikosongkan kembali setelah draft disimpan.
 */

import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import AIConfigView from "@/components/admin/AIConfigView";

const TEST_KEY = "nvapi-ui-secret-key-123456";

function baseState(overrides: Record<string, unknown> = {}) {
  return {
    configured: false,
    source: "NONE",
    effective: {
      provider: null,
      providerLabel: null,
      model: null,
      fallbackModels: [],
      baseUrl: null,
      disableThinking: false,
    },
    active: null,
    draft: null,
    env: {
      configured: false,
      provider: "NVIDIA",
      providerLabel: "NVIDIA NIM",
      model: "",
      baseUrl: "https://integrate.api.nvidia.com/v1",
      disableThinking: true,
    },
    lastTest: null,
    encryption: {
      available: true,
      source: "AI_CONFIG_ENCRYPTION_KEY",
      message: null,
    },
    message: null,
    ...overrides,
  };
}

function jsonResponse(body: unknown, ok = true) {
  return Promise.resolve({
    ok,
    status: ok ? 200 : 400,
    json: async () => body,
  } as Response);
}

let fetchMock: jest.Mock;

beforeEach(() => {
  localStorage.clear();
  fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => jest.restoreAllMocks());

describe("AIConfigView", () => {
  it("menampilkan halaman ADMIN dengan input API key bertipe password", async () => {
    fetchMock.mockReturnValue(jsonResponse({ state: baseState() }));

    const { container } = render(<AIConfigView />);

    expect(await screen.findByRole("heading", { name: /Konfigurasi AI/ })).toBeInTheDocument();

    const input = container.querySelector("#ai-api-key") as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.type).toBe("password");
    expect(input.getAttribute("autocomplete")).toBe("new-password");

    fireEvent.click(screen.getByRole("button", { name: "Tampilkan API key" }));
    expect(input.type).toBe("text");
    fireEvent.click(screen.getByRole("button", { name: "Sembunyikan API key" }));
    expect(input.type).toBe("password");
  });

  it("memakai grid dua kolom penuh tanpa batas lebar formulir lama", async () => {
    fetchMock.mockReturnValue(jsonResponse({ state: baseState() }));

    const { container } = render(<AIConfigView />);
    await screen.findByRole("heading", { name: /Konfigurasi AI/ });

    // Dua kolom: formulir/provider di kiri, status/diagnostik di kanan.
    expect(container.querySelector(".ai-config-layout")).not.toBeNull();
    expect(container.querySelectorAll(".ai-config-column")).toHaveLength(2);
    // Kolom kiri memakai lebar penuh, bukan max-w-xl yang menyisakan ruang kosong.
    expect(container.querySelector(".max-w-xl")).toBeNull();
    expect(container.querySelectorAll(".ai-config-form")).toHaveLength(3);
    expect(container.querySelector(".ai-config-actions")).not.toBeNull();
  });

  it("menampilkan langkah berikutnya dan diagnostik server saat runtime masih .env", async () => {
    const state = baseState({
      configured: true,
      source: "ENV",
      effective: {
        provider: "NVIDIA",
        providerLabel: "NVIDIA NIM",
        model: "nvidia/nemotron-3.5-lightning-30b-a3b",
        fallbackModels: [],
        baseUrl: "https://integrate.api.nvidia.com/v1",
        disableThinking: true,
      },
      env: {
        configured: true,
        provider: "NVIDIA",
        providerLabel: "NVIDIA NIM",
        model: "nvidia/nemotron-3.5-lightning-30b-a3b",
        baseUrl: "https://integrate.api.nvidia.com/v1",
        disableThinking: true,
      },
      message:
        "Belum ada konfigurasi AI aktif di database. Runtime memakai konfigurasi .env.",
      diagnostics: {
        runtimeSource: "ENV",
        draft: {
          present: true,
          secretPresent: true,
          secretValid: true,
          testedSuccessfully: false,
          changedSinceTest: false,
        },
        active: { present: false, secretPresent: false, secretValid: false },
        encryption: {
          source: "NEXTAUTH_SECRET",
          fallbackInUse: true,
        },
        env: {
          configured: true,
          keyAvailableForDraftProvider: true,
          providerMatchesDraft: true,
        },
        lastTest: {
          ok: false,
          category: "TIMEOUT",
          at: new Date().toISOString(),
        },
        nextAction: {
          code: "RETRY_TEST",
          message:
            "Uji koneksi gagal karena TIMEOUT, bukan bukti API key salah. Aktivasi ditolak dan runtime tetap memakai .env.",
        },
      },
    });
    fetchMock.mockReturnValue(jsonResponse({ state }));

    render(<AIConfigView />);
    await screen.findByRole("heading", { name: /Konfigurasi AI/ });

    expect(
      screen.getByText(/Belum ada konfigurasi AI aktif di database/)
    ).toBeInTheDocument();
    expect(screen.getByText("Langkah berikutnya")).toBeInTheDocument();
    expect(screen.getByText(/bukan bukti API key salah/)).toBeInTheDocument();
    expect(screen.getByText("Diagnostik Konfigurasi")).toBeInTheDocument();
    expect(screen.getByText(/Uji terakhir gagal \(Timeout\)/)).toBeInTheDocument();
    expect(
      screen.getByText(/Enkripsi memakai fallback NEXTAUTH_SECRET/)
    ).toBeInTheDocument();
    expect(screen.getAllByText("Belum aktif").length).toBeGreaterThan(0);
  });

  it("mengirim API key hanya pada body PUT dan mengosongkan input setelah simpan", async () => {
    const initial = baseState();
    const saved = baseState({
      draft: {
        provider: "NVIDIA",
        model: "meta/llama-3.1-8b-instruct",
        fallbackModels: [],
        disableThinking: true,
        baseUrl: "https://integrate.api.nvidia.com/v1",
        updatedAt: new Date().toISOString(),
        updatedBy: "Admin Uji",
        hasApiKey: true,
        apiKeyValid: true,
      },
    });

    fetchMock
      .mockReturnValueOnce(jsonResponse({ state: initial }))
      .mockReturnValueOnce(
        jsonResponse({
          message: "Draft konfigurasi AI disimpan. Konfigurasi aktif belum berubah.",
          draft: saved.draft,
          state: saved,
        })
      );

    const { container } = render(<AIConfigView />);
    await screen.findByRole("heading", { name: /Konfigurasi AI/ });

    const input = container.querySelector("#ai-api-key") as HTMLInputElement;
    fireEvent.change(input, { target: { value: TEST_KEY } });
    expect(input.value).toBe(TEST_KEY);

    fireEvent.click(screen.getByRole("button", { name: /Simpan Konfigurasi/ }));

    await waitFor(() => expect(input.value).toBe(""));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("/api/admin/ai-config");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body).apiKey).toBe(TEST_KEY);
    expect(String(url)).not.toContain(TEST_KEY);

    expect(JSON.stringify(localStorage)).not.toContain(TEST_KEY);
    expect(window.location.href).not.toContain(TEST_KEY);

    expect(
      await screen.findByText(/Draft konfigurasi AI disimpan/)
    ).toBeInTheDocument();
  });

  it("menjalankan alur uji → simpan draft → aktivasi dan menampilkan sumber DATABASE", async () => {
    const initial = baseState({
      env: {
        configured: true,
        provider: "NVIDIA",
        providerLabel: "NVIDIA NIM",
        model: "nvidia/nemotron-3.5-lightning-30b-a3b",
        baseUrl: "https://integrate.api.nvidia.com/v1",
        disableThinking: true,
      },
    });
    const draftConfig = {
      provider: "NVIDIA",
      model: "nvidia/nemotron-3.5-lightning-30b-a3b",
      fallbackModels: [],
      disableThinking: true,
      baseUrl: "https://integrate.api.nvidia.com/v1",
      updatedAt: new Date().toISOString(),
      updatedBy: "Admin Uji",
      hasApiKey: true,
      apiKeyValid: true,
    };
    const draftState = baseState({ draft: draftConfig, lastTest: null });
    const activeState = baseState({
      configured: true,
      source: "DATABASE",
      active: {
        ...draftConfig,
        activatedAt: new Date().toISOString(),
      },
      draft: draftConfig,
      effective: {
        provider: "NVIDIA",
        providerLabel: "NVIDIA NIM",
        model: draftConfig.model,
        fallbackModels: draftConfig.fallbackModels,
        baseUrl: draftConfig.baseUrl,
        disableThinking: true,
      },
    });

    fetchMock
      .mockReturnValueOnce(jsonResponse({ state: initial }))
      .mockReturnValueOnce(
        jsonResponse({
          ok: true,
          category: "SUCCESS",
          message: "Koneksi berhasil.",
          latencyMs: 12,
          httpStatus: null,
          provider: "NVIDIA",
          model: draftConfig.model,
          testedAt: new Date().toISOString(),
        })
      )
      .mockReturnValueOnce(jsonResponse({ message: "Draft disimpan.", state: draftState }))
      .mockReturnValueOnce(
        jsonResponse({
          message: "Konfigurasi AI berhasil diaktifkan.",
          active: draftConfig,
          test: null,
          state: activeState,
        })
      );

    const { container } = render(<AIConfigView />);
    await screen.findByRole("heading", { name: /Konfigurasi AI/ });

    const input = container.querySelector("#ai-api-key") as HTMLInputElement;
    fireEvent.change(input, { target: { value: TEST_KEY } });

    fireEvent.click(screen.getByRole("button", { name: /Uji Koneksi/ }));
    expect(
      (await screen.findAllByText("Koneksi berhasil.")).length
    ).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: /Simpan Konfigurasi/ }));
    await waitFor(() => expect(input.value).toBe(""));

    fireEvent.click(
      screen.getByRole("button", { name: /Aktifkan Konfigurasi/ })
    );
    fireEvent.click(screen.getByRole("button", { name: "Uji & Aktifkan" }));

    expect(
      await screen.findByText(/berhasil diaktifkan/)
    ).toBeInTheDocument();
    expect(screen.getAllByText(/Aktif dari database/).length).toBeGreaterThan(0);

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/admin/ai-config",
      "/api/admin/ai-config/test",
      "/api/admin/ai-config",
      "/api/admin/ai-config/activate",
    ]);
    expect(fetchMock.mock.calls.map((call) => call[1].method)).toEqual([
      undefined,
      "POST",
      "PUT",
      "POST",
    ]);
  });

  it("tidak menampilkan kembali API key dari state server", async () => {
    const state = baseState({
      source: "DATABASE",
      configured: true,
      draft: {
        provider: "NVIDIA",
        model: "meta/llama-3.1-8b-instruct",
        fallbackModels: [],
        disableThinking: true,
        baseUrl: "https://integrate.api.nvidia.com/v1",
        updatedAt: new Date().toISOString(),
        updatedBy: "Admin Uji",
        hasApiKey: true,
        apiKeyValid: true,
      },
    });
    fetchMock.mockReturnValue(jsonResponse({ state }));

    const { container } = render(<AIConfigView />);
    await screen.findByRole("heading", { name: /Konfigurasi AI/ });

    const input = container.querySelector("#ai-api-key") as HTMLInputElement;
    expect(input.value).toBe("");
    expect(screen.getByText(/API key telah tersimpan/)).toBeInTheDocument();
  });
});
