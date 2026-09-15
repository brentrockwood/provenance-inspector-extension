/**
 * Make the C2PA engine runnable under Node, so its behaviour can be asserted in CI.
 *
 * The engine reads assets through `FileReaderSync`, which exists only inside a Web Worker.
 * In the extension that is fine — verification runs in one. Under Node neither the API nor a
 * Web Worker exists, so this shim provides a synchronous read over Node's Blob by capturing
 * the bytes each Blob was constructed from.
 *
 * This is test scaffolding and nothing else. It is not shipped, it does not change what the
 * engine verifies, and the assertions it enables are about the engine's real output on real
 * signed assets.
 */

const captured = new WeakMap<Blob, Uint8Array>();
const NativeBlob = globalThis.Blob;

type BlobPart = ArrayBuffer | ArrayBufferView | Blob | string;

function concat(parts: readonly BlobPart[]): Uint8Array {
  const chunks = parts.map((part) => {
    if (part instanceof Uint8Array) return part;
    if (part instanceof ArrayBuffer) return new Uint8Array(part);
    if (ArrayBuffer.isView(part)) {
      return new Uint8Array(part.buffer, part.byteOffset, part.byteLength);
    }
    const known = captured.get(part as Blob);
    if (known) return known;
    return new TextEncoder().encode(String(part));
  });
  const out = new Uint8Array(chunks.reduce((total, c) => total + c.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

class ShimBlob extends NativeBlob {
  constructor(parts: readonly BlobPart[] = [], options?: BlobPropertyBag) {
    super(parts as BlobPart[], options);
    captured.set(this as unknown as Blob, concat(parts));
  }

  slice(start?: number, end?: number, contentType?: string): Blob {
    const bytes = captured.get(this as unknown as Blob) ?? new Uint8Array();
    const sliced = bytes.slice(start ?? 0, end ?? bytes.byteLength);
    return new ShimBlob([sliced], { type: contentType ?? this.type }) as unknown as Blob;
  }
}

(globalThis as Record<string, unknown>).Blob = ShimBlob;

(globalThis as Record<string, unknown>).FileReaderSync = class {
  readAsArrayBuffer(blob: Blob): ArrayBuffer {
    const bytes = captured.get(blob);
    if (!bytes) throw new Error('FileReaderSync shim: blob was not created through the shim');
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }
};
