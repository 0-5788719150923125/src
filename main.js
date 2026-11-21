#!/usr/bin/env node
// The Source: one entrypoint. The default action is the development loop:
// build the site and serve it on localhost, rebuilding whenever src/ or
// stations.js changes. Everything else is a flag.
//
//   node main.js              build + dev server at http://localhost:8000
//   node main.js --port 3000  a different port
//   node main.js --build      build only, into build/site/
//   node main.js --test       run the tests
//   node main.js --deploy     build, then publish to Cloudflare Pages

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { DEFAULT_OUT, ROOT, build } from './scripts/build.js'
import { DEFAULT_PROJECT, deploy } from './scripts/deploy.js'
import { loadEnv } from './scripts/env.js'
import { serve } from './scripts/serve.js'

const { values: args } = parseArgs({
    options: {
        build: { type: 'boolean' },
        test: { type: 'boolean' },
        deploy: { type: 'boolean' },
        out: { type: 'string', default: DEFAULT_OUT },
        host: { type: 'string', default: '127.0.0.1' },
        port: { type: 'string', default: '8000' },
        project: { type: 'string', default: process.env.CLOUDFLARE_PAGES_PROJECT || DEFAULT_PROJECT },
        domain: { type: 'string' },
        help: { type: 'boolean', short: 'h' }
    }
})

if (args.help) {
    console.log(`usage: node main.js [--build | --test | --deploy] [--port N] [--host ADDR]
                    [--out DIR] [--project NAME] [--domain NAME]

  (no flag)   build, then serve at http://localhost:8000 with live reload
  --build     build into build/site/ and exit
  --test      run the tests (node --test)
  --deploy    build, then publish to Cloudflare Pages (credentials in .env)`)
    process.exit(0)
}

if (args.test) {
    process.exit(spawnSync(process.execPath, ['--test'], { cwd: ROOT, stdio: 'inherit' }).status ?? 1)
}

loadEnv()
const out = await build(path.resolve(args.out), { deploy: args.deploy })
if (args.deploy) {
    process.exit((await deploy(out, { project: args.project, domain: args.domain })) ? 0 : 1)
}
if (!args.build) serve(out, { host: args.host, port: Number(args.port) })
