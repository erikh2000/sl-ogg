# sl-web-ogg

A library for using Ogg Vorbis in web browsers with the following features:
* Decodes and encodes Ogg Vorbis files, including comments.
* Decoding Ogg Vorbis files audio data with browser-native implementation. (It's just faster.)
* No file-hosting requirements to use API. Just import the package and use it.
* Asynchronous promise-based API rather than use of web workers. (That may or may not be good for what you need.)
* You can build the C-code portion if you want, or just use the distributed WASM.
* Zero dependencies other than directly referenced (.gitmodules) Xiph reference implementations.
* Compatible with Webpack 5+ builds. (In other words, it does not rely on those deprecated Node-style definitions (e.g. Process) from Webpack 4 that are often declared as external dependencies causing breakage.)

# How It Works

There's three layers to this thing.

* *API Layer* (JS) - the thing your web app calls. It wraps the Middle Layer's API, and unlike the Middle Layer has access to DOM, promise mechanics, and browser-provided web APIs.
* *Middle Layer* (C) - some functions that abstract over the fairly low-level Vorbis APIs to handle encoding and decoding. Unlike the API Layer, it has direct memory access and can concisely and performantly manipulate variables to call the Vorbis APIs.
* *Vorbis Layer* - the WASM-compiled libvorbis and libogg. Theses source are used unchanged from pinned versions of Xiph reference implementations via Git submodules. (.gitmodules)

