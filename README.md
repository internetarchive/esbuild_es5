# esbuild_es5
minify JS/TS files using `esbuild` and `swc` down to ES5 (uses `deno`)

## Usage
```
deno run --allow-read --allow-write --allow-net --allow-run --allow-env https://deno.land/x/esbuild_es5/esbuild [FILE1] [FILE2] ..
```

or

```
deno install --allow-read --allow-write --allow-net --allow-run --allow-env https://deno.land/x/esbuild_es5/esbuild

esbuild [FILE1] [FILE2] ..
```

Run with `-h` or `--help` to see detailed usage, eg:
```txt
Usage: esbuild [FILE1] [FILE2] ..

Options:
  -o, --outdir                     directory for built files
                                                     [string] [default: "build"]
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
  -h, --help                       Show help                           [boolean]
      --version                    Show version number                 [boolean]
```
