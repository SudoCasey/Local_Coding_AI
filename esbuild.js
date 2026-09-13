const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

function copyStaticFiles() {
  const distDir = path.join(__dirname, 'dist');
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  // Copy CSS
  const cssSrc = path.join(__dirname, 'src', 'sidebar', 'webview', 'style.css');
  const cssDest = path.join(distDir, 'webview.css');
  if (fs.existsSync(cssSrc)) {
    fs.copyFileSync(cssSrc, cssDest);
  }

  // Copy icon if exists
  const iconSrc = path.join(__dirname, 'resources', 'icon.svg');
  const iconDest = path.join(distDir, 'icon.svg');
  if (fs.existsSync(iconSrc)) {
    fs.copyFileSync(iconSrc, iconDest);
  }
}

async function main() {
  copyStaticFiles();

  const extensionConfig = {
    entryPoints: ['./src/extension.ts'],
    bundle: true,
    outfile: './dist/extension.js',
    external: ['vscode'],
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    sourcemap: !production,
    minify: production,
    logLevel: 'info',
  };

  const webviewConfig = {
    entryPoints: ['./src/sidebar/webview/main.ts'],
    bundle: true,
    outfile: './dist/webview.js',
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    sourcemap: !production,
    minify: production,
    logLevel: 'info',
  };

  if (watch) {
    const extCtx = await esbuild.context(extensionConfig);
    const webviewCtx = await esbuild.context(webviewConfig);
    await Promise.all([extCtx.watch(), webviewCtx.watch()]);
    console.log('Watching for changes...');
  } else {
    await Promise.all([
      esbuild.build(extensionConfig),
      esbuild.build(webviewConfig),
    ]);
    copyStaticFiles();
    console.log('Build complete.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
