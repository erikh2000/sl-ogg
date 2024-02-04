import {EncodeTag, P} from "./types";

export function tagsToBuffer(tags:EncodeTag[], Module:any):P {
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

export function bufferToTags(pBuffer:P, Module:any):EncodeTag[] {
  if (pBuffer === null) return [];
  const serializedTabs:string = Module.UTF8ToString(pBuffer);
  if (serializedTabs === '') return [];
  const serializedTabArray = serializedTabs.split('\t');
  return serializedTabArray.map(serializedTab => {
    const equalPos = serializedTab.indexOf('=');
    if (equalPos === -1) { return {name:serializedTab, value: ''}; }
    return {
      name: serializedTab.slice(0, equalPos),
      value: serializedTab.slice(equalPos+1)
    };
  });
}