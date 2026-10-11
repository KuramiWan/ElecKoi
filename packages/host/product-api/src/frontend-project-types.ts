import type * as Native from '@eleckoi/dsh-product-data/frontends'

// Recursive JSON codecs must be owned by the Remote face, while domain fields
// continue to derive from the Repository contract.
export type FrontendValue = null | boolean | number | string | FrontendValue[] | { [key: string]: FrontendValue }
export type FrontendJson = Record<string, FrontendValue>
export type FrontendScope = Native.FrontendScope
export type FrontendOwner = Native.FrontendOwner
export type FrontendBinding = Native.FrontendBinding
export type FrontendManifest = Omit<Native.FrontendManifest, 'config' | 'project'> & { config?: FrontendJson; project?: FrontendJson }
export type FrontendProject = Omit<Native.FrontendProject, 'manifest'> & { manifest?: FrontendManifest }
export type FrontendWorkspace = Omit<Native.FrontendWorkspace, 'projects'> & { projects: FrontendProject[] }
export type FrontendImport = Omit<Native.FrontendImport, 'manifest' | 'project'> & { manifest?: FrontendJson; project?: FrontendJson }
export type FrontendReplaceFiles = Omit<Native.FrontendReplaceFiles, 'manifest'> & { manifest?: FrontendJson }
export type FrontendFileInput = Native.FrontendFileInput
export type FrontendFileQuery = Native.FrontendFileQuery
export type FrontendFile = Native.FrontendFile
export type FrontendExport = Omit<Native.FrontendExport, 'project'> & { project: FrontendProject }
export type FrontendChange = Omit<Native.FrontendChange, 'workspace'> & { workspace: FrontendWorkspace }
export type NativeFrontendChange = { kind: 'snapshot' | 'changed'; revision: number }
