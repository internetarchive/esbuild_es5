# esbuild_es5
minify JS/TS files using `esbuild` and `swc` down to ES5 (uses `deno`)

## Usage
```
deno run --allow-read --allow-write --allow-net --allow-run --allow-env https://deno.land/x/esbuild_es5/esbuild.js [FILE1] [FILE2] ..
```

or

```
deno install --allow-read --allow-write --allow-net --allow-run --allow-env https://deno.land/x/esbuild_es5/esbuild.js

esbuild [FILE1] [FILE2] ..
```


## Warning
`--format=es6` doesnt yet work with `--names_always_end_with_min=true` (latter gets ignored).


Run with `-h` or `--help` to see detailed usage, eg:
```txt
Usage: esbuild [FILE1] [FILE2] ..

Options:
  -o, --outdir                     directory for built files
                                                     [string] [default: "build"]
  -f, --format                     output format: iife, cjs, esm, es6.  iife def
                                   aults to es5.  esm implies es6.
                                                               [default: "iife"]
      --banner                     string banner (eg: license info) to put at the
                                   head of each built JS file
                                                          [string] [default: ""]
      --footer                     string footer (eg: license info) to put at the
                                   tail of each built JS file
                                                          [string] [default: ""]
  -m, --minify                     minify built .js files
                                                       [boolean] [default: true]
  -r, --regenerator_inline         makes output more of standalone/entrypoint by
                                   inlining regeneratorRuntime at the top (of
                                   each built file)     [boolean] [default: true]
      --names_always_end_with_min  even if you dont elect to `--minify`, still
                                   use `.min.js` for your built suffixes
                                                       [boolean] [default: true]
      --verbose                    verbose (quite) information to stderr
                                                      [boolean] [default: false]
      --stash                      debug mode -- write import-ed files to /tmp/e
                                   stash/ for inspection
                                                      [boolean] [default: false]
  -h, --help                       Show help                           [boolean]
      --version                    Show version number                 [boolean]
```
