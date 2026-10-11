const z = globalThis.z;
if (!z) throw new Error('The pinned browser Zod library is not installed');
export { z };
export default z;
