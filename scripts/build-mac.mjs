import { packager } from '@electron/packager';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve('.');
const paths = await packager({
  dir: root,
  out: resolve('mac-build'),
  name: 'Animation Engine',
  platform: 'darwin',
  arch: process.arch,
  overwrite: true,
  appBundleId: 'local.animationengine.studio',
  ignore: [
    /^\/\.git($|\/)/,
    /^\/\.venv($|\/)/,
    /^\/\.models($|\/)/,
    /^\/\.jobs($|\/)/,
    /^\/mac-build($|\/)/,
    /^\/app-preview\.jpg$/,
    /^\/test($|\/)/,
  ],
  prune: true,
});
for (const bundle of paths) {
  await writeFile(
    resolve(bundle, 'Animation Engine.app/Contents/Resources/workspace.json'),
    JSON.stringify({ workspace: root }),
  );
  console.log(resolve(bundle, 'Animation Engine.app'));
}
