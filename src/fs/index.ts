export { createVirtualFS } from "./memfs-adapter.ts";
export { FileSystem, type PathOps, type Permission, type PermissionRules, type UnderlyingFS } from "./real-fs.ts";
export { ReadOnlyFileSystem } from "./readonly-fs.ts";
export { WebFileSystem, createWebUnderlyingFS } from "./web-fs.ts";
