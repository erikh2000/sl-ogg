#!/bin/bash
# Epiphany: It's much easier for me to understand one giant emcc command than splitting it
# out into a bunch of pre-declared variables.
emcc \
  `# include paths` \
  -I ogg/include -I vorbis/include -I vorbis/lib \
  \
  `# compile/link options. All of the exported function will be found in middle-layer.c prefixed with EMSCRIPTEN_KEEPALIVE.` \
  -ffast-math \
  -g \
  -s ALLOW_MEMORY_GROWTH=0 \
  -s TOTAL_STACK=8488608 \
  --post-js postMiddleLayer.js \
  \
  `# middle layer API source files` \
  middle-layer.c \
  \
  `# libogg source files` \
  ogg/src/bitwise.c ogg/src/framing.c \
  \
  `# libvorbis source files` \
  vorbis/lib/analysis.c \
  vorbis/lib/bitrate.c \
  vorbis/lib/block.c \
  vorbis/lib/codebook.c \
  vorbis/lib/envelope.c \
  vorbis/lib/floor0.c \
  vorbis/lib/floor1.c \
  vorbis/lib/info.c \
  vorbis/lib/lpc.c \
  vorbis/lib/lsp.c \
  vorbis/lib/mapping0.c \
  vorbis/lib/mdct.c \
  vorbis/lib/psy.c \
  vorbis/lib/registry.c \
  vorbis/lib/res0.c \
  vorbis/lib/sharedbook.c \
  vorbis/lib/smallft.c \
  vorbis/lib/vorbisenc.c \
  vorbis/lib/window.c \
  \
  `# output to wasm` \
  -o ../wasm/middle-layer.js

# Append postMiddleLayer.js to the end of the generated middle-layer.js. Why not just use --post-js?
# Because it adds a comment that includes my user name and filesystem path, which I don't want to
# manually delete each time I release. Moreover, if you build with my script, I don't want you to somehow end up 
# exposing your PII in the same way.
# 
# Issue I filed for emscripten: github.com/emscripten-core/emscripten/issues/21084
# cat postMiddleLayer.js >> ../wasm/middle-layer.js