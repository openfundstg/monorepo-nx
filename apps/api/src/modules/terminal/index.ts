export { TerminalModule } from './terminal.module'
export { TerminalDeactivationService } from './services/terminal-deactivation.service'
export { TerminalActivationService } from './services/terminal-activation.service'
export { TerminalUrlResolverService } from './services/terminal-url-resolver.service'
export { TerminalBroadcastService } from './services/terminal-broadcast.service'
export type { TerminalDeactivation } from './services/terminal-deactivation.service'
export type { TerminalActivation } from './services/terminal-activation.service'

// Persistence lives in repositories/terminal-db; re-exported so existing
// consumers of this barrel keep working.
export { TerminalDbService } from 'src/modules/repositories/terminal-db/services'
export { Terminal, TerminalSchema } from 'src/modules/repositories/terminal-db/schemas'
export type { TerminalDocument } from 'src/modules/repositories/terminal-db/schemas'
