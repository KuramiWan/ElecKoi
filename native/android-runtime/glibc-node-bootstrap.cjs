'use strict'

const launcher = process.env.ELECKOI_NODE_LAUNCHER
if (typeof launcher !== 'string' || !launcher.startsWith('/')) {
  throw new Error('Android Node launcher is unavailable')
}
process.execPath = launcher
