import Module from '../wasm/middle-layer';

const {_encoder_clear, _encoder_data_len, _encoder_init, _encoder_process, _encoder_analysis_buffer, _encoder_transfer_data, ANALYSIS_SAMPLE_COUNT} = Module;

console.log(ANALYSIS_SAMPLE_COUNT);

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

type P32 = number;

function _initEncoder(audioBuffer:AudioBuffer, quality:number):number {
  const channelCount = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  return _encoder_init(channelCount, sampleRate, quality);
}

function _createAnalysisBuffer(pEncoderState:number, sampleCount:number):P32 {
  return _encoder_analysis_buffer(pEncoderState, sampleCount) >> 2;
}

function _getChannelSampleBuffers(audioBuffer:AudioBuffer):Float32Array[] {
  const channelCount = audioBuffer.numberOfChannels;
  const channelSampleBuffers:Float32Array[] = [];
  for(let channelI = 0; channelI < channelCount; ++channelI) {
    channelSampleBuffers[channelI] = audioBuffer.getChannelData(channelI);
  }
  return channelSampleBuffers;
}

function _analyzeSampleBufferChunk(pEncoderState:number, channelSampleBuffers:Float32Array[], fromSampleNo:number, fromSampleCount:number, p32AnalysisBuffer:P32) {
  const fromSampleNoEnd = fromSampleNo + fromSampleCount;
  for(let channelI = 0; channelI < channelSampleBuffers.length; ++channelI) {
    const channelSamples = channelSampleBuffers[channelI];
    const p32ChannelAnalysisBuffer= Module.HEAPU32[p32AnalysisBuffer + channelI] >> 2;
    Module.HEAPF32.set(channelSamples.subarray(fromSampleNo, fromSampleNoEnd), p32ChannelAnalysisBuffer);
  }
  _encoder_process(pEncoderState, fromSampleCount);
}

function _getOggBytes(pEncoderState:number):Uint8Array {
  const oggBytesLength = _encoder_data_len(pEncoderState);
  if (oggBytesLength === 0) throw new Error('Failed to encode audio buffer.'); // Have no idea when this would actually happen. A debug error, I guess.
  const pOggBytes = _encoder_transfer_data(pEncoderState);
  return new Uint8Array(Module.HEAPU8.subarray(pOggBytes, pOggBytes + oggBytesLength));
}

function _yield() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

export type EncodeTag = {
  name:string;
  value:string;
}

export type EncodeOptions = {
  quality?:number; // Float between -.1 and 1. -.1 is lowest quality, 1 is highest quality.
  tags?:EncodeTag[];
}

const DEFAULT_ENCODE_OPTIONS = {
  quality: 0.5,
  tags: []
};

export async function encodeAudioBuffer(audioBuffer:AudioBuffer, encodeOptions = DEFAULT_ENCODE_OPTIONS):Promise<Blob> {
  let pEncoderState:number|null = null;
  const {quality} = {...DEFAULT_ENCODE_OPTIONS, ...encodeOptions};
  
  try {
    await _waitForModuleInit();
    
    const sampleCount = audioBuffer.length;
    pEncoderState = _initEncoder(audioBuffer, quality);
    const p32AnalysisBuffer = _createAnalysisBuffer(pEncoderState, sampleCount);
    const channelSampleBuffers = _getChannelSampleBuffers(audioBuffer);
    
    let fromSampleNo = 0;
    while(fromSampleNo < sampleCount) {
      const fromSampleCount = Math.min(ANALYSIS_SAMPLE_COUNT, sampleCount - fromSampleNo);
      _analyzeSampleBufferChunk(pEncoderState, channelSampleBuffers, fromSampleNo, fromSampleCount, p32AnalysisBuffer);
      fromSampleNo += fromSampleCount;
      await _yield();
    }
      
    const oggBytes = _getOggBytes(pEncoderState);
    return new Blob([oggBytes], {type:'audio/ogg'});
  } finally {
    if (pEncoderState !== null) _encoder_clear(pEncoderState);
  }
}