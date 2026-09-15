export default process.env as { readonly [key: string]: string }
export enum NODE_ENV {
  DEV = 'DEV',
  PROD = 'PROD',
  STAGE = 'STAGE',
  LOCAL = 'LOCAL',
  TEST = 'TEST',
  E2E = 'E2E'
}
