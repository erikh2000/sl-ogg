import Module from '../wasm/middle-layer';

type P32 = number|null; // Pointer to 32-bit value in WASM memory space. Can be used as an index into Module.HEAP*32.
type P = number|null; // Pointer to an 8-bit value in WASM memory space. Can be used as an index into Module.HEAP*8.

export type EncodeTag = {
  name:string,
  value:string
};

export type EncodeOptions = {
  quality:number,  // Between -.1 (worst) and 1 (highest quality).
  tags:EncodeTag[]
};

const DEFAULT_ENCODE_OPTIONS:EncodeOptions = {
  quality: .5,
  tags: []
};

const {_clearEncoder, _createAnalysisBuffer, _decodeComments, _initEncoder, _processEncoding, _getEncodedDataLen, _transferEncodedData, ANALYSIS_SAMPLE_COUNT} = Module;

let waitForModuleInitPromise:Promise<void>|null = null;
async function _waitForModuleInit():Promise<void> {
  if (Module._isInitialized) return; // Module has already been initialized.
  if (Module._isInitialized === undefined) throw Error('Unexpected behavior from middle-layer.js import.'); // middle-layer.js should have a preRun() function that sets Module._isInitialized to false. If it's not there, then the WASM build for middle-layer is probably wrong.
  if (waitForModuleInitPromise !== null) return await waitForModuleInitPromise; // Module is already being initialized.
  waitForModuleInitPromise = new Promise<void>((resolve) => { // Module has not yet been initialized.
    Module.onRuntimeInitialized = resolve();
  });
  return waitForModuleInitPromise;
}

function _tagsToBuffer(tags:EncodeTag[]):P {
  if (!tags.length) return null;
  // Check for reserved characters in tag names and values.
  tags.forEach(tag => {
    if (tag.name.indexOf('=') !== -1) throw Error(`Tag name "${tag.name}" contains reserved character "="`);
    if (tag.name.indexOf('\t') !== -1) throw Error(`Tag name "${tag.name}" contains reserved character (tab)`);
    if (tag.value.indexOf('\t') !== -1) throw Error(`Tag value "${tag.value}" contains reserved character (tab)`);
    // I don't care if value has an equal sign in it, because parsing can just stop at the first equal sign.
  });
  const serializedTabArray = tags.map(tag => `${tag.name}=${tag.value}`);
  const serializedTabs = serializedTabArray.join('\t');
  return Module.allocateUTF8(serializedTabs);
}

function _bufferToTags(pBuffer:P):EncodeTag[] {
  if (pBuffer === null) return [];
  const serializedTabs:string = Module.UTF8ToString(pBuffer);
  const serializedTabArray = serializedTabs.split('\t');
  return serializedTabArray.map(serializedTab => {
    const equalPos = serializedTab.indexOf('=');
    if (equalPos === -1) throw Error(`Invalid tag "${serializedTab}"`);
    return {
      name: serializedTab.slice(0, equalPos),
      value: serializedTab.slice(equalPos+1)
    };
  });
}

function _init(audioBuffer:AudioBuffer, quality:number, tagsBuffer:P):P {
  const channelCount = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  return _initEncoder(channelCount, sampleRate, quality, tagsBuffer);
}

function _getChannelSampleBuffers(audioBuffer:AudioBuffer):Float32Array[] {
  const channelCount = audioBuffer.numberOfChannels;
  const channelSampleBuffers:Float32Array[] = [];
  for(let channelI = 0; channelI < channelCount; ++channelI) {
    channelSampleBuffers[channelI] = audioBuffer.getChannelData(channelI);
  }
  return channelSampleBuffers;
}

function _processAndTransferData(pEncoderState:P, sampleCount:number):Uint8Array {
  _processEncoding(pEncoderState, sampleCount);
  const oggBytesLength = _getEncodedDataLen(pEncoderState);
  if (oggBytesLength === 0) return new Uint8Array(0);
  const pOggBytes = _transferEncodedData(pEncoderState);
  return new Uint8Array(Module.HEAPU8.subarray(pOggBytes, pOggBytes + oggBytesLength));
}

function _processSampleBufferChunk(pEncoderState:P, channelSampleBuffers:Float32Array[], fromSampleNo:number, fromSampleCount:number, p32AnalysisBuffer:P32):Uint8Array {
  if (p32AnalysisBuffer === null) throw Error('Unexpected');
  
  const fromSampleNoEnd = fromSampleNo + fromSampleCount;
  for(let channelI = 0; channelI < channelSampleBuffers.length; ++channelI) {
    const channelSamples = channelSampleBuffers[channelI];
    const p32ChannelAnalysisBuffer= Module.HEAPU32[p32AnalysisBuffer + channelI] >> 2;
    Module.HEAPF32.set(channelSamples.subarray(fromSampleNo, fromSampleNoEnd), p32ChannelAnalysisBuffer);
  }
  return _processAndTransferData(pEncoderState, fromSampleCount);
}

function _yield():Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function _finishProcessing(pEncoderState:P):Uint8Array {
  return _processAndTransferData(pEncoderState, 0);
}

function _fillInDefaults(encodeOptions:Partial<EncodeOptions>):EncodeOptions {
  if (encodeOptions === DEFAULT_ENCODE_OPTIONS) return DEFAULT_ENCODE_OPTIONS;
  const useOptions:any = {...DEFAULT_ENCODE_OPTIONS};
  const encodeOptionsAny = encodeOptions as any;
  for(const key in encodeOptions) {
    if (encodeOptionsAny[key] !== undefined) useOptions[key] = encodeOptionsAny[key];
  }
  return useOptions;
}

export async function encodeAudioBuffer(audioBuffer:AudioBuffer, encodeOptions:Partial<EncodeOptions> = DEFAULT_ENCODE_OPTIONS):Promise<Blob> {
  let pEncoderState:P = null;
  const oggByteBuffers:Uint8Array[] = [];
  const options = _fillInDefaults(encodeOptions);
  let tagsBuffer:P = null;
  
  try {
    await _waitForModuleInit();
    
    tagsBuffer = _tagsToBuffer(options.tags);
    const sampleCount = audioBuffer.length;
    pEncoderState = _init(audioBuffer, options.quality, tagsBuffer);
    const channelSampleBuffers = _getChannelSampleBuffers(audioBuffer);
    
    let fromSampleNo = 0;
    if (pEncoderState === null) throw Error('Unexpected');
    while(fromSampleNo < sampleCount) {
      const p32AnalysisBuffer= _createAnalysisBuffer(pEncoderState) >> 2;
      const fromSampleCount = Math.min(ANALYSIS_SAMPLE_COUNT, sampleCount - fromSampleNo);
      const oggBytes = _processSampleBufferChunk(pEncoderState, channelSampleBuffers, fromSampleNo, fromSampleCount, p32AnalysisBuffer);
      if (oggBytes.length) oggByteBuffers.push(oggBytes);
      fromSampleNo += fromSampleCount;
      await _yield();
    }
    
    const lastOggBytes = _finishProcessing(pEncoderState);
    if (lastOggBytes.length) oggByteBuffers.push(lastOggBytes);
    return new Blob(oggByteBuffers, {type:'audio/ogg'});
  } finally {
    if (pEncoderState !== null) _clearEncoder(pEncoderState);
    if (tagsBuffer !== null) Module._free(tagsBuffer);
  }
}

async function _decodeOggArrayBuffer(arrayBuffer:ArrayBuffer, audioContext?:AudioContext):Promise<AudioBuffer> {
  const useAudioContext = audioContext ?? new AudioContext(); // Requires a user gesture on browser, e.g., clicking a button.
  return await useAudioContext.decodeAudioData(arrayBuffer); // Returns AudioBuffer. This call detaches the arrayBuffer, making it unusable for most things.
}

function _decodeOggArrayBufferTags(arrayBuffer:ArrayBuffer):EncodeTag[] {
  let pOggBytes:P = null, pComments:P = null;
  try {
    const oggBytes = new Uint8Array(arrayBuffer);
    pOggBytes = Module._malloc(oggBytes.length);
    Module.HEAPU8.set(oggBytes, pOggBytes);
    pComments = _decodeComments(pOggBytes, oggBytes.length);
    return _bufferToTags(pComments);
  } finally {
    if (pComments !== null) Module._free(pComments);
    if (pOggBytes !== null) Module._free(pOggBytes);
  }
}

export async function decodeOggBlob(blob:Blob, audioContext?:AudioContext):Promise<AudioBuffer> {
  const arrayBuffer = await blob.arrayBuffer();
  return await _decodeOggArrayBuffer(arrayBuffer, audioContext);
}

export async function decodeOggBlobWithTags(blob:Blob, audioContext?:AudioContext):Promise<[audioBuffer:AudioBuffer, tags:EncodeTag[]]> {
  const arrayBuffer = await blob.arrayBuffer();
  const tags:EncodeTag[] = _decodeOggArrayBufferTags(arrayBuffer);
  const audioBuffer = await _decodeOggArrayBuffer(arrayBuffer, audioContext);
  return [audioBuffer, tags];
}