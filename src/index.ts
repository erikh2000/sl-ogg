import Module from '../wasm/middle-layer';

const {_encoder_clear, _encoder_data_len, _encoder_init, _encoder_process, _encoder_analysis_buffer, _encoder_transfer_data, ANALYSIS_SAMPLE_COUNT} = Module;

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

function _createAnalysisBuffer(pEncoderState:number):P32 {
  return _encoder_analysis_buffer(pEncoderState) >> 2;
}

function _getChannelSampleBuffers(audioBuffer:AudioBuffer):Float32Array[] {
  const channelCount = audioBuffer.numberOfChannels;
  const channelSampleBuffers:Float32Array[] = [];
  for(let channelI = 0; channelI < channelCount; ++channelI) {
    channelSampleBuffers[channelI] = audioBuffer.getChannelData(channelI);
  }
  return channelSampleBuffers;
}

function _processSampleBufferChunk(pEncoderState:number, channelSampleBuffers:Float32Array[], fromSampleNo:number, fromSampleCount:number, p32AnalysisBuffer:P32):Uint8Array {
  const fromSampleNoEnd = fromSampleNo + fromSampleCount;
  for(let channelI = 0; channelI < channelSampleBuffers.length; ++channelI) {
    const channelSamples = channelSampleBuffers[channelI];
    const p32ChannelAnalysisBuffer= Module.HEAPU32[p32AnalysisBuffer + channelI] >> 2;
    Module.HEAPF32.set(channelSamples.subarray(fromSampleNo, fromSampleNoEnd), p32ChannelAnalysisBuffer);
  }
  _encoder_process(pEncoderState, fromSampleCount);
  const oggBytesLength = _encoder_data_len(pEncoderState);
  if (oggBytesLength === 0) return new Uint8Array(0);
  const pOggBytes = _encoder_transfer_data(pEncoderState);
  return new Uint8Array(Module.HEAPU8.subarray(pOggBytes, pOggBytes + oggBytesLength));
}

function _yield() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function _finishProcessing(pEncoderState:number) {
  _encoder_process(pEncoderState, 0);
}

export async function encodeAudioBuffer(audioBuffer:AudioBuffer):Promise<Blob> {
  let pEncoderState:number|null = null;
  const oggByteBuffers:Uint8Array[] = [];
  
  try {
    await _waitForModuleInit();
    
    const sampleCount = audioBuffer.length;
    pEncoderState = _initEncoder(audioBuffer, 1);
    const channelSampleBuffers = _getChannelSampleBuffers(audioBuffer);
    
    let fromSampleNo = 0;
    while(fromSampleNo < sampleCount) {
      const p32AnalysisBuffer= _createAnalysisBuffer(pEncoderState);
      const fromSampleCount = Math.min(ANALYSIS_SAMPLE_COUNT, sampleCount - fromSampleNo);
      const oggBytes = _processSampleBufferChunk(pEncoderState, channelSampleBuffers, fromSampleNo, fromSampleCount, p32AnalysisBuffer);
      if (oggBytes.length) oggByteBuffers.push(oggBytes);
      fromSampleNo += fromSampleCount;
      await _yield();
    }
    
    _finishProcessing(pEncoderState);
    return new Blob(oggByteBuffers, {type:'audio/ogg'});
  } finally {
    if (pEncoderState !== null) _encoder_clear(pEncoderState);
  }
}