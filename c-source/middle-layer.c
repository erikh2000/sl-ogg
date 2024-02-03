/* Based heavily on Yuji Miyane's code at github.com/higuma/ogg-vorbis-encoder-js/blob/master/src/encoder.c.
   It was extremely valuable to have a working example from which to begin. Thank you, Yuji Miyane, Garciat, and...
   I'll be honest, it's hard to figure out the entire lineage of this heavily forked code to correctly give credit. 
   And here I am forking it too! My contribution, if any, is to explain it here in a way that others may have an 
   easier time understanding and disagreeing with.
   
   This middle layer encapsulates code that relies on struct and memory manipulation which is much easier 
   to write in C. The Vorbis API, in theory, could be exposed directly to JS calling code. But it would be relatively 
   cumbersome to write JS code that accesses the API directly. 
   
   The encoding algorithm that uses these middle layer APIs together works like this:
   1. Initialize all the stuff that will be needed for encoding with encoder_init(). 
   2. Get the memory addresses of buffers in WASM memory to write to for analysis with encoder_analysis_buffer(). 
   3. Process one or more chunks of audio samples, copying them to the analysis buffer and calling encoder_process() 
      for each chunk. Libvorbis writes to a data buffer containing encoded ogg bytes. 
   4. Retrieve the data buffer with encoder_data_len() and encoder_transfer_data(). 
   5. Free memory and clean up with encoder_clear().
   
   The algorithm for decoding comment tags from a buffer of Ogg file bytes is much simpler:
   1. Call decoder_get_comments() with the Ogg file bytes and it will return a pointer to a null-terminated string.
   2. Free memory of the string with Module.free().

   For encoding, I did briefly consider having a single C function that handles all encoding in one call. But it 
   seemed to me that it would be better to preserve an ability to process in chunks in the JS calling code.
   
   encoder_analysis_buffer() allocates a buffer with a *fixed* size of ANALYSIS_SAMPLE_COUNT rather than letting 
   the caller set a size as in the original encoder.c. In the libvorbis code, a buffer will be created in stack memory 
   with alloca() for the analysis buffer. It took me a few days to figure out that if I create a buffer for 
   analysis that will hold an entire audio file, it will overflow the stack and cause unexpected behavior. So calling 
   code really needs to be limited to writing to the analysis buffer in smaller chunks that will fit within the stack. 
   (Or I could allocate from the heap instead of stack, but that would probably require forking libvorbis code, which 
   I'd rather not do.)
*/
#include <time.h>
#include <stdlib.h>
#include <memory.h>
#include <vorbis/vorbisenc.h>
#include <emscripten.h>

typedef struct EncoderState {
    ogg_stream_state streamState;
    ogg_page page;
    ogg_packet packet;
    vorbis_info info;
    vorbis_comment comment;
    vorbis_dsp_state dspState;
    vorbis_block block;
    unsigned char *pEncodedData;
    long encodedDataLen;
} EncoderState;

void _addEncoderData(EncoderState* pEnc) {
    ogg_page* pPage = &pEnc->page;
    long len = pEnc->encodedDataLen + pPage->header_len + pPage->body_len;
    if (!len) return;
    pEnc->pEncodedData = realloc(pEnc->pEncodedData, len);
    memcpy(pEnc->pEncodedData + pEnc->encodedDataLen, pPage->header, pPage->header_len);
    pEnc->encodedDataLen += pPage->header_len;
    memcpy(pEnc->pEncodedData + pEnc->encodedDataLen, pPage->body, pPage->body_len);
    pEnc->encodedDataLen += pPage->body_len;
}

void _addTags(vorbis_comment* pComment, const char* tags) {
    if (tags == NULL) return;
    char *tagsCopy = malloc(strlen(tags) + 1);
    strcpy(tagsCopy, tags);
    char *tag = strtok(tagsCopy, "\t");
    while (tag != NULL) {
        char *value = strchr(tag, '=');
        if (value != NULL) {
            *value = '\0';
            value++;
            vorbis_comment_add_tag(pComment, tag, value);
        }
        tag = strtok(NULL, "\t");
    }
    free(tagsCopy);
}

EMSCRIPTEN_KEEPALIVE
EncoderState* initEncoder(int channelCount, float sampleRate, float quality, const char* tags) {
    ogg_packet commentPacket, codePacket;
    EncoderState* pEnc = malloc(sizeof(EncoderState));
    vorbis_info_init(&pEnc->info);
    vorbis_encode_init_vbr(&pEnc->info, channelCount, sampleRate, quality);
    vorbis_comment_init(&pEnc->comment);
    vorbis_comment_add_tag(&pEnc->comment, "ENCODER", "sl-web-ogg");
    _addTags(&pEnc->comment, tags);
    vorbis_analysis_init(&pEnc->dspState, &pEnc->info);
    vorbis_block_init(&pEnc->dspState, &pEnc->block);
    srand(time(NULL));
    ogg_stream_init(&pEnc->streamState, rand());
    pEnc->pEncodedData = NULL;
    pEnc->encodedDataLen = 0;
    vorbis_analysis_headerout(&pEnc->dspState, &pEnc->comment, &pEnc->packet, &commentPacket, &codePacket);
    ogg_stream_packetin(&pEnc->streamState, &pEnc->packet);
    ogg_stream_packetin(&pEnc->streamState, &commentPacket);
    ogg_stream_packetin(&pEnc->streamState, &codePacket);
    while(ogg_stream_flush(&pEnc->streamState, &pEnc->page) != 0) {
        _addEncoderData(pEnc);
    }
    return pEnc;
}

EMSCRIPTEN_KEEPALIVE
void clearEncoder(EncoderState* pEnc) {
    ogg_stream_clear(&pEnc->streamState);
    vorbis_block_clear(&pEnc->block);
    vorbis_dsp_clear(&pEnc->dspState);
    vorbis_comment_clear(&pEnc->comment);
    vorbis_info_clear(&pEnc->info);
    free(pEnc->pEncodedData);
    free(pEnc);
}

const int ANALYSIS_SAMPLE_COUNT = 8192; // If you change this, you must also change ANALYSIS_SAMPLE_COUNT in postMiddleLayer.js
EMSCRIPTEN_KEEPALIVE
float **createAnalysisBuffer(EncoderState* pEnc) {
    return vorbis_analysis_buffer(&pEnc->dspState, ANALYSIS_SAMPLE_COUNT);
}

EMSCRIPTEN_KEEPALIVE
void processEncoding(EncoderState* pEnc, int length) {
    vorbis_analysis_wrote(&pEnc->dspState, length);
    while(vorbis_analysis_blockout(&pEnc->dspState, &pEnc->block) == 1) {
        vorbis_analysis(&pEnc->block, NULL);
        vorbis_bitrate_addblock(&pEnc->block);
        while(vorbis_bitrate_flushpacket(&pEnc->dspState, &pEnc->packet)) {
            ogg_stream_packetin(&pEnc->streamState, &pEnc->packet);
            while(ogg_stream_pageout(&pEnc->streamState, &pEnc->page) != 0) {
                _addEncoderData(pEnc);
            }
        }
    }
}

EMSCRIPTEN_KEEPALIVE
long getEncodedDataLen(EncoderState* pEnc) {
    return pEnc->encodedDataLen;
}

EMSCRIPTEN_KEEPALIVE
unsigned char* transferEncodedData(EncoderState* pEnc) {
    pEnc->encodedDataLen = 0;
    return pEnc->pEncodedData;
}

unsigned char* _readNextPage(unsigned char* pReadPos, unsigned char* pStopReadPos, ogg_sync_state* pSyncState, ogg_page* pPage) {
    const int BUFFER_SIZE = 8192;
    
    if (ogg_sync_pageout(pSyncState, pPage) == 1) return pReadPos; // Handle case where a previous call may have loaded multiple pages within the sync buffer.
    
    while(pReadPos != pStopReadPos) {
        char *pSyncBuffer = ogg_sync_buffer(pSyncState, BUFFER_SIZE); 
        const int readLen = (pReadPos + BUFFER_SIZE < pStopReadPos) ? BUFFER_SIZE : pStopReadPos - pReadPos;
        memcpy(pSyncBuffer, pReadPos, readLen);
        ogg_sync_wrote(pSyncState, readLen);
        pReadPos += readLen;
        if (ogg_sync_pageout(pSyncState, pPage) == 1) return pReadPos;
    }
    return NULL; // Reached end of buffer without finding a page. Buffer likely corrupted/truncated.   
}

char* _packComments(vorbis_comment* pComments) {
  int packedLength = 0;
  
  int *pCommentLen = pComments->comment_lengths, *pCommentLenStop = pCommentLen + pComments->comments;
  while(pCommentLen != pCommentLenStop) { packedLength += *(pCommentLen++) + 1; }
  
  char* pPacked = malloc(packedLength), *pWrite = pPacked;
  for(int commentI = 0; commentI < pComments->comments; ++commentI) {
    char *pUserComment = pComments->user_comments[commentI];
    int commentLen = pComments->comment_lengths[commentI];
    memcpy(pWrite, pUserComment, commentLen);
    pWrite += commentLen;
    *(pWrite++) = commentI == pComments->comments - 1 ? '\0' : '\t';
  } 
  
  return pPacked;
}

EMSCRIPTEN_KEEPALIVE
char* decodeComments(unsigned char* pOggFileBytes, long oggFileBytesLen) {
    enum {NEW, INITIALIZED, STREAM_INITIALIZED, FOUND_COMMENT} state = NEW;
    
    ogg_sync_state syncState;
    ogg_packet packet;
    ogg_page page;
    ogg_stream_state streamState;
    vorbis_info info;
    vorbis_comment comment;
    char* pResult = NULL;
    
    ogg_sync_init(&syncState);
    vorbis_comment_init(&comment);
    vorbis_info_init(&info);
    state = INITIALIZED;
    
    int packetsRead = 0, pagesRead = 0;
    unsigned char *pReadPos = pOggFileBytes, *pStopReadPos = pReadPos + oggFileBytesLen;
    while(pReadPos != pStopReadPos) {
        pReadPos = _readNextPage(pReadPos, pStopReadPos, &syncState, &page);
        if (pReadPos == NULL) goto cleanup; // Read all the pages without finding 2 packets. A corrupted/truncated file, probably.
        if (++pagesRead == 1) { // Annoyingly, I must wait until one page has been read, and then I can initialize a stream using the page's serial#.
            if (ogg_stream_init(&streamState, ogg_page_serialno(&page)) == -1) goto cleanup;
            state = STREAM_INITIALIZED;
        }
        if (ogg_stream_pagein(&streamState, &page) == -1) goto cleanup;
        
        // Read the first two packets in to find the comments. 
        while(1) {
            if (ogg_stream_packetout(&streamState, &packet) != 1) break;
            if (vorbis_synthesis_headerin(&info, &comment, &packet) != 0) goto cleanup; // Necessary to call on 1st as well as 2nd packet.
            if(++packetsRead == 2) { // Comments are in 2nd packet, and that's all I want.
                state = FOUND_COMMENT;
                break;
            }
        }
        if (state == FOUND_COMMENT) break;
    }
    if (state != FOUND_COMMENT) goto cleanup;
    
    pResult = _packComments(&comment); // Just put the comments in a contiguous buffer so JS calling code can parse it more simply.
    
cleanup:
    if (state >= STREAM_INITIALIZED) ogg_stream_clear(&streamState);
    if (state >= NEW) {
        ogg_sync_clear(&syncState);
        vorbis_comment_clear(&comment);
        vorbis_info_clear(&info);
    }
    return pResult;
}