declare module "essentia.js" {
  type EssentiaPackage = {
    readonly EssentiaWASM: object;
    readonly EssentiaExtractor: new (wasm: object, debug?: boolean) => unknown;
  };

  const packageValue: EssentiaPackage;
  export default packageValue;
}
