#!/usr/bin/env bash

return_code=0

# `astro check` replaces `tsc --noEmit` here: tsc cannot parse .astro files, so running it alone
# would typecheck the .ts files and silently skip every page and component.
#
# This is why the site package pins TypeScript 6 while the rest of the fleet is on 7. The Astro
# language server needs TypeScript's programmatic API, which the native 7.x compiler does not
# expose yet. Typechecking the actual pages is worth more than version alignment with a different
# runtime. Track https://github.com/withastro/roadmap/discussions/1321 and move to 7 when it lands.
# The cdk package is separate and stays on TypeScript 7.
commands=(
  "pnpm biome ci ."
  "pnpm astro check"
  "pnpm --dir=./cdk tsc --noEmit"
)

for cmd in "${commands[@]}"; do
    $cmd

    if [ $? -ne 0 ]; then
        return_code=1
    fi
done

exit $return_code
