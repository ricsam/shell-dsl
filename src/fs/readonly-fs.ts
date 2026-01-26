import { FileSystem, type PermissionRules, type UnderlyingFS } from "./real-fs.ts";

export class ReadOnlyFileSystem extends FileSystem {
  constructor(mountPath?: string, permissions?: PermissionRules, fs?: UnderlyingFS) {
    // Merge user permissions with base read-only rule
    const mergedPermissions: PermissionRules = {
      "**": "read-only",
      ...permissions,
    };
    super(mountPath, mergedPermissions, fs);
  }
}
