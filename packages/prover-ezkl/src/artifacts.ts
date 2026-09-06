export const artifacts = {
  onnx: new URL("../../circuits/add/add.onnx", import.meta.url),
  settings: new URL("../../circuits/add/settings.json", import.meta.url),
  model: new URL("../../circuits/add/model.compiled", import.meta.url),
  vk: new URL("../../circuits/add/vk.json", import.meta.url),
  srs: new URL("../../circuits/add/kzg.srs", import.meta.url)
};
