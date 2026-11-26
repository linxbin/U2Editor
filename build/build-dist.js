'use strict';

// U2Editor 发布构建:把 server.js / lib/*.js(全量,node target)与 public/*.js(轻量,browser target)
// 混淆后连同 public/ 静态资源、启动脚本、README 输出到 dist/,供打包分发给买家。
// 用法:node build-dist.js [--fast]
//   --fast  快速测试版:跳过控制流扁平化与数字混淆,降低字符串提取比例,用于快速验证构建管线。

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const FAST = process.argv.includes('--fast');

let JavaScriptObfuscator;
try {
  JavaScriptObfuscator = require('javascript-obfuscator');
} catch (e) {
  console.error('未安装 javascript-obfuscator,请先执行:');
  console.error('  cd build && npm install');
  process.exit(1);
}

const BACKEND_OPTS = {
  target: 'node',
  compact: true,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,
  stringArray: true,
  stringArrayThreshold: FAST ? 0.4 : 0.8,
  rotateStringArray: true,
  shuffleStringArray: true,
  stringArrayEncoding: ['base64'],
  stringArrayWrappersCount: 2,
  controlFlowFlattening: !FAST,
  controlFlowFlatteningThreshold: 0.5,
  deadCodeInjection: false,
  selfDefending: false,
  debugProtection: false,
  disableConsoleOutput: false,
  numbersToExpressions: !FAST,
  sourceMap: false
};

const FRONTEND_OPTS = {
  target: 'browser',
  compact: true,
  identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false,
  stringArray: true,
  stringArrayThreshold: 0.6,
  rotateStringArray: true,
  stringArrayEncoding: [],
  controlFlowFlattening: false,
  deadCodeInjection: false,
  selfDefending: false,
  disableConsoleOutput: false,
  numbersToExpressions: false,
  sourceMap: false
};

function obfuscateFile(file, opts) {
  const src = fs.readFileSync(file, 'utf8');
  const t0 = Date.now();
  const result = JavaScriptObfuscator.obfuscate(src, opts);
  fs.writeFileSync(file, result.getObfuscatedCode());
  return Date.now() - t0;
}

function checkSyntax(file) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
}

console.log('构建模式:' + (FAST ? '快速(--fast)' : '完整') + '\n');

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(path.join(DIST, 'lib'), { recursive: true });

fs.cpSync(path.join(ROOT, 'public'), path.join(DIST, 'public'), { recursive: true });
for (const f of ['启动编辑器.bat', 'README.md']) {
  const src = path.join(ROOT, f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(DIST, f));
}

fs.copyFileSync(path.join(ROOT, 'server.js'), path.join(DIST, 'server.js'));
for (const f of fs.readdirSync(path.join(ROOT, 'lib')).filter((x) => x.endsWith('.js'))) {
  fs.copyFileSync(path.join(ROOT, 'lib', f), path.join(DIST, 'lib', f));
}

// 随包附带绿色版 Node:买家解压即用,无需安装 Node.js(用构建机正在运行的官方 node.exe)
fs.mkdirSync(path.join(DIST, 'node'), { recursive: true });
fs.copyFileSync(process.execPath, path.join(DIST, 'node', 'node.exe'));
const nodeLicense = path.join(path.dirname(process.execPath), 'LICENSE');
if (fs.existsSync(nodeLicense)) {
  fs.copyFileSync(nodeLicense, path.join(DIST, 'node', 'LICENSE'));
}

let total = 0;
let count = 0;

function run(file, label, opts) {
  process.stdout.write('[混淆] ' + label + ' ... ');
  const ms = obfuscateFile(file, opts);
  checkSyntax(file);
  total += ms;
  count += 1;
  console.log((ms / 1000).toFixed(1) + 's');
}

run(path.join(DIST, 'server.js'), 'server.js', BACKEND_OPTS);
for (const f of fs.readdirSync(path.join(DIST, 'lib')).filter((x) => x.endsWith('.js')).sort()) {
  run(path.join(DIST, 'lib', f), 'lib/' + f, BACKEND_OPTS);
}
for (const f of fs.readdirSync(path.join(DIST, 'public')).filter((x) => x.endsWith('.js')).sort()) {
  run(path.join(DIST, 'public', f), 'public/' + f, FRONTEND_OPTS);
}

console.log('');
console.log('完成:' + count + ' 个文件混淆并语法自检通过,总耗时 ' + (total / 1000).toFixed(1) + 's');
console.log('产物目录:' + DIST);
console.log('已附带绿色版 Node(node/node.exe),买家解压后双击 启动编辑器.bat 即可,无需安装 Node.js。');
console.log('注意:混淆只防读懂/篡改源码,不防复制转卖。');
