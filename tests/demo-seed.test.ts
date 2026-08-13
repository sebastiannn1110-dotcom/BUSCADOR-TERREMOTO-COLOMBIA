import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createDemoPortraitJpeg, DEMO_PORTRAIT_MAX_BYTES } from "../scripts/lib/demo-portrait.mjs";

describe("seed ficticio de retratos públicos", () => {
  const seedScript = readFileSync(resolve("scripts/seed-demo-cases.mjs"), "utf8");

  it("recodifica el recurso sintético como un JPEG real y acotado", async () => {
    const source = readFileSync(resolve("data/test-avatars/test-supplies.png"));
    const jpeg = await createDemoPortraitJpeg(source);

    expect(jpeg.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(jpeg.subarray(-2)).toEqual(Buffer.from([0xff, 0xd9]));
    expect(jpeg.length).toBeGreaterThan(0);
    expect(jpeg.length).toBeLessThanOrEqual(DEMO_PORTRAIT_MAX_BYTES);
  });

  it("alinea extensión, MIME, bucket y metadata, y conserva los guards demo", () => {
    expect(seedScript).toContain('process.env.ENABLE_TEST_DATA !== "true"');
    expect(seedScript).toContain('process.env.NODE_ENV === "production"');
    expect(seedScript).toContain('const imagePath = "demo/test-supplies.jpg"');
    expect(seedScript).toContain('allowedMimeTypes: ["image/jpeg"]');
    expect(seedScript).toContain('contentType: "image/jpeg"');
    expect(seedScript).toContain('detected_mime_type: "image/jpeg"');
    expect(seedScript).toContain('original_filename: "test-supplies.jpg"');
    expect(seedScript).not.toContain('contentType: "image/png"');
  });
});
