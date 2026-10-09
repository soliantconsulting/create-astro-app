#!/usr/bin/env bash

return_code=0

# `astro check` replaces `tsc --noEmit`: tsc cannot parse .astro files. It needs TypeScript's
# programmatic API, which TypeScript 7 does not expose yet, so this package stays on TypeScript 6
# while cdk/ is on 7. Track https://github.com/withastro/roadmap/discussions/1321.
commands=(
  "pnpm biome ci ."
  "pnpm astro check"
  "pnpm run --if-present test"
  "pnpm --dir=./cdk tsc --noEmit"
)

for cmd in "${commands[@]}"; do
    $cmd

    if [ $? -ne 0 ]; then
        return_code=1
    fi
done

exit $return_code
