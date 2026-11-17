'use strict';

function createDecoder(options) {
  try {
    return new TextDecoder('gbk', options);
  } catch (e) {
    throw new Error(
      `当前 Node.js ${process.version} 不支持 GBK 解码，请使用 Node.js 18+，推荐通过“启动编辑器.bat”启动。`
    );
  }
}

const decoder = createDecoder({ fatal: false });
let encodeMap = null;

function buildEncodeMap() {
  const map = new Map();
  for (let c = 0x01; c <= 0x7e; c++) {
    map.set(String.fromCharCode(c), Buffer.from([c]));
  }
  const fatal = createDecoder({ fatal: true });
  for (let hi = 0x81; hi <= 0xfe; hi++) {
    for (let lo = 0x40; lo <= 0xfe; lo++) {
      if (lo === 0x7f) continue;
      let ch;
      try {
        ch = fatal.decode(Buffer.from([hi, lo]));
      } catch (e) {
        continue;
      }
      if (ch.length === 1 && ch !== '\uFFFD' && !map.has(ch)) {
        map.set(ch, Buffer.from([hi, lo]));
      }
    }
  }
  return map;
}

function decode(buf) {
  let s = decoder.decode(buf);
  const z = s.indexOf('\u0000');
  if (z >= 0) s = s.slice(0, z);
  return s.trimEnd();
}

function decodeText(buf) {
  return decoder.decode(buf);
}

function encode(str) {
  if (encodeMap === null) encodeMap = buildEncodeMap();
  const parts = [];
  for (const ch of String(str)) {
    if (ch === '\u0000') continue;
    const bytes = encodeMap.get(ch);
    if (!bytes) {
      const code = ch.codePointAt(0).toString(16).toUpperCase();
      throw new Error(`GBK 无法编码字符："${ch}" (U+${code})`);
    }
    parts.push(bytes);
  }
  return Buffer.concat(parts);
}

module.exports = { decode, decodeText, encode };
