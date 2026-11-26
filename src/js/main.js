// The Source, v4. Plain ES modules, loaded straight by the browser.

import * as answering from './answering.js'
import { start } from './terminal.js'
import { dropUntried } from './writer.js'

// A model chosen last time that never came ready is not tried again.
dropUntried()
start()
// Every tab answers the swarm's private questions from the chat it keeps,
// so the browser extension's memory does not hang on a server.
answering.start()
