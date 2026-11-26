// The Source, v4. Plain ES modules, loaded straight by the browser.

import * as answering from './answering.js'
import { start } from './terminal.js'

start()
// Every tab answers the swarm's private questions from the chat it keeps,
// so the browser extension's memory does not hang on a server.
answering.start()
