#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-env --allow-net --allow-ffi
/* eslint-disable semi */
import * as esbuild from 'https://deno.land/x/esbuild@v0.20.0/mod.js'
import { sleep } from 'https://deno.land/x/sleep/mod.ts'

import yargs from 'https://deno.land/x/yargs/deno.ts'
import windowsize from 'https://esm.archive.org/window-size'
import { basename, dirname } from 'https://deno.land/std/path/mod.ts'

// eslint-disable-next-line no-console
const warn = console.error.bind(console)

/*
  Bundles and transpiles JS files.

  Pass in one or more JS files on the command line to build them all in parallel.

  TODO: can make `.map` files point to *orignal* code?
*/

const VERSION = '1.0.20'
const OPTS = yargs(Deno.args).options({
  outdir: {
    description: 'directory for built files',
    type: 'string',
    default: 'build',
    alias: 'o',
  },
  format: {
    description: 'output format: iife, cjs, esm.  always transpiles down to ES6.',
    default: 'iife',
    alias: 'f',
  },
  banner: {
    description: 'string banner (eg: license info) to put at the head of each built JS file',
    type: 'string',
    default: '',
  },
  footer: {
    description: 'string footer (eg: license info) to put at the tail of each built JS file',
    type: 'string',
    default: '',
  },
  minify: {
    description: 'minify built .js files',
    type: 'boolean',
    default: true,
    alias: 'm',
  },
  names_always_end_with_min: {
    description: 'even if you dont elect to `--minify`, still use `.min.js` for your built suffixes',
    type: 'boolean',
    default: true,
  },
  verbose: {
    description: 'verbose (quite) information to stderr',
    type: 'boolean',
    default: false,
  },
  stash: {
    description: 'debug mode -- write import-ed files to /tmp/estash/ for inspection',
    type: 'boolean',
    default: false,
  },
})
  .usage('Usage: esbuild [FILE1] [FILE2] ..')
  .help()
  .alias('help', 'h')
  .wrap(Math.min(150, windowsize.width - 1))
  .version(VERSION).argv
const entryPoints = OPTS._
// warn({ entryPoints, OPTS })

const MAX_RETRIES = 5
const WARNINGS = {}

/**
 * Bundles and transpiles JS files
 */
async function main() {
  if (!entryPoints.length) return

  await Deno.mkdir(OPTS.outdir, { recursive: true })

  warn('\n', { entryPoints })

  for (let n = 0; n < MAX_RETRIES; n++) {
    try {
      // eslint-disable-next-line  no-use-before-define
      await builder()
      // eslint-disable-next-line no-use-before-define
      warnings()

      // build success
      warn('\n[esbuild] done')
      Deno.exit(0)
      /* eslint-disable-next-line no-empty */ // deno-lint-ignore no-empty
    } catch {}

    // eslint-disable-next-line no-use-before-define
    warnings()

    if (n + 1 < MAX_RETRIES) {
      // It's common enough that `import https://esm.archive.org/lit/decorators.js` can _sometimes_
      // fail (seems like a race condition) maybe 10-25% of the time.
      warn('\nsleeping 15s and retrying')
      await sleep(15)
    }
  }

  Deno.exit(1)
}


async function builder() {
  await esbuild.build({
    entryPoints,
    plugins: [
      // eslint-disable-next-line  no-use-before-define
      httpPlugin,
    ],
    logLevel: OPTS.verbose ? 'verbose' : 'warning',
    bundle: true,
    outdir: OPTS.outdir,
    sourcemap: true,
    loader: { '.js': 'jsx' },
    minify: OPTS.minify,
    format: OPTS.format,
    banner: { js: OPTS.banner },
    footer: { js: OPTS.footer },
    target: ['es6'], // AKA es2015 -- the lowest `esbuild` can go
    metafile: true,  // for `cleanup()`
    // eslint-disable-next-line  no-use-before-define
  }).then(cleanup)
    .catch((e) => {
      warn('FATAL:', e)
      throw e
    })
}


/**
 * Cleans up transpiled files from `esbuild`
 */
async function cleanup(result) {
  // eslint-disable-next-line no-use-before-define
  warnings()

  warn('\n[tidying up files]')

  for (const file of Object.keys(result.metafile.outputs)) {
    // eslint-disable-next-line no-nested-ternary
    const dstfile = `${OPTS.outdir}/${basename(file)}`.replace(
      OPTS.names_always_end_with_min ? /\.(js|js\.map)$/ : /__noop_dont_do_anything_here_/,
      '.min.$1',
    )
    if (OPTS.verbose)
      warn({ file, dstfile })

    if (dstfile !== file) {
      await Deno.rename(file, dstfile)

      if (OPTS.names_always_end_with_min && dstfile.endsWith('.min.js')) {
        // We create file pairs named like this:
        //   build/js/tv.min.js
        //   build/js/tv.min.js.map

        //  Update the .map url
        const code = await Deno.readTextFile(dstfile)
        const updated = code.replace(/(\/\/# sourceMappingURL=.*)(\.js\.map)/, '$1.min$2')
        if (code === updated)
          warn(`LOGIC ERROR ${basename(dstfile)}sourceMappingURL .js.map didnt get udpated as it should have!`)

        await Deno.writeTextFile(dstfile, updated)
      }
    }
  }

  // Cleanup: remove any empty subdirs
  for (const file of Object.keys(result.metafile.outputs)) {
    try {
      await Deno.remove(dirname(file))
      /* eslint-disable-next-line no-empty */ // deno-lint-ignore no-empty
    } catch {}
  }
}


/**
 * Auto upgrades http to https for typical servers.
 * Nov 2022 we found all sorts of issues w/ `lit/decorators/` JS files -- probably some kind
 * of multiple imports race condition.
 * Let's avoid a 308 redir roundtrip, and this weird issues, and switch url to https.
 *
 * @param {string} url
 * @returns {string}
 */
function upgrade_url(url) {
  const parsed = new URL(url)
  return (
    parsed.protocol === 'http:' &&
    (parsed.hostname === 'esm.sh' || parsed.hostname.endsWith('.archive.org'))
      ? url.replace(/^http:\/\//, 'https://')
      : url
  )
}


/**
 * Plugin that allows `import()` of fully-qualified URLs in JS that can be bundled and transpiled.
 *
 * Derived from:
 *   https://esbuild.github.io/plugins/#http-plugin
 *
 * TODO: consider switch to `esbuild-plugin-http-fetch`, eg:
 *   import httpFetch from 'https://deno.land/x/esbuild_plugin_http_fetch/index.js'
 * or possibly: https://deno.land/x/esbuild_plugin_http_imports
 */
let num_downloaded = 0
const httpPlugin = {
  name: 'http',
  setup(build) {
    warn('[esbuild] building')
    // Intercept import paths starting with "http:" and "https:" so
    // esbuild doesn't attempt to map them to a file system location.
    // Tag them with the "https-url" namespace to associate them with
    // this plugin.
    build.onResolve({ filter: /^https?:\/\// }, (args) => ({
      path: upgrade_url(args.path),
      namespace: 'https-url',
    }))

    // We also want to intercept all import paths inside downloaded
    // files and resolve them against the original URL. All of these
    // files will be in the "https-url" namespace. Make sure to keep
    // the newly resolved URL in the "https-url" namespace so imports
    // inside it will also be resolved as URLs recursively.
    build.onResolve({ filter: /.*/, namespace: 'https-url' }, (args) => ({
      // eslint-disable-next-line compat/compat
      path: upgrade_url(new URL(args.path, args.importer).toString()),
      namespace: 'https-url',
    }))

    // When a URL is loaded, we want to actually download the content
    // from the internet. This has just enough logic to be able to
    // handle the example import from unpkg.com but in reality this
    // would probably need to be more complex.
    build.onLoad({ filter: /.*/, namespace: 'https-url' }, async (args) => {
      if (OPTS.verbose) {
        warn(`[esbuild] Downloading: ${args.path}`)
      } else {
        if (!num_downloaded) await Deno.stderr.write(new TextEncoder().encode('[esbuild] Downloading https:// import(s) '))
        await Deno.stderr.write(new TextEncoder().encode('.'))
        num_downloaded += 1
      }

      const url = upgrade_url(args.path)

      const ret = await fetch(url, {
        headers: { 'User-Agent': 'wget' }, // avoids `denonext` target from esm.sh urls
      })

      const stashfile = `/tmp/estash/${url}`.replace(/%5E/gi, '^').replace(/\?/, '')
      if (OPTS.stash) {
        await Deno.mkdir(dirname(stashfile), { recursive: true })
        /* eslint-disable-next-line object-curly-newline */ // deno-lint-ignore no-unused-vars
        const { socket, data, parser, req, _readableState, _maxListeners, client, ...copy } = ret
        await Deno.writeTextFile(`${stashfile}.res`, JSON.stringify(copy))
      }

      if (!ret.ok || ret.status !== 200) {
        warn('NOT OK', url, { ret })
        throw new Error(`GET ${url} failed, status: ${ret.status}`)
      }
      let contents = await ret.text()

      // [HACK] esm.sh is handing back invalid JS here, which fatals sentry...
      if (args.path.endsWith('/node_process.js'))
        contents = contents.replace('1000000000n+BigInt', 'BigInt(1000000000)+BigInt')

      if (OPTS.stash)
        await Deno.writeTextFile(`${stashfile}.contents`, contents)

      return { contents }
    })
  },
}

function warnings() {
  if (Object.keys(WARNINGS).length) {
    warn('\nWARNINGS with counts:')
    for (const prop of Object.getOwnPropertyNames(WARNINGS)) {
      const num_width = 5
      const num_padded = (' '.repeat(num_width) + WARNINGS[prop]).slice(-num_width)
      warn(`${num_padded}x ${prop}`)
      delete WARNINGS[prop]
    }
  }
}


// eslint-disable-next-line
void main()
