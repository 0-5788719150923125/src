#!/usr/bin/env node
// The Source: one entrypoint. The default action is the development loop:
// build the site and serve it on localhost, rebuilding whenever src/ or
// stations.js changes, and restarting whenever this file, scripts/ or .env
// does. Every run but --test also brings the year in LICENSE up to date.
// Everything else is a flag; `node main.js --help` lists them.

import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { DEFAULT_OUT, ROOT, build, trackerList } from './scripts/build.js'
import { DEFAULT_PROJECT, deploy, undeploy } from './scripts/deploy.js'
import { loadEnv } from './scripts/env.js'
import { buildExtension, sourceArchive } from './scripts/extension.js'
import { updateLicense } from './scripts/license.js'
import { serve } from './scripts/serve.js'

const { values: args } = parseArgs({
    options: {
        build: { type: 'boolean' },
        test: { type: 'boolean' },
        deploy: { type: 'boolean' },
        undeploy: { type: 'boolean' },
        extension: { type: 'boolean' },
        publish: { type: 'string' },
        privacy: { type: 'string' },
        trace: { type: 'boolean' },
        yes: { type: 'boolean', short: 'y' },
        out: { type: 'string', default: DEFAULT_OUT },
        host: { type: 'string', default: '127.0.0.1' },
        port: { type: 'string', default: '8000' },
        project: { type: 'string' },
        domain: { type: 'string' },
        peers: { type: 'string' },
        data: { type: 'string', default: 'tinystories' },
        chat: { type: 'string', default: 'memorytest' },
        help: { type: 'boolean', short: 'h' }
    }
})

if (args.help) {
    console.log(`usage: node main.js [--build | --test | --deploy | --undeploy [--yes]]
                    [--port N] [--host ADDR] [--out DIR] [--project NAME] [--domain NAME]
       node main.js --peers N [--data tinystories|quijote|git|FILE] [--chat NAME]
       node main.js --extension | --publish chrome|firefox|all [--yes]
       node main.js --privacy chromium|firefox|all
       node main.js --trace

  (no flag)   build, then serve at http://localhost:8000 with live reload;
              restarts itself when main.js, scripts/ or .env change
  --build     build into build/site/ and exit
  --test      run the tests (node --test)
  --deploy    build, then publish to Cloudflare Pages (credentials in .env)
  --undeploy  delete that Pages project, detach its domain, delete its
              CNAME, cache rule and mirror; shows the plan and asks first
              (--yes skips the question)
  --peers N   start N test peers that remember a library and answer the
              ghost text's memory questions in a chat (default memorytest;
              open http://localhost:8000/?chat=memorytest to meet them)
  --extension build the browser extension into build/extension/ (a folder
              to load unpacked, and a zip, per browser)
  --publish S build it, then upload it to a store: chrome, firefox or all
              (credentials in .env); shows the plan and asks first
  --privacy B build it, then check its privacy promises in a headless
              browser: chromium, firefox or all (PRIVACY.md)
  --trace     copy the latest trace a development install of the extension
              kept in Firefox into build/traces/ (extension/host.js)`)
    process.exit(0)
}

if (args.peers !== undefined) process.exit(await peers())
if (args.trace) {
    const { readTrace } = await import('./scripts/trace.js')
    process.exit(readTrace() ? 0 : 1)
}

// Test peers run from the stack's folder, which has WebRTC for Node
// (node-datachannel, a native module the root install leaves out).
async function peers() {
    const dir = path.join(ROOT, 'containers', 'node')
    const webrtc = path.join(
        dir,
        'node_modules',
        'node-datachannel',
        'build',
        'Release',
        'node_datachannel.node'
    )
    if (!fs.existsSync(webrtc)) {
        console.log(`Test peers need the stack's dependencies, with WebRTC for Node. Either:
  npm --prefix containers/node ci --ignore-scripts && npm --prefix containers/node rebuild node-datachannel
or run them in the stack: PEERS=${args.peers} PEER_DATA=${args.data} docker compose --profile test up -d --build peers`)
        return 1
    }
    loadEnv()
    const env = {
        ...process.env,
        PEERS: args.peers,
        PEER_DATA: ['tinystories', 'quijote', 'git'].includes(args.data)
            ? args.data
            : path.resolve(args.data),
        PEER_CHATS: args.chat,
        TRACKERS: trackerList().join(','),
        DATA_DIR: path.join(ROOT, 'data', 'peers')
    }
    const child = spawn(process.execPath, ['peers.js'], {
        cwd: dir,
        env,
        stdio: 'inherit'
    })
    for (const signal of ['SIGINT', 'SIGTERM'])
        process.on(signal, () => child.kill(signal))
    return new Promise((resolve) =>
        child.on('exit', (code) => resolve(code ?? 0))
    )
}

if (args.test) {
    process.exit(
        spawnSync(process.execPath, ['--test'], { cwd: ROOT, stdio: 'inherit' })
            .status ?? 1
    )
}

// The dev server runs under Node's watch mode, so edits to the code that
// builds and serves the site (cached once imported) and to .env take effect
// without a restart by hand. Edits under src/ only need a rebuild, which
// the server does itself (scripts/serve.js).
const serving =
    !args.build &&
    !args.deploy &&
    !args.undeploy &&
    !args.extension &&
    args.publish === undefined &&
    args.privacy === undefined
if (serving && !process.env.SRC_WATCHED) {
    const watched = ['main.js', 'scripts', '.env']
        .map((name) => path.join(ROOT, name))
        .filter((file) => fs.existsSync(file))
    const child = spawn(
        process.execPath,
        [
            ...watched.map((file) => `--watch-path=${file}`),
            '--watch-preserve-output',
            ...process.argv.slice(1)
        ],
        { stdio: 'inherit', env: { ...process.env, SRC_WATCHED: '1' } }
    )
    child.on('exit', (code) => process.exit(code ?? 0))
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'])
        process.on(signal, () => child.kill(signal))
} else {
    await run()
}

async function run() {
    loadEnv()
    updateLicense()
    // Read after loadEnv, so .env can name the project.
    const project =
        args.project || process.env.CLOUDFLARE_PAGES_PROJECT || DEFAULT_PROJECT
    if (args.undeploy)
        process.exit(
            (await undeploy({ project, domain: args.domain, yes: args.yes }))
                ? 0
                : 1
        )
    if (args.privacy !== undefined) {
        const { checkPrivacy } = await import('./scripts/privacy.js')
        const browsers =
            args.privacy === 'all' ? ['chromium', 'firefox'] : [args.privacy]
        if (!browsers.every((b) => ['chromium', 'firefox'].includes(b))) {
            console.log('usage: node main.js --privacy chromium|firefox|all')
            process.exit(1)
        }
        const { built } = await buildExtension({ browsers })
        const passed = []
        for (const { browser, dir } of built)
            passed.push(await checkPrivacy(browser, dir))
        process.exit(passed.includes(false) || !passed.some(Boolean) ? 1 : 0)
    }
    if (args.extension || args.publish !== undefined) {
        const built = await buildExtension()
        if (args.publish === undefined) process.exit(0)
        const { publish } = await import('./scripts/stores.js')
        process.exit(
            (await publish(args.publish, {
                ...built,
                source: sourceArchive(),
                yes: args.yes
            }))
                ? 0
                : 1
        )
    }
    const out = await build(path.resolve(args.out), { deploy: args.deploy })
    if (args.deploy) {
        process.exit(
            (await deploy(out, { project, domain: args.domain })) ? 0 : 1
        )
    }
    if (!args.build) serve(out, { host: args.host, port: Number(args.port) })
}
