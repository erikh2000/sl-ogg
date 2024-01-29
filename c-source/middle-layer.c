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

   One might ask why not encapsulate further by having a single C function that does all of the above?
   Reasons I can think of:
   * The JS calling code may want to keep a single instance of the encoder and use it for multiple encodings. It
     would reduce memory fragmentation and improve performance to reuse the same encoder instance. Hence, 
     the value of having separated encoder_init() and encoder_clear() functions.
   * The JS calling code may want to process audio in chunks, to avoid blocking execution during the encoding of a
     large audio file or continuous stream (e.g. microphone input). Hence, the value of having separated 
     encoder_analysis_buffer() and encoder_process() functions.
   * You could certainly combine encoder_init() and encoder_analysis_buffer() into a single function, but then you'd
     need to return multiple values from that function, which makes the JS calling code more complex from having to
     decode the returned values. Hence, the value of having separated encoder_init() and encoder_analysis_buffer(). 
   * Same single-return-value rationale for keeping encoder_data_len() and encoder_transfer_data() separated.
     
   I found the chosen separation of concerns in this design to be reasonable and hard to improve on. But I did make 
   some improvements to the original code:
   * encoder_analysis_buffer() allocates a buffer with a *fixed* size of ANALYSIS_SAMPLE_COUNT rather than letting 
     the caller set a size. In the libvorbis code, a buffer will be created in stack memory with alloca() for the 
     analysis buffer. It took me a few days to figure out that if I create a buffer for analysis that will hold an 
     entire audio file, it will overflow the stack and cause unexpected behavior. So calling code really needs to 
     be limited to writing to the analysis buffer in smaller chunks that will fit within the stack. (Or I could 
     allocate from the heap instead of stack, but that would probably require forking libvorbis code, which I'd 
     rather not do.)
*/
#include <time.h>
#include <stdlib.h>
#include <memory.h>
#include <vorbis/vorbisenc.h>
#include <emscripten.h>

typedef struct encoder_state {
    ogg_stream_state os;
    ogg_page og;
    ogg_packet op;
    vorbis_info vi;
    vorbis_comment vc;
    vorbis_dsp_state vd;
    vorbis_block vb;
    unsigned char *data;
    long len;
} encoder_state;

void _encoder_add_data(encoder_state *enc) {
    ogg_page *og = &enc->og;
    long len = enc->len + og->header_len + og->body_len;
    if (len == 0) return;
    enc->data = realloc(enc->data, len);
    memcpy(enc->data + enc->len, og->header, og->header_len);
    enc->len += og->header_len;
    memcpy(enc->data + enc->len, og->body, og->body_len);
    enc->len += og->body_len;
}

EMSCRIPTEN_KEEPALIVE
encoder_state* encoder_init(int channelCount, float sampleRate, float quality) {
    ogg_packet h_comm, h_code;
    encoder_state *enc = malloc(sizeof(encoder_state));
    vorbis_info_init(&enc->vi);
    vorbis_encode_init_vbr(&enc->vi, channelCount, sampleRate, quality);
    vorbis_comment_init(&enc->vc);
    vorbis_comment_add_tag(&enc->vc, "ENCODER", "sl-web-ogg");
    vorbis_analysis_init(&enc->vd, &enc->vi);
    vorbis_block_init(&enc->vd, &enc->vb);
    srand(time(NULL));
    ogg_stream_init(&enc->os, rand());
    enc->data = NULL;
    enc->len = 0;
    vorbis_analysis_headerout(&enc->vd, &enc->vc, &enc->op, &h_comm, &h_code);
    ogg_stream_packetin(&enc->os, &enc->op);
    ogg_stream_packetin(&enc->os, &h_comm);
    ogg_stream_packetin(&enc->os, &h_code);
    while(ogg_stream_flush(&enc->os, &enc->og) != 0) {
        _encoder_add_data(enc);
    }
    return enc;
}

EMSCRIPTEN_KEEPALIVE
void encoder_clear(encoder_state* enc) {
    ogg_stream_clear(&enc->os);
    vorbis_block_clear(&enc->vb);
    vorbis_dsp_clear(&enc->vd);
    vorbis_comment_clear(&enc->vc);
    vorbis_info_clear(&enc->vi);
    free(enc->data);
    free(enc);
}

const int ANALYSIS_SAMPLE_COUNT = 8192; // If you change this, you must also change ANALYSIS_SAMPLE_COUNT in postMiddleLayer.js
EMSCRIPTEN_KEEPALIVE
float **encoder_analysis_buffer(encoder_state *enc) {
    return vorbis_analysis_buffer(&enc->vd, ANALYSIS_SAMPLE_COUNT);
}

EMSCRIPTEN_KEEPALIVE
void encoder_process(encoder_state *enc, int length) {
    vorbis_analysis_wrote(&enc->vd, length);
    while(vorbis_analysis_blockout(&enc->vd, &enc->vb) == 1) {
        vorbis_analysis(&enc->vb, NULL);
        vorbis_bitrate_addblock(&enc->vb);
        while(vorbis_bitrate_flushpacket(&enc->vd, &enc->op)) {
            ogg_stream_packetin(&enc->os, &enc->op);
            while(ogg_stream_pageout(&enc->os, &enc->og) != 0) {
                _encoder_add_data(enc);
            }
        }
    }
}

EMSCRIPTEN_KEEPALIVE
long encoder_data_len(encoder_state *enc) {
    return enc->len;
}

EMSCRIPTEN_KEEPALIVE
unsigned char *encoder_transfer_data(encoder_state *enc) {
    enc->len = 0;
    return enc->data;
}