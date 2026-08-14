import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  applyDeceasedMemorialImage,
  MEMORIAL_CONFIRMATION,
  parseMemorialResult,
  sanitizeMemorialImage,
} from "../scripts/apply-deceased-memorial-image";

describe("aplicación segura de la imagen conmemorativa", () => {
  it("genera un JPEG sanitizado y acotado", async () => {
    const jpeg = await sanitizeMemorialImage(resolve("public/images/deceased-memorial.jpg"));
    expect(jpeg.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expect(jpeg.length).toBeGreaterThan(1_000);
    expect(jpeg.length).toBeLessThanOrEqual(8 * 1024 * 1024);
  });

  it("rechaza resultados incompletos del RPC", () => {
    expect(() => parseMemorialResult({ totalConfirmedDeceased: 142, mediaLinked: 142 }))
      .toThrow("INVALID_RPC_RESULT_cardsConfigured");
  });

  it("exige confirmación explícita antes de leer o escribir", async () => {
    await expect(applyDeceasedMemorialImage("archivo-inexistente.jpg", {}))
      .rejects.toThrow("CONFIRMATION_REQUIRED");
  });

  it("sube un único JPEG por hash y envía al RPC solo metadatos seguros", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        totalConfirmedDeceased: 142,
        mediaLinked: 142,
        cardsConfigured: 142,
      }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const result = await applyDeceasedMemorialImage(
      resolve("public/images/deceased-memorial.jpg"),
      {
        CONFIRM_DECEASED_MEMORIAL_IMAGE: MEMORIAL_CONFIRMATION,
        NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "s".repeat(40),
        DECEASED_MEMORIAL_REASON: "Imagen conmemorativa solicitada para casos confirmados.",
      },
      fetcher,
    );

    expect(result).toMatchObject({ totalConfirmedDeceased: 142, mediaLinked: 142, cardsConfigured: 142 });
    expect(result.assetSha256).toMatch(/^[a-f0-9]{64}$/u);
    const expectedPath = `memorial/deceased-${result.assetSha256}.jpg`;
    expect(fetcher).toHaveBeenNthCalledWith(1,
      `https://project.supabase.co/storage/v1/object/public-portraits/${expectedPath}`,
      expect.objectContaining({ method: "POST", body: expect.any(Uint8Array) }),
    );
    const rpcCall = fetcher.mock.calls[1];
    expect(rpcCall[0]).toBe("https://project.supabase.co/rest/v1/rpc/apply_deceased_memorial_portrait");
    expect(JSON.parse(String((rpcCall[1] as RequestInit).body))).toEqual({
      p_public_path: expectedPath,
      p_public_url: `https://project.supabase.co/storage/v1/object/public/public-portraits/${expectedPath}`,
      p_size_bytes: expect.any(Number),
      p_reason: "Imagen conmemorativa solicitada para casos confirmados.",
    });
  });
});
