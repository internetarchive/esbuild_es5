#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-env --allow-net --allow-ffi
/* eslint-disable semi */
import * as esbuild from 'https://deno.land/x/esbuild@v0.15.15/mod.js'
import * as swc from 'https://deno.land/x/swc@0.2.1/mod.ts'

import yargs from 'https://deno.land/x/yargs/deno.ts'
import { basename, dirname } from 'https://deno.land/std/path/mod.ts'
import { writeAllSync } from 'https://deno.land/std/streams/write_all.ts'

import { exe } from 'https://av.prod.archive.org/js/util/cmd.js'
import { warn } from 'https://av.prod.archive.org/js/util/log.js'

/*
  Bundles and transpiles JS files.

  Pass in one or more JS files on the command line to build them all in parallel.

  TODO: can make `.map` files point to *orignal* code?
*/

const VERSION = '1.0.11'
const OPTS = yargs(Deno.args).options({
  outdir: {
    description: 'directory for built files',
    type: 'string',
    default: 'build',
    alias: 'o',
  },
  format: {
    description: 'output format: iife, cjs, esm, es6.  iife defaults to es5.  esm implies es6.',
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
  regenerator_inline: {
    description: 'makes output more of standalone/entrypoint by inlining regeneratorRuntime at the top (of each built file)',
    type: 'boolean',
    default: true,
    alias: 'r',
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
  .version(VERSION).argv
const entryPoints = OPTS._
// warn({ entryPoints, OPTS })

const MAX_RETRIES = 5
const ES6 = OPTS.format === 'es6' // ES6 only -- dont transpile down to ES5


/**
 * Bundles and transpiles JS files
 */
async function main() {
  OPTS.regenerator_inline = OPTS.regenerator_inline ?
    // We prefix each output JS file w/ `regeneratorRuntime` -- so we wont need a separate polyfill.
    // NOTE: we're using jsdelivr here so we can get the "raw source" (which is ES5).
    (await exe('wget -qO- https://cdn.jsdelivr.net/npm/regenerator-runtime@0.13.9/runtime.js')).concat('\n') : ''

  if (!entryPoints.length) return

  await exe(`mkdir -p ${OPTS.outdir}`)

  warn('\n', { entryPoints })

  for (let n = 0; n < MAX_RETRIES; n++) {
    try {
      // eslint-disable-next-line  no-use-before-define
      await builder()

      // build success
      warn('\n[esbuild] done')
      Deno.exit(0)
      // eslint-disable-next-line no-empty
    } catch {}

    // It's common enough that `import https://esm.archive.org/lit/decorators.js` can _sometimes_
    // fail (seems like a race condition) maybe 10-25% of the time.
    warn('\nsleeping 15s and retrying')
    await exe('sleep 15')
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
    minify: ES6 ? OPTS.minify : false, // if we're making ES5, we'll minify later
    format: ES6 ? 'iife' : OPTS.format,
    banner: ES6 ? { js: `${OPTS.banner}\n${OPTS.regenerator_inline}` } : {},
    footer: ES6 ? { js: OPTS.footer } : {},
    target: ['es6'], // AKA es2015 -- the lowest `esbuild` can go
    metafile: true,  // for `convertToES5()`
    // eslint-disable-next-line  no-use-before-define
  }).then(convertToES5) // takes all `esbuild` output together and converts in parallel to ES5
    .catch((e) => {
      warn('FATAL:', e)
      throw e
    })
}


/**
 * Converter that transpiles ES6 code from `esbuild` to ES5 via `swc`
 *
 * Derived from magnifique:
 *   https://github.com/evanw/esbuild/issues/297#issuecomment-961800886
 */
async function convertToES5(result) {
  if (ES6) {
    // xxx needs just a bit more work to move the ES6 already created files to desired .min.js
    // when OPTS.names_always_end_with_min -- also need to get the sourceMappingURL= adjusted right
    warn({ result })
    return
  }

  warn('\n[swc] ES6 => ES5')

  const outputs = Object.keys(result.metafile.outputs)
    .filter((file) => file.endsWith('.js')) // (excludes .js.map files, basically)

  const kills = {}
  for (const key of Object.keys(result.metafile.outputs).filter((file) => file.endsWith('.js.map')))
    kills[key] = true

  await Promise.all(
    outputs.map(async (srcfile) => {
      // warn('SWC ES5 THIS', Deno.readTextFileSync(srcfile))
      const output = OPTS.format === 'iife' ?
        await swc.transform(Deno.readTextFileSync(srcfile), {
          jsc: { target: 'es5' },
          sourceMaps: true,
          module: { type: OPTS.format === 'iife' ? 'commonjs' : 'es6' },
          // Ran into a bug using SWC's minifier on ESBuild's output. Instead of minfying here,
          // do another ESBuild pass later only for minification
          // minify: true,
        }) : { code: Deno.readTextFileSync(srcfile) }

      if (OPTS.regenerator_inline)
        output.code = output.code.replace(/require\("regenerator-runtime"\)/, 'regeneratorRuntime')

      // warn('ESBUILD MINIFY THIS', output.code)

      // Minify again using esbuild, because we can't trust SWC's minifier.
      // Also, add any banner/footer to each JS file, as well as sourcemap URL.
      output.code = (await esbuild.transform(output.code, {
        minify: OPTS.minify,
        target: OPTS.format === 'iife' ? 'es5' : 'es6',
        logLevel: OPTS.verbose ? 'verbose' : 'silent',
      })).code

      const dstfile = OPTS.names_always_end_with_min
        ? `${OPTS.outdir}/${basename(srcfile, '.js')}.min.js`
        : `${OPTS.outdir}/${basename(srcfile)}`
      const mapfile = `${dstfile}.map`
      // warn({ srcfile, dstfile, mapfile })

      Deno.writeTextFileSync(
        dstfile,
        `${OPTS.banner}\n${OPTS.regenerator_inline}${output.code}\n${OPTS.footer}\n//# sourceMappingURL=${basename(dstfile)}.map`,
      )
      if (output.map)
        Deno.writeTextFileSync(mapfile, output.map)
      delete kills[mapfile]

      if (dstfile !== srcfile)
        Deno.removeSync(srcfile)
    }),
  )

  // Cleanup: remove intermediary .js.map files;  remove empty subdirs
  for (const file of Object.keys(kills))
    Deno.removeSync(file)
  await exe(`find ${OPTS.outdir} -empty -delete`)
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
        if (!num_downloaded) writeAllSync(Deno.stderr, new TextEncoder().encode('[esbuild] Downloading https:// import(s) '))
        writeAllSync(Deno.stderr, new TextEncoder().encode('.'))
        num_downloaded += 1
      }

      const url = upgrade_url(args.path)

      const ret = await fetch(url)

      const stashfile = `/tmp/estash/${url}`.replace(/%5E/gi, '^').replace(/\?/, '')
      if (OPTS.stash) {
        Deno.mkdirSync(dirname(stashfile), { recursive: true })
        // eslint-disable-next-line object-curly-newline
        const { socket, data, parser, req, _readableState, _maxListeners, client, ...copy } = ret
        Deno.writeTextFileSync(`${stashfile}.res`, JSON.stringify(copy))
      }

      if (!ret.ok || ret.status !== 200) {
        warn('NOT OK', url, { ret })
        throw new Error(`GET ${url} failed, status: ${ret.status}`)
      }
      let contents = await ret.text()


      // dayjs workarounds :(
      if (url.match(/https*:\/\/[^/]+\/v\d+\/dayjs.*\/plugin\/localizedFormat\/utils.js/)) {
        // The export setup in this dayjs `utils.js` file is confusing esm.sh and it's replying
        // with a bad export.  Switch it back to needed specific named exports.
        // example url:
        //   https://esm.sh/v99/dayjs@1.11.6/es2022/esm/plugin/localizedFormat/utils.js
        warn(`\nDAYJS WORKAROUND XXX ${url}`)
        const c2 = contents.replace('export{i as default}', 'export const{englishFormats,t,u}=i')
        if (contents === c2)
          warn('\n\n\n LIKELY NOT GOOD -- DAYJS PLUGIN WORKAROUND DIDNT TAKE EFFECT \n\n\n\n')
        else
          contents = c2
      }

      if (url.match(/https*:\/\/[^/]+\/v\d+\/@internetarchive\/histogram-date-range[^/]+\/[^/]+\/histogram-date-range\.js/)) {
        // This ^ file is picking (from esm.sh perspective) the wrong dayjs file to use
        // (it causes `.year()` methods later to not exist).
        // So instead of (logically) importing `dayjs/esm/index.js`, import `dayjs` from esm.sh.
        // example url:
        // https://esm.sh/v99/@internetarchive/histogram-date-range@0.1.7/es2022/histogram-date-range.js
        warn(`\nDAYJS HISTOGRAM-DATE-RANGE WORKAROUND XXX ${url}`)
        const c2 = contents.replace(/dayjs([^/]+)\/[^/]+\/esm\/index\.js/, '/dayjs$1')
        if (contents === c2)
          warn('\n\n\n LIKELY NOT GOOD -- DAYJS WORKAROUND DIDNT TAKE EFFECT \n\n\n\n')
        else
          contents = c2
      }


      if (OPTS.stash)
        Deno.writeTextFileSync(`${stashfile}.contents`, contents)

      return { contents }
    })
  },
}


// eslint-disable-next-line
void main()
