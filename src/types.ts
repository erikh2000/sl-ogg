export type P32 = number|null; // Pointer to 32-bit value in WASM memory space. Can be used as an index into Module.HEAP*32.
export type P = number|null; // Pointer to an 8-bit value in WASM memory space. Can be used as an index into Module.HEAP*8.

export type EncodeTag = {
  name:string,
  value:string
};

export type EncodeOptions = {
  quality:number,  // Between -.1 (worst) and 1 (highest quality).
  tags:EncodeTag[]
};
