import environments from 'src/environments'

/**
 * The MongoDB connection string, with the local default this app has always
 * carried.
 *
 * Named here because two entry points open the same database: the API and the
 * migration CLI, which boots its own Nest context with none of the API's
 * modules in it. A second `environments.DB_URL || '…'` over there is a second
 * place for the default to be edited and forgotten.
 */
export const MONGO_URL = environments.DB_URL || 'mongodb://localhost:27017/TraficToBank'
