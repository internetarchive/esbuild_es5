#!/usr/bin/env -S deno run --unstable --allow-read --allow-write --allow-run --allow-env --allow-net
/* eslint-disable semi */
import * as esbuild from 'https://deno.land/x/esbuild@v0.15.6/mod.js'
import * as swc from 'https://deno.land/x/swc@0.2.1/mod.ts'
import yargs from 'https://deno.land/x/yargs/deno.ts'
import { basename } from 'https://deno.land/std/path/mod.ts'
import { writeAllSync } from 'https://deno.land/std/streams/conversion.ts'

import { exe } from 'https://av.prod.archive.org/js/util/cmd.js'
import { warn } from 'https://av.prod.archive.org/js/util/log.js'

/*
  Bundles and transpiles JS files.

  Pass in one or more JS files on the command line to build them all in parallel.

  TODO: can make `.map` files point to *orignal* code?
*/

const VERSION = '1.0.4'
const OPTS = yargs(Deno.args).options({
  outdir: {
    description: 'directory for built files',
    type: 'string',
    default: 'build',
    alias: 'o',
  },
  format: {
    description: 'output format: iife, cjs, esm',
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
})
  .usage('Usage: esbuild [FILE1] [FILE2] ..')
  .help()
  .alias('help', 'h')
  .version(VERSION).argv
const entryPoints = OPTS._
// warn({ entryPoints, OPTS })


/**
 * Bundles and transpiles JS files
 */
async function main() {
  OPTS.regenerator_inline = OPTS.regenerator_inline ?
    // we prefix each output JS file w/ `regeneratorRuntime` -- so we won't need a separate polyfill
    (await exe('wget -qO- https://esm.archive.org/v77/regenerator-runtime@0.13.9/es2015/runtime.js')).replace(/export\{\S+ as default\};/, '').concat('\n') : ''

  if (!entryPoints.length) return

  await exe(`mkdir -p ${OPTS.outdir}`)

  warn('\n', { entryPoints })

  try {
    // eslint-disable-next-line  no-use-before-define
    await builder()
  } catch {
    // It's common enough that `import https://esm.archive.org/lit` can _sometimes_ fail
    // (seems like a race condition) maybe 10-25% of the time.  Retry once in case.
    warn('\nsleeping 15s and retrying')
    await exe('sleep 15')
    try {
      // eslint-disable-next-line  no-use-before-define
      await builder()
    } catch {
      Deno.exit(1)
    }
  }

  // build success
  warn('\n[esbuild] done')
  Deno.exit(0)
}


async function builder() {
  await esbuild.build({
    entryPoints,
    plugins: [
      // eslint-disable-next-line  no-use-before-define
      httpPlugin,
    ],
    // logLevel: 'verbose',
    bundle: true,
    outdir: OPTS.outdir,
    sourcemap: true,
    loader: { '.js': 'jsx' },
    minify: false, // we minify later
    format: OPTS.format,
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
  warn('\n[swc] ES6 => ES5')

  const outputs = Object.keys(result.metafile.outputs)
    .filter((file) => file.endsWith('.js')) // (excludes .js.map files, basically)

  const kills = {}
  for (const key of Object.keys(result.metafile.outputs).filter((file) => file.endsWith('.js.map')))
    kills[key] = true

  await Promise.all(
    outputs.map(async (srcfile) => {
      // warn('SWC ES5 THIS', Deno.readTextFileSync(srcfile))
      const output = await swc.transform(Deno.readTextFileSync(srcfile), {
        jsc: { target: 'es5' },
        sourceMaps: true,
        module: { type: OPTS.format === 'iife' ? 'commonjs' : 'es6' },
        // Ran into a bug using SWC's minifier on ESBuild's output. Instead of minfying here,
        // do another ESBuild pass later only for minification
        // minify: true,
      })

      if (OPTS.regenerator_inline)
        output.code = output.code.replace(/require\("regenerator-runtime"\)/, 'regeneratorRuntime')

      // warn('ESBUILD MINIFY THIS', output.code)

      // Minify again using esbuild, because we can't trust SWC's minifier.
      // Also, add any banner/footer to each JS file, as well as sourcemap URL.
      output.code = (await esbuild.transform(output.code, {
        minify: OPTS.minify,
        target: 'es5',
      })).code
        .replace(/import [a-z0-9_]+ from"regenerator-runtime";/, '') // IF we used non `iife` format
        // above, we are wanting an output file that can be `import` or `require` into *another*
        // file.  So remove any slid in `import .. regenerator-runtime`.


      const dstfile = OPTS.names_always_end_with_min
        ? `${OPTS.outdir}/${basename(srcfile, '.js')}.min.js`
        : `${OPTS.outdir}/${basename(srcfile)}`
      const mapfile = `${dstfile}.map`
      // console.warn({ srcfile, dstfile, mapfile })

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
 * Plugin that allows `import()` of fully-qualified URLs in JS that can be bundled and transpiled.
 *
 * Derived from:
 *   https://esbuild.github.io/plugins/#http-plugin
 *
 * TODO: switch to `esbuild-plugin-http-fetch` if/when we move `node` to `deno`
 */
let num_downloaded = 0
const httpPlugin = {
  name: 'http',
  setup(build) {
    warn('[esbuild] building')
    // Intercept import paths starting with "http:" and "https:" so
    // esbuild doesn't attempt to map them to a file system location.
    // Tag them with the "http-url" namespace to associate them with
    // this plugin.
    build.onResolve({ filter: /^https?:\/\// }, (args) => ({
      path: args.path,
      namespace: 'http-url',
    }))

    // We also want to intercept all import paths inside downloaded
    // files and resolve them against the original URL. All of these
    // files will be in the "http-url" namespace. Make sure to keep
    // the newly resolved URL in the "http-url" namespace so imports
    // inside it will also be resolved as URLs recursively.
    build.onResolve({ filter: /.*/, namespace: 'http-url' }, (args) => ({
      // eslint-disable-next-line compat/compat
      path: new URL(args.path, args.importer).toString(),
      namespace: 'http-url',
    }))

    // When a URL is loaded, we want to actually download the content
    // from the internet. This has just enough logic to be able to
    // handle the example import from unpkg.com but in reality this
    // would probably need to be more complex.
    build.onLoad({ filter: /.*/, namespace: 'http-url' }, async (args) => {
      // warn(`Downloading: ${args.path}`)
      if (!num_downloaded) writeAllSync(Deno.stderr, new TextEncoder().encode('[esbuild] Downloading https:// import(s) '))
      writeAllSync(Deno.stderr, new TextEncoder().encode('.'))
      num_downloaded += 1
      const contents = await (await fetch(args.path)).text()
      return { contents }
    })
  },
}


// eslint-disable-next-line
void main()
