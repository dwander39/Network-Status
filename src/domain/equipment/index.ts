/**
 * Target equipment domain (migration). Runtime app still uses `Device` / `SaveDevicePayload`.
 * Next steps: implement `EquipmentMutationService` behind IPC; map SQLite → Equipment; bridge map layout.
 */

export * from './valueTypes'
export * from './deviceEquipmentAdapter'
export * from './types'
export * from './fieldDefinitions'
export * from './typeDefinitions'
export * from './layoutTypes'
export * from './indexTypes'
export * from './mutations'
export * from './resolvers'
export * from './builtInRegistry.example'
