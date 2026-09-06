export const artifacts = {
  wasm: new URL("../../circuits/add/add.wasm", import.meta.url),
  zkey: new URL("../../circuits/add/add_final.zkey", import.meta.url),
  vk: new URL("../../circuits/add/vk.json", import.meta.url)
};
