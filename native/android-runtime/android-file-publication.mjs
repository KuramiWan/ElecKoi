import koffi from 'koffi'

const library = process.env.ELECKOI_GLIBC_EXEC_SHIM
if (!library?.startsWith('/')) throw new Error('Android publication requires its packaged native execution helper')
const publish = koffi.load(library).func('const char *eleckoi_publish_file(const char *source, const char *destination)')

/** Atomically publish the already-synced file, with the same EEXIST refusal as POSIX link. */
export function publishAndroidFile(source, destination) {
  const code = publish(source, destination)
  if (code === null) return
  const error = new Error(`Android file publication failed (${code}): ${source} -> ${destination}`)
  error.code = code
  error.syscall = 'renameat2'
  error.path = source
  error.dest = destination
  throw error
}
