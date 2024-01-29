// postMiddleLayer.js
Module.preRun = () => Module._isInitialized = false;
Module.postRun = () => Module._isInitialized = true;
Module.ANALYSIS_SAMPLE_COUNT = 8192; // If you change this, you must also change ANALYSIS_SAMPLE_COUNT in middle-layer.c
export default Module;

//# sourceMappingURL=middle-layer.wasm.map