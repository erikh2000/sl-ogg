# sl-web-ogg

A library for using Ogg Vorbis in web browsers with the following features:
* Decodes and encodes Ogg Vorbis files, including comments.
* Decoding Ogg Vorbis files audio data with browser-native implementation. (It's just faster.)
* No file-hosting requirements to use API. Just import the package and use it.
* Asynchronous promise-based API rather than use of web workers. (That may or may not be good for what you need.)
* You can build the C-code portion if you want, or just use the WASM from the repo.
* Zero dependencies other than Xiph reference implementations in C via .gitmodules.
* Compatible with Webpack 5+ builds. (In other words, it does not rely on those deprecated Node-style definitions (e.g. Process) from Webpack 4 that are often declared as external dependencies causing breakage.)

# Code Examples

The examples below give a quick idea of how to accomplish different things. For a full working example of encoding, see the simple web app under the `/example` directory.

## Simple Encoding
```javascript
import { encodeAudioBuffer } from 'sl-ogg'; 

//...load an audio file into the audioBuffer variable.

encodeAudioBuffer(audioBuffer).then(oggBlob => {
 // You've got a Blob. It can be downloaded, saved to persistent storage, or uploaded to a server - whatever you want to do with it. 
});
```

## Encoding with Options
```javascript
import { encodeAudioBuffer } from 'sl-ogg'; 

//...load an audio file into the audioBuffer variable.

const commentTags = [{tag:'genre', value:'alternative'}, {tag:'artist', value:'REALLIFEALWAYS'}];

encodeAudioBuffer(audioBuffer, {quality:1, commentTags}).then(oggBlob => {
  //...do your stuff with blob.  
});
```

## Simple Decoding
Browser-native functionality is used to decode the Ogg Vorbis file because it's almost always going to be faster than even WASM code. With this approach, a user gesture will be needed on some browsers before `decodeOggBlob()` or `decodeOggBlobWithTags()` can be successfully called. In other words, the user has to click on something (anything) before the code below will work.

```javascript
import { decodeOggBlob } from 'sl-ogg'; 

//...load an Ogg file into blob variable.

decodeOggBlob(blob).then(audioBuffer => {
  // You've got an AudioBuffer. It can be played, samples analyzed, etc.  
});
```

## Decoding with Passed AudioContext
In some browsers (frigging Safari is the Internet Explorer of 202x!), there is a limit on the number of AudioContext instances you can have open. To avoid hitting this limit unexpectedly, you can hold on to one instance and pass it to `decodeOggBlob()` so that only this single instance is used.
```javascript
import { decodeOggBlob } from 'sl-ogg'; 

//...load an Ogg file into blob variable.

const audioContext = new AudioContext();
decodeOggBlob(blob, audioContext).then(audioBuffer => {
    //...do your stuff with audioBuffer
});
```

## Decoding Comments from Ogg File
```javascript
import { decodeOggBlob } from 'sl-ogg'; 

//...load an Ogg file into blob variable.

decodeOggBlobWithTags(blob).then(([audioBuffer, tags]) => {
    console.log(tags); // It's an array of {name:string, value:string} elements.
});
```

# How It Works

There's three layers to this thing.

* *API Layer* (JS) - the thing your web app calls. It wraps the Middle Layer's API, and unlike the Middle Layer has access to DOM, promise mechanics, and browser-provided web APIs.
* *Middle Layer* (C) - some functions that abstract over the fairly low-level Vorbis APIs to handle encoding and decoding. Unlike the API Layer, it has direct memory access and can concisely and performantly manipulate variables to call the Vorbis APIs.
* *Vorbis Layer* - the WASM-compiled libvorbis and libogg. Theses source are used unchanged from pinned versions of Xiph reference implementations via Git submodules. (.gitmodules)

# The Seespace Labs Project Style

* Low dependencies, preferably none.
* Any dependencies added are evaluated for security and maintenance issues.
* Functions and variables are named for clarity and consistency.
* Explain the reasons for doing things in comments even if it means revealing ignorance and mistakes. In other words, invite understanding and disagreement.
* Better to have a small project done well than a sprawling jungle.

## Licensing

To honor the licenses of the Xiph reference implementations, I've copied the COPYING files from the Ogg and Vorbis repositories, respectively, to Ogg-COPYING and Vorbis-COPYING. This would cover the distribution of the WASM binaries under this repository. I think I am not technically distributing any source code from the Xiph reference implementations with my use of .gitmodules. But if I were, then including the COPYING files should satisfy the licensing terms.

All other files in the project are licensed under the MIT license.

middle-layer.c is a copy-and-rewrite from Yuji Miyane's code at github.com/higuma/ogg-vorbis-encoder-js/blob/master/src/encoder.c, which has its own prior contributors that Yuji also based his work on. Yuji's project is MIT-licensed like mine, so I believe my licensing is compatible with his wishes. 

For anyone from Xiph or elsewhere that feels I've not followed licensing correctly, please file a Github issue or otherwise contact me. I aim to do right, and I am on the side of those who create.

### Contributing

The project isn't open to contributions at this point. But that could change. Contact me if you'd like to collaborate.

### Contacting

You can reach me on LinkedIn. I'll accept connections if you will just mention "sl-ogg" or some other shared interest in your connection request.

https://www.linkedin.com/in/erikhermansen/