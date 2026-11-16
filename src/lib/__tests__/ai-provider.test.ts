/**
 * AI Chat — Perilaku Provider AI
 *
 * Menguji pemilihan model cadangan, penanganan kredensial, dan-kesalahan
 * respons tanpa memanggil jaringan sungguhan.
 */

import { OpenAIAIProvider } from "@/lib/ai/openai";
import { AIProviderError, AIChatMessage } from "@/lib/ai/types";

const messages: AIChatMessage[] = [{ role: "user", content: "Halo" }];

function okResponse(content: string, extra: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ choices: [{ message: { content, ...extra } }] }),
  } as unknown as Response;
}

function errorResponse(status: number, message = "boom", headers: Record<string, string> = {}) {
  return {
    ok: false,
    status,
    headers: { get: (key: string) => headers[key.toLowerCase()] ?? null },
    text: async () => JSON.stringify({ error: { message } }),
  } as unknown as Response;
}

let fetchMock: jest.Mock;

beforeEach(() => {
  fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => jest.restoreAllMocks());

function calledModels(): string[] {
  return fetchMock.mock.calls.map(
    (c) => (c[1] as { body: string }).body && JSON.parse((c[1] as { body: string }).body).model
  );
}

describe("OpenAIAIProvider — pemilihan model", () => {
  it("memakai model utama bila berhasil", async () => {
    fetchMock.mockResolvedValue(okResponse("Halo!"));

    const provider = new OpenAIAIProvider("key-abc", "https://x/v1", "model-utama", [
      "model-cadangan",
    ]);

    await expect(provider.chat(messages)).resolves.toBe("Halo!");
    expect(calledModels()).toEqual(["model-utama"]);
  });

  it("berpindah ke model cadangan saat model utama 404", async () => {
    fetchMock
      .mockResolvedValueOnce(errorResponse(404, "Function not found"))
      .mockResolvedValueOnce(okResponse("Halo dari cadangan"));

    const provider = new OpenAIAIProvider("key-abc", "https://x/v1", "model-utama", [
      "model-cadangan-1",
      "model-cadangan-2",
    ]);

    await expect(provider.chat(messages)).resolves.toBe("Halo dari cadangan");
    expect(calledModels()).toEqual(["model-utama", "model-cadangan-1"]);
  });

  it("berpindah ke model cadangan setelah retry 429 gagal", async () => {
    fetchMock
      .mockResolvedValueOnce(errorResponse(429, "Rate limit exceeded", { "retry-after": "0" }))
      .mockResolvedValueOnce(errorResponse(429, "Rate limit exceeded", { "retry-after": "0" }))
      .mockResolvedValueOnce(errorResponse(429, "Rate limit exceeded", { "retry-after": "0" }))
      .mockResolvedValueOnce(okResponse("Halo dari cadangan"));

    const provider = new OpenAIAIProvider("key-abc", "https://x/v1", "model-utama", [
      "model-cadangan",
    ]);

    await expect(provider.chat(messages)).resolves.toBe("Halo dari cadangan");
    // 3 percobaan model utama (awal + 2 retry), lalu model cadangan.
    expect(calledModels()).toEqual([
      "model-utama",
      "model-utama",
      "model-utama",
      "model-cadangan",
    ]);
  });

  it("melewati model cadangan yang gagal lalu mencoba yang berikutnya", async () => {
    fetchMock
      .mockResolvedValueOnce(errorResponse(503))
      .mockResolvedValueOnce(errorResponse(503))
      .mockResolvedValueOnce(okResponse("Selamat datang"));

    const provider = new OpenAIAIProvider("key-abc", "https://x/v1", "a", ["b", "c"]);

    await expect(provider.chat(messages)).resolves.toBe("Selamat datang");
    expect(calledModels()).toEqual(["a", "b", "c"]);
  });

  it("TIDAK berpindah model bila kredensial ditolak", async () => {
    fetchMock.mockResolvedValue(errorResponse(401, "Unauthorized"));

    const provider = new OpenAIAIProvider("key-abc", "https://x/v1", "a", ["b"]);

    await expect(provider.chat(messages)).rejects.toThrow(AIProviderError);
    expect(calledModels()).toEqual(["a"]);
  });

  it("TIDAK mengulang model utama yang sama di daftar cadangan", async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(404)).mockResolvedValueOnce(okResponse("ok"));

    const provider = new OpenAIAIProvider("key-abc", "https://x/v1", "a", ["a", "b"]);
    await provider.chat(messages);

    expect(calledModels()).toEqual(["a", "b"]);
  });

  it("mengabaikan nama model cadangan yang kosong", async () => {
    fetchMock.mockResolvedValue(errorResponse(404));

    const provider = new OpenAIAIProvider("key-abc", "https://x/v1", "a", ["", "  "]);

    // Hanya ada satu model yang sah, sehingga error harus diteruskan.
    await expect(provider.chat(messages)).rejects.toThrow(AIProviderError);
    expect(calledModels()).toEqual(["a"]);
  });
});

describe("OpenAIAIProvider — penanganan respons", () => {
  it("menolak respons yang content-nya kosong", async () => {
    fetchMock.mockResolvedValue(okResponse("   "));

    const provider = new OpenAIAIProvider("key-abc", "https://x/v1", "a");
    await expect(provider.chat(messages)).rejects.toThrow(
      "Provider AI tidak mengembalikan jawaban."
    );
  });

  it("melaporkan model reasoning yang kehabisan token", async () => {
    fetchMock.mockResolvedValue(okResponse("", { reasoning_content: "x".repeat(900) }));

    const provider = new OpenAIAIProvider("key-abc", "https://x/v1", "a");
    await expect(provider.chat(messages)).rejects.toMatchObject({
      name: "AIProviderError",
      detail: expect.stringContaining("content kosong"),
    });
  });

  it("menangani body upstream yang bukan JSON", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => "<html>Bad Gateway</html>",
    } as unknown as Response);

    const provider = new OpenAIAIProvider("key-abc", "https://x/v1", "a");
    await expect(provider.chat(messages)).rejects.toMatchObject({ status: 502 });
  });

  it("menerjemahkan kegagalan jaringan menjadi pesan ramah", async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error("ECONNREFUSED"), { name: "TypeError" }));

    const provider = new OpenAIAIProvider("key-abc", "https://x/v1", "a");
    await expect(provider.chat(messages)).rejects.toThrow(
      "Tidak dapat menghubungi provider AI."
    );
  });

  it("mencatat kode ECONNRESET dan tetap memakai model cadangan", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const reset = Object.assign(new TypeError("fetch failed"), {
      cause: { code: "ECONNRESET" },
    });
    fetchMock
      .mockRejectedValueOnce(reset)
      .mockResolvedValueOnce(okResponse("Halo dari cadangan"));

    const provider = new OpenAIAIProvider("key-abc", "https://x/v1", "a", ["b"]);

    await expect(provider.chat(messages)).resolves.toBe("Halo dari cadangan");
    expect(calledModels()).toEqual(["a", "b"]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("code=ECONNRESET"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("category=transport"));
    expect(warn.mock.calls.flat().join(" ")).not.toContain("key-abc");
  });

  it("memetakan kegagalan body-read setelah HTTP 200 ke AIProviderError transport", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const reset = Object.assign(new TypeError("terminated"), {
      cause: { code: "ECONNRESET" },
    });
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => {
        throw reset;
      },
    } as unknown as Response);

    const provider = new OpenAIAIProvider("key-abc", "https://x/v1", "a");

    await expect(provider.chat(messages)).rejects.toMatchObject({
      name: "AIProviderError",
      status: 503,
      detail: expect.stringContaining("body read failed: TypeError (ECONNRESET)"),
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("status=-"));
  });

  it("mempertahankan status HTTP bila body-read gagal setelah respons error", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => {
        throw new TypeError("terminated");
      },
    } as unknown as Response);

    const provider = new OpenAIAIProvider("key-abc", "https://x/v1", "a");

    await expect(provider.chat(messages)).rejects.toMatchObject({
      name: "AIProviderError",
      status: 502,
      upstreamStatus: 500,
      detail: expect.stringContaining("HTTP 500"),
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("status=500"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("category=transport"));
  });

  it("tetap mencoba model cadangan saat body-read gagal setelah HTTP error", async () => {
    jest.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => {
          throw new TypeError("terminated");
        },
      } as unknown as Response)
      .mockResolvedValueOnce(okResponse("Halo dari cadangan"));

    const provider = new OpenAIAIProvider("key-abc", "https://x/v1", "a", ["b"]);

    await expect(provider.chat(messages)).resolves.toBe("Halo dari cadangan");
    expect(calledModels()).toEqual(["a", "b"]);
  });

  it("memetakan timeout ke AIProviderError dan mencatat kategorinya", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const timeout = Object.assign(new Error("The operation was aborted due to timeout"), {
      name: "TimeoutError",
      cause: { code: "UND_ERR_CONNECT_TIMEOUT" },
    });
    fetchMock.mockRejectedValue(timeout);

    const provider = new OpenAIAIProvider("key-abc", "https://x/v1", "a");

    await expect(provider.chat(messages)).rejects.toMatchObject({
      name: "AIProviderError",
      status: 503,
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("category=timeout"));
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("code=UND_ERR_CONNECT_TIMEOUT")
    );
  });

  it("tidak pernah membocorkan API key ke pesan error", async () => {
    fetchMock.mockResolvedValue(errorResponse(401, "bad key super-secret-123"));

    const provider = new OpenAIAIProvider("key-abc", "https://x/v1", "a");

    try {
      await provider.chat(messages);
      throw new Error("harusnya gagal");
    } catch (error) {
      const e = error as AIProviderError;
      expect(e.message).not.toContain("key-abc");
      expect(e.detail).not.toContain("key-abc");
      expect(e.message).toContain("API key");
    }
  });

  it("mengirim batas token keluaran yang cukup untuk model reasoning", async () => {
    fetchMock.mockResolvedValue(okResponse("ok"));

    const provider = new OpenAIAIProvider("key-abc", "https://x/v1", "a");
    await provider.chat(messages);

    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body.max_tokens).toBeGreaterThanOrEqual(1000);
    expect(body.messages).toHaveLength(1);
  });

  it("mematikan mode thinking secara default agar respons cepat", async () => {
    fetchMock.mockResolvedValue(okResponse("ok"));

    const provider = new OpenAIAIProvider("key-abc", "https://x/v1", "a");
    await provider.chat(messages);

    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
  });

  it("tidak mengirim chat_template_kwargs bila thinking diaktifkan", async () => {
    fetchMock.mockResolvedValue(okResponse("ok"));

    const provider = new OpenAIAIProvider("key-abc", "https://x/v1", "a", [], {
      disableThinking: false,
    });
    await provider.chat(messages);

    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body.chat_template_kwargs).toBeUndefined();
  });

  it("tidak mengirim chat_template_kwargs ke provider non-NVIDIA", async () => {
    fetchMock.mockResolvedValue(okResponse("ok"));

    const provider = new OpenAIAIProvider("key-abc", "https://x/v1", "a", [], {
      disableThinking: true,
      sendThinkingControl: false,
    });
    await provider.chat(messages);

    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body.chat_template_kwargs).toBeUndefined();
  });

  it("testConnection hanya mengirim prompt ping dengan token kecil dan tanpa tools", async () => {
    fetchMock.mockResolvedValue(okResponse("pong"));

    const provider = new OpenAIAIProvider("key-abc", "https://x/v1", "a", ["b"]);
    await provider.testConnection();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body.model).toBe("a");
    expect(body.messages).toEqual([{ role: "user", content: "ping" }]);
    expect(body.max_tokens).toBe(512);
    expect(body.tools).toBeUndefined();
  });

  it("testConnection Groq memakai max_completion_tokens tanpa parameter thinking NVIDIA", async () => {
    fetchMock.mockResolvedValue(okResponse("pong"));

    const provider = new OpenAIAIProvider(
      "gsk_test",
      "https://api.groq.com/openai/v1",
      "llama-3.1-8b-instant",
      [],
      {
        providerId: "GROQ",
        disableThinking: false,
        sendThinkingControl: false,
      }
    );
    await provider.testConnection();

    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body.model).toBe("llama-3.1-8b-instant");
    expect(body.max_completion_tokens).toBe(512);
    expect(body.max_tokens).toBeUndefined();
    expect(body.chat_template_kwargs).toBeUndefined();
    expect(body.tools).toBeUndefined();
  });

  it("meredaksi API key yang muncul pada pesan error upstream", async () => {
    fetchMock.mockResolvedValue(errorResponse(401, "bad key key-abc"));

    const provider = new OpenAIAIProvider("key-abc", "https://x/v1", "a");

    try {
      await provider.chat(messages);
      throw new Error("harusnya gagal");
    } catch (error) {
      const e = error as AIProviderError;
      expect(e.detail).toContain("[REDACTED]");
      expect(e.detail).not.toContain("key-abc");
    }
  });

  it("membuang garis miring ganda pada baseURL", async () => {
    fetchMock.mockResolvedValue(okResponse("ok"));

    const provider = new OpenAIAIProvider("key-abc", "https://x/v1/", "a");
    await provider.chat(messages);

    expect(fetchMock.mock.calls[0][0]).toBe("https://x/v1/chat/completions");
  });

  it("tidak mengirim daftar tools pada chat biasa", async () => {
    fetchMock.mockResolvedValue(okResponse("ok"));

    const provider = new OpenAIAIProvider("key-abc", "https://x/v1", "a");
    await provider.chat(messages);

    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body.tools).toBeUndefined();
  });
});

describe("OpenAIAIProvider — tool-calling", () => {
  function toolResponse(content: string | null, toolCalls: unknown[]) {
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ choices: [{ message: { content, tool_calls: toolCalls } }] }),
    } as unknown as Response;
  }

  const toolCalls = [
    {
      id: "call-1",
      type: "function",
      function: { name: "catalog_stats", arguments: "{}" },
    },
  ];

  it("mengirim daftar tools dan mengeksekusi panggilan model", async () => {
    fetchMock
      .mockResolvedValueOnce(toolResponse(null, toolCalls))
      .mockResolvedValueOnce(okResponse("Ada 4 judul buku."));

    const provider = new OpenAIAIProvider("key-abc", "https://x/v1", "a");
    const execute = jest.fn().mockResolvedValue(JSON.stringify({ totalTitles: 4 }));

    const tools = [
      {
        type: "function" as const,
        function: {
          name: "catalog_stats",
          description: "statistik katalog",
          parameters: { type: "object" as const, properties: {} },
        },
      },
    ];

    const answer = await provider.chatWithTools?.(
      [{ role: "user", content: "berapa buku di perpustakaan?" }],
      tools,
      execute
    );

    expect(answer).toBe("Ada 4 judul buku.");
    expect(execute).toHaveBeenCalledWith("catalog_stats", {});

    // Permintaan pertama membawa daftar tools.
    const firstBody = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(Array.isArray(firstBody.tools)).toBe(true);
    expect(firstBody.tools[0].function.name).toBe("catalog_stats");

    // Permintaan kedua membawa pesan tool berisi hasil eksekusi.
    const secondBody = JSON.parse((fetchMock.mock.calls[1][1] as { body: string }).body);
    const toolMessage = secondBody.messages.find(
      (m: { role: string }) => m.role === "tool"
    );
    expect(toolMessage.tool_call_id).toBe("call-1");
    expect(JSON.parse(toolMessage.content)).toEqual({ totalTitles: 4 });
  });

  it("mengembalikan error sebagai hasil tool bila fungsi tidak dikenal", async () => {
    fetchMock
      .mockResolvedValueOnce(
        toolResponse(null, [
          {
            id: "call-9",
            type: "function",
            function: { name: "hapus_semua_data", arguments: "{}" },
          },
        ])
      )
      .mockResolvedValueOnce(okResponse("Maaf, data belum dapat diakses."));

    const provider = new OpenAIAIProvider("key-abc", "https://x/v1", "a");
    const execute = jest.fn().mockResolvedValue(
      JSON.stringify({ error: 'Fungsi "hapus_semua_data" tidak tersedia.' })
    );

    const answer = await provider.chatWithTools?.(
      [{ role: "user", content: "hapus semua data" }],
      [],
      execute
    );

    expect(answer).toBe("Maaf, data belum dapat diakses.");
    expect(execute).toHaveBeenCalledWith("hapus_semua_data", {});
  });

  it("menganggap content kosong + tool_calls sebagai permintaan fungsi", async () => {
    fetchMock
      .mockResolvedValueOnce(toolResponse("", toolCalls))
      .mockResolvedValueOnce(okResponse("selesai"));

    const provider = new OpenAIAIProvider("key-abc", "https://x/v1", "a");
    const execute = jest.fn().mockResolvedValue("{}");

    const answer = await provider.chatWithTools?.(
      [{ role: "user", content: "statistik" }],
      [],
      execute
    );

    expect(answer).toBe("selesai");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("meminta rangkuman akhir bila model terus meminta fungsi", async () => {
    fetchMock
      .mockResolvedValueOnce(toolResponse(null, toolCalls))
      .mockResolvedValueOnce(toolResponse(null, toolCalls))
      .mockResolvedValueOnce(toolResponse(null, toolCalls))
      .mockResolvedValueOnce(okResponse("Rangkuman akhir dari data."));

    const provider = new OpenAIAIProvider("key-abc", "https://x/v1", "a");
    const execute = jest.fn().mockResolvedValue("{}");

    const answer = await provider.chatWithTools?.(
      [{ role: "user", content: "x" }],
      [],
      execute
    );

    expect(answer).toBe("Rangkuman akhir dari data.");
    // 3 ronde tool + 1 permintaan penutup TANPA tools.
    expect(fetchMock.mock.calls.length).toBe(4);
    const closingBody = JSON.parse(
      (fetchMock.mock.calls[3][1] as { body: string }).body
    );
    expect(closingBody.tools).toBeUndefined();
  });

  it("mencoba model cadangan bila tool-calling gagal di model utama", async () => {
    fetchMock
      .mockResolvedValueOnce(errorResponse(503))
      .mockResolvedValueOnce(okResponse("jawaban cadangan"));

    const provider = new OpenAIAIProvider("key-abc", "https://x/v1", "a", ["b"]);
    const execute = jest.fn().mockResolvedValue("{}");

    const answer = await provider.chatWithTools?.(
      [{ role: "user", content: "halo" }],
      [],
      execute
    );

    expect(answer).toBe("jawaban cadangan");
    expect(calledModels()).toEqual(["a", "b"]);
  });
});